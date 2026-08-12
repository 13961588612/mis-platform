package com.mis.kb.domain.service;

import com.mis.kb.api.dto.ChunkHitVO;
import com.mis.kb.api.dto.EffectiveParamsVO;
import com.mis.kb.api.dto.HitTestRequest;
import com.mis.kb.api.dto.HitTestResultVO;
import com.mis.kb.api.dto.SynonymExpansionVO;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.AclAction;
import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.KbDocumentFilter;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQueryResolver;
import com.mis.kb.domain.model.SynonymMode;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 命中测试领域服务（Q-04 / WA-07）。
 *
 * <p>给知识管理员用的<b>调参工具</b>：输入一个问题，看这个库当前（或临时覆盖后）的参数
 * 能召回哪些 chunk、分数多少、来自哪篇文档。它复用与问答完全相同的检索链路
 * （同一个 {@link RetrieveQueryResolver}、同一个 {@link KnowledgeEnginePort}），
 * 否则「测的时候好好的、真问答又不一样」，这工具就没有存在价值。
 *
 * <p><b>三条硬约束（设计文档 T08）：</b>
 * <ol>
 *   <li><b>单库</b>——多库会让参数回落全局默认，测不出该库的真实行为；</li>
 *   <li><b>强制 ACL</b>——必须过 {@link KbVisibilityService#hasPermission}。命中测试能看到
 *       chunk 原文，等于直接读库内容，绝不能因为「这是个管理工具」就绕过授权；
 *       {@code kb:hittest:run} 权限码只管「能不能用这个功能」，管不了「能看哪个库」；</li>
 *   <li><b>不落问答记录</b>——{@code kb_qa_session} / {@code kb_qa_message} /
 *       {@code kb_qa_citation} / {@code kb_qa_feedback} / {@code kb_qa_ticket}
 *       一行都不许写。调参产生的噪声混进问答运营看板，会直接污染评价统计。
 *       故本类<b>不注入任何 kb_qa_* 仓储</b>，从依赖上就断掉写入可能。</li>
 * </ol>
 *
 * <p><b>审计口径：</b>命中测试可读跨密级库的 chunk 原文，属敏感操作，必须留痕。
 * 留痕在 BFF 端点用 {@code @OperLog} 走既有审计链路（落 audit 表），
 * 与「禁写 kb_qa_*」不冲突——两者是不同的表、不同的用途。
 *
 * <p><b>错误处理：</b>引擎失败<b>抛出</b>而非吞掉（§7.5-6）。调参工具必须给真实反馈，
 * 静默返回空结果会让管理员以为是参数不好，白白浪费半天去调阈值。
 *
 * <p><b>Wave D 增量（WD-06 / WD-11 / WD-19）：三条既有硬约束原样不动</b>，只多两件事：
 * <ol>
 *   <li>按 {@code request.disableSynonym()} 决定 {@link SynonymMode}：
 *       勾选「本次不使用」→ {@link SynonymMode#OFF_THIS_RUN}，否则 {@link SynonymMode#FRESH}。
 *       <b>为什么默认是 FRESH 而不是 AUTO</b>：命中测试要兑现 Q7「已保存，可立即在命中测试中验证」，
 *       走热路径的 3 秒最终一致快照会让管理员刚存的词在这里「时灵时不灵」，
 *       那是最难解释、也最挫伤信任的一类现象；</li>
 *   <li>把 {@code resolution.expansion()} 映射进 {@link HitTestResultVO#synonym()} ——
 *       <b>本服务是全平台唯一被允许回显扩展轨迹的出口</b>。</li>
 * </ol>
 *
 * <p><b>⛔ 本次禁用 ≠ 关全局开关：</b>{@code OFF_THIS_RUN} 只让本次请求短路，
 * 绝不触碰 {@code kb_synonym_config.enabled}。本服务<b>不注入</b>
 * {@code SynonymConfigService}，从依赖上就断掉误改全局开关的可能——
 * 与「不注入 kb_qa_* 仓储」是同一个手法。
 */
@Service
public class KbHitTestService {

    private static final Logger log = LoggerFactory.getLogger(KbHitTestService.class);

    private final KbLibraryRepository libraryRepository;
    private final KbDocumentRepository documentRepository;
    private final KbVisibilityService visibilityService;
    private final KnowledgeEnginePort enginePort;
    private final RetrieveQueryResolver retrieveQueryResolver;

    public KbHitTestService(
            KbLibraryRepository libraryRepository,
            KbDocumentRepository documentRepository,
            KbVisibilityService visibilityService,
            KnowledgeEnginePort enginePort,
            RetrieveQueryResolver retrieveQueryResolver) {
        this.libraryRepository = libraryRepository;
        this.documentRepository = documentRepository;
        this.visibilityService = visibilityService;
        this.enginePort = enginePort;
        this.retrieveQueryResolver = retrieveQueryResolver;
    }

    /**
     * 执行一次命中测试。
     *
     * @param request 测试请求（单库 + 问题 + 可选临时覆盖参数）
     * @param userId  当前用户 id（由 {@code X-User-Id} 解析，不信任请求体）
     * @return 命中结果 + 生效参数 + 耗时 + 空结果策略
     * @throws KbBusinessException 库不存在（{@code KB_LIBRARY_NOT_FOUND}）、
     *                             无读权限（{@code KB_NO_READ_PERMISSION}）、
     *                             引擎调用失败（透传引擎异常）
     */
    @Transactional(readOnly = true)
    public HitTestResultVO run(HitTestRequest request, Long userId) {
        Long libraryId = request.libraryId();
        KbLibrary library = libraryRepository.findById(libraryId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));

        // ACL 强制校验：复用可见性服务的同一套口径，不另写一份判断逻辑
        if (!visibilityService.hasPermission(userId, libraryId, AclAction.READ.code())) {
            log.warn("命中测试被拒：用户无该库读权限 userId={} libraryId={}", userId, libraryId);
            throw new KbBusinessException(KbResultCode.KB_NO_READ_PERMISSION);
        }

        RagSettings stored = KbJson.readSettings(library.getRagSettingsJson());
        RagSettings baseSettings = (stored == null ? RagSettings.defaults() : stored.withDefaults());
        // Wave B（T03）：临时开关 enableGraph（null = 跟随库设置）→ override 图谱开关。
        // 只影响本次检索的内存值，绝不落库（对照实验语义）；降级判定（能力/单库/
        // kgBuildStatus）仍由 RetrieveQueryResolver S4.5 统一完成（Resolver 铁律 §10-9）。
        Boolean graphOverride = request.graphOverride();
        if (graphOverride != null) {
            baseSettings = baseSettings.withGraphOverride(graphOverride);
            log.debug("命中测试图谱开关 override libraryId={} enableGraph={}", libraryId, graphOverride);
        }
        // Wave C（T03）：临时开关 enableRaptor（null = 跟随库设置）→ override RAPTOR 开关。
        // 只影响本次检索的内存值，绝不落库（对照实验语义）；降级判定（能力/建树状态）
        // 仍由 RetrieveQueryResolver S4.6 统一完成（Resolver 铁律 §10-9）。
        // ⚠ 检索期零回归：引擎建树后 /retrieval 自动融合摘要，本 override 只影响 S4.6
        // 降级判定与回显（「库已建树 / 未建树」），不改检索请求体。
        Boolean raptorOverride = request.raptorOverride();
        if (raptorOverride != null) {
            baseSettings = baseSettings.withRaptorOverride(raptorOverride);
            log.debug("命中测试 RAPTOR 开关 override libraryId={} enableRaptor={}", libraryId, raptorOverride);
        }
        Map<Long, RagSettings> perLibrarySettings = Map.of(libraryId, baseSettings);

        // Wave D：本次禁用 → 短路不查词典；否则强一致（先校验词表版本）——Q7 的兑现点
        SynonymMode synonymMode = request.synonymDisabledForThisRun()
                ? SynonymMode.OFF_THIS_RUN
                : SynonymMode.FRESH;

        // KE-08/KE-09：解析文档/时间过滤 → 具体 MIS 文档 id 集（空 = 不过滤，R5）
        KbDocumentFilter filter = new KbDocumentFilter(
                request.documentIds(), request.uploadFrom(), request.uploadTo());
        List<Long> filteredDocumentIds = resolveFilteredDocumentIds(libraryId, filter);

        RetrieveQueryResolver.Resolution resolution = retrieveQueryResolver.resolveAll(
                new RetrieveQueryResolver.RetrieveContext(
                        request.question(),
                        List.of(libraryId),
                        perLibrarySettings,
                        new RetrieveQueryResolver.ParamOverride(
                                request.topK(),
                                request.threshold(),
                                request.retrievalMethod(),
                                request.vectorSimilarityWeight(),
                                request.rerank()),
                        enginePort.capabilities(),
                        synonymMode,
                        filteredDocumentIds,
                        filter.hasAnyCondition()));

        long startedAt = System.nanoTime();
        List<ChunkHit> hits = enginePort.retrieve(resolution.query());
        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000L;

        Map<Long, String> docTitles = loadDocTitles(libraryId);
        List<ChunkHitVO> vos = hits.stream()
                .map(h -> new ChunkHitVO(
                        h.libraryId() != null ? h.libraryId() : libraryId,
                        h.documentId(),
                        h.chunkText(),
                        h.score(),
                        h.docTitle() != null ? h.docTitle() : docTitles.get(h.documentId()),
                        h.offset(),
                        h.page()))
                .toList();

        log.info("命中测试完成 libraryId={} userId={} hits={} elapsedMs={} source={} degraded={} "
                        + "synonymMode={} synonymStatus={} synonymUsedGroups={}",
                libraryId, userId, vos.size(), elapsedMs,
                resolution.effectiveParams().source(),
                resolution.effectiveParams().degradedReasons(),
                synonymMode,
                resolution.expansion().status(),
                resolution.expansion().usedGroups());

        return new HitTestResultVO(
                vos,
                EffectiveParamsVO.from(resolution.effectiveParams()),
                elapsedMs,
                resolution.effectiveParams().emptyResultStrategy(),
                resolution.effectiveParams().degraded(),
                SynonymExpansionVO.from(resolution.expansion()));
    }

    /** 加载该库文档标题，用于引擎未给出文档名时回填。 */
    private Map<Long, String> loadDocTitles(Long libraryId) {
        List<KbDocument> docs = documentRepository.findByLibraryIdIn(List.of(libraryId));
        return docs.stream().collect(Collectors.toMap(
                KbDocument::getId, KbDocument::getTitle, (a, b) -> a));
    }

    // ---------------------------------------------------------------- 过滤解析（KE-08/KE-09）

    /**
     * 把文档/时间过滤解析为具体的 MIS 文档 id 集（KE-08/KE-09，口径同 {@code KbRetrieveService}）。
     *
     * <p>按库 + {@code enabled=1} + 显式 id 集 + {@code created_at} 时间范围取交集；
     * 无条件过滤返回空集（适配器不下发 {@code document_ids} 键 = 全量，R5）。
     *
     * @param libraryId 目标库 id（单库）
     * @param filter    文档过滤条件（文档 id 集 + 上传时间范围）
     * @return 命中的启用文档 id 列表；恒非 {@code null}
     */
    private List<Long> resolveFilteredDocumentIds(Long libraryId, KbDocumentFilter filter) {
        if (filter == null || !filter.hasAnyCondition()) {
            return List.of();
        }
        List<Long> explicitIds = filter.safeDocumentIds().isEmpty()
                ? null : filter.safeDocumentIds();
        return documentRepository.findEnabledIdsByFilter(
                List.of(libraryId), explicitIds, filter.uploadFrom(), filter.uploadTo());
    }
}
