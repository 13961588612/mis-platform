package com.mis.kb.domain.service;

import com.mis.kb.api.dto.ChunkHitVO;
import com.mis.kb.api.dto.EffectiveParamsVO;
import com.mis.kb.api.dto.RetrieveHitsVO;
import com.mis.kb.api.dto.RetrieveRequest;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.KbDocumentFilter;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQueryResolver;
import com.mis.kb.domain.model.SynonymMode;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 可见性检索服务（V-01~05 与 R-01~04）。
 *
 * <p>检索前的库集合必须经 {@link KbVisibilityService} 过滤，且只命中用户可见库；
 * 引擎返回的 {@link ChunkHit} 仅携带 MIS 业务 id，并补全文档标题后映射为对外 VO。
 *
 * <p><b>Wave A 改造（WA-02，本波次头号断点 D1）：</b>此前本服务直接
 * {@code new RetrieveQuery(question, scoped, request.topK(), request.threshold())}，
 * 完全没读过 {@code kb_library.rag_settings_json}——库级检索方式/权重/重排设置
 * 从未参与检索。现改为：加载可见库的库级设置 → 交
 * {@link RetrieveQueryResolver} 合并 → 用合并结果调引擎。
 *
 * <p><b>本服务严禁直接引用 {@code RagflowClient}</b>：引擎细节只允许出现在
 * {@code engine} 包的适配器里，这里只认 {@link KnowledgeEnginePort}。
 *
 * <p><b>Wave D 增量（WD-05 / WD-06）——总共只有两行：</b>
 * <ol>
 *   <li>构造 {@code RetrieveContext} 时传 {@link SynonymMode#AUTO}：走热路径内存快照，
 *       <b>零额外数据库查询</b>（AC-06 的前提）。绝不允许「顺手」改成
 *       {@code FRESH} —— 那会给每一次线上问答挂上一次同步的
 *       {@code kb_synonym_config} 查询，库抖一下问答就跟着抖；</li>
 *   <li>对 {@code resolution.expansion()} 打一条 <b>DEBUG</b> 日志。</li>
 * </ol>
 *
 * <p><b>⛔ WD-06 红线：{@link RetrieveHitsVO} 一个字段都不许加。</b>
 * 扩展轨迹只走命中测试出口（{@code KbHitTestService}）。这里读 {@code expansion()}
 * <b>仅限日志</b>，任何把它拼进响应体的改动都会让扩展串流到 {@code mis-rag}，AC-03b 判死。
 * {@code RetrieveHitsVoContractTest} 对 {@code RetrieveHitsVO} 的 JSON 键集合做恒等断言，
 * 多一个键即失败。
 *
 * <p><b>为什么扩展日志压到 DEBUG 而不是 INFO：</b>问答是高频链路，扩展后的查询串
 * 长度可达 512 字符，按 INFO 打会迅速淹没日志、抬高存储成本；且扩展串里含用户原话，
 * 默认不进常开日志更稳妥。真要排障时临时调级即可。
 */
@Service
public class KbRetrieveService {

    private static final Logger log = LoggerFactory.getLogger(KbRetrieveService.class);

    private final KbDocumentRepository documentRepository;
    private final KbLibraryRepository libraryRepository;
    private final KbVisibilityService visibilityService;
    private final KnowledgeEnginePort enginePort;
    private final RetrieveQueryResolver retrieveQueryResolver;

    public KbRetrieveService(
            KbDocumentRepository documentRepository,
            KbLibraryRepository libraryRepository,
            KbVisibilityService visibilityService,
            KnowledgeEnginePort enginePort,
            RetrieveQueryResolver retrieveQueryResolver) {
        this.documentRepository = documentRepository;
        this.libraryRepository = libraryRepository;
        this.visibilityService = visibilityService;
        this.enginePort = enginePort;
        this.retrieveQueryResolver = retrieveQueryResolver;
    }

    /**
     * 在可见库范围内检索。
     *
     * <p>请求里的 {@code topK} / {@code threshold} 按「单次问答覆盖」层级处理
     * （参数层级：全局默认 → 库设置 → 单次覆盖）——mis-rag 不传时为 null，
     * 此时完全由库级设置决定，正是 WA-02 要的效果；显式传了则以请求为准，
     * 保持 P0 行为不回退。
     *
     * @param userId   当前用户 id（用于可见性计算）
     * @param tenantId 租户 id（P0 暂未启用，透传）
     * @param request  检索请求；libraryIds 为空表示在可见范围内全量检索
     * @return 统一检索命中（仅含 MIS 业务 ID + 文档标题）+ 空结果策略 + 生效参数
     */
    @Transactional(readOnly = true)
    public RetrieveHitsVO retrieve(Long userId, Long tenantId, RetrieveRequest request) {
        List<Long> visible = visibilityService.resolveVisibleLibraryIds(userId, tenantId);
        List<Long> scoped = visibilityService.filterVisible(request.libraryIds(), visible);
        Map<Long, RagSettings> perLibrarySettings = loadSettings(scoped);

        // KE-08/KE-09：解析文档/时间过滤 → 具体 MIS 文档 id 集（空 = 不过滤，R5）
        KbDocumentFilter filter = new KbDocumentFilter(
                request.documentIds(), request.uploadFrom(), request.uploadTo());
        List<Long> filteredDocumentIds = resolveFilteredDocumentIds(scoped, filter);

        if (scoped.isEmpty()) {
            // 无可见库：不调引擎，但仍要告诉调用方按什么策略兜底（WA-11）
            return new RetrieveHitsVO(
                    List.of(),
                    retrieveQueryResolver.resolveEmptyResultStrategy(scoped, perLibrarySettings),
                    null);
        }

        RetrieveQueryResolver.Resolution resolution = retrieveQueryResolver.resolveAll(
                new RetrieveQueryResolver.RetrieveContext(
                        request.question(),
                        scoped,
                        perLibrarySettings,
                        new RetrieveQueryResolver.ParamOverride(
                                request.topK(), request.threshold(), null, null, null),
                        enginePort.capabilities(),
                        // Wave D：问答热路径固定 AUTO —— 用内存快照，不做版本校验
                        SynonymMode.AUTO,
                        filteredDocumentIds,
                        filter.hasAnyCondition()));

        // WD-06：expansion 在问答链路里【只能进日志】，绝不进 RetrieveHitsVO
        if (log.isDebugEnabled()) {
            log.debug("问答检索同义词扩展 libraryIds={} status={} usedGroups={}/{} truncated={}",
                    scoped,
                    resolution.expansion().status(),
                    resolution.expansion().usedGroups(),
                    resolution.expansion().totalMatchedGroups(),
                    resolution.expansion().truncated());
        }

        List<ChunkHit> hits = enginePort.retrieve(resolution.query());
        Map<Long, String> docTitles = loadDocTitles(scoped);
        List<ChunkHitVO> vos = hits.stream()
                .map(h -> new ChunkHitVO(
                        h.libraryId(), h.documentId(), h.chunkText(), h.score(),
                        // 引擎已给出标题时优先用引擎值，否则回落本地文档标题
                        h.docTitle() != null ? h.docTitle() : docTitles.get(h.documentId()),
                        h.offset(), h.page()))
                .toList();
        return new RetrieveHitsVO(
                vos,
                resolution.effectiveParams().emptyResultStrategy(),
                EffectiveParamsVO.from(resolution.effectiveParams()));
    }

    /**
     * 批量加载库级 RAG 设置。
     *
     * <p>一次 {@code findAllById} 取全，避免按库循环查库（scoped 可能有几十个）。
     * 解析失败或从未配置的库不放进 map，合并器会自动回落全局默认。
     *
     * @param libraryIds 库 id 列表
     * @return 库 id → 库级设置
     */
    private Map<Long, RagSettings> loadSettings(List<Long> libraryIds) {
        if (libraryIds == null || libraryIds.isEmpty()) {
            return Map.of();
        }
        Map<Long, RagSettings> out = new HashMap<>();
        for (KbLibrary lib : libraryRepository.findAllById(libraryIds)) {
            RagSettings stored = KbJson.readSettings(lib.getRagSettingsJson());
            if (stored != null) {
                out.put(lib.getId(), stored.withDefaults());
            }
        }
        return out;
    }

    private Map<Long, String> loadDocTitles(List<Long> libraryIds) {
        if (libraryIds == null || libraryIds.isEmpty()) {
            return Map.of();
        }
        List<KbDocument> docs = documentRepository.findByLibraryIdIn(libraryIds);
        return docs.stream().collect(Collectors.toMap(
                KbDocument::getId, KbDocument::getTitle, (a, b) -> a));
    }

    // ---------------------------------------------------------------- 过滤解析（KE-08/KE-09）

    /**
     * 把文档/时间过滤解析为具体的 MIS 文档 id 集（KE-08/KE-09）。
     *
     * <p>解析规则（设计 §1.5 / R5）：
     * <ul>
     *   <li>无条件过滤 → 返回空集（适配器不下发 {@code document_ids} 键 = 全量）；</li>
     *   <li>按库 + {@code enabled=1} + 显式 id 集 + {@code created_at} 时间范围取交集；
     *       显式 id 集为空时传 {@code null} 给仓储（空 List 在 JPQL 里恒假，会误伤全量）；</li>
     *   <li>解析结果为空 = 过滤条件无命中，仍按 R5「不下发键」处理（不产生空结果死路）。</li>
     * </ul>
     *
     * @param scopedLibraryIds 可见库 id 集
     * @param filter           文档过滤条件（文档 id 集 + 上传时间范围）
     * @return 命中的启用文档 id 列表；恒非 {@code null}
     */
    private List<Long> resolveFilteredDocumentIds(
            List<Long> scopedLibraryIds, KbDocumentFilter filter) {
        if (filter == null || !filter.hasAnyCondition()) {
            return List.of();
        }
        if (scopedLibraryIds == null || scopedLibraryIds.isEmpty()) {
            return List.of();
        }
        // 显式 id 集为空 → null（JPQL :explicitIds is null 分支 = 不限制 id）
        List<Long> explicitIds = filter.safeDocumentIds().isEmpty()
                ? null : filter.safeDocumentIds();
        return documentRepository.findEnabledIdsByFilter(
                scopedLibraryIds, explicitIds, filter.uploadFrom(), filter.uploadTo());
    }
}
