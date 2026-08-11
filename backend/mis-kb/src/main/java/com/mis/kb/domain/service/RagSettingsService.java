package com.mis.kb.domain.service;

import com.mis.kb.api.dto.AclSummaryVO;
import com.mis.kb.api.dto.KbLibraryDetailVO;
import com.mis.kb.api.dto.KbLibraryVO;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.model.EmptyResultStrategy;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowProperties;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Set;

/**
 * RAG 设置读写与引擎同步（L-08，依赖 X-03 修复）。
 *
 * <p>与 {@link KbLibraryService#update} 的分工：那里是「改库元信息时顺带同步设置」，
 * 这里是「专门的 RAG 参数面板」——独立端点、独立校验、保存后<b>强制</b>同步引擎。
 *
 * <p><b>同步失败的处理口径（重要）：</b>本地落库成功但引擎同步失败时，
 * <b>不回滚本地事务</b>，而是记 error 日志并把异常吞掉。理由：
 * <ul>
 *   <li>引擎（RAGFlow）是外部系统，抖动属常态；因它不可用就让管理员连参数都存不下来，可用性代价过高；</li>
 *   <li>本地是配置的<b>唯一事实源</b>，下次任意一次保存都会重新全量下发，具备自愈能力；</li>
 *   <li>检索链路读的是本地设置（{@link com.mis.kb.domain.model.RetrieveQuery} 覆盖），
 *       引擎侧未同步只影响引擎内建的默认召回行为，不影响 MIS 主链路正确性。</li>
 * </ul>
 * 该口径需在前端提示「已保存，引擎同步失败将自动重试」，并作为 QA 验证点之一。
 */
@Service
public class RagSettingsService {

    private static final Logger log = LoggerFactory.getLogger(RagSettingsService.class);

    /** 合法的检索方式码值。 */
    private static final Set<String> VALID_RETRIEVAL_METHODS = Set.of("vector", "keyword", "hybrid");

    private final KbLibraryRepository libraryRepository;
    private final KbAclRepository aclRepository;
    private final KbDocumentRepository documentRepository;
    private final KnowledgeEnginePort enginePort;
    private final RagflowProperties engineProperties;

    public RagSettingsService(
            KbLibraryRepository libraryRepository,
            KbAclRepository aclRepository,
            KbDocumentRepository documentRepository,
            KnowledgeEnginePort enginePort,
            RagflowProperties engineProperties) {
        this.libraryRepository = libraryRepository;
        this.aclRepository = aclRepository;
        this.documentRepository = documentRepository;
        this.enginePort = enginePort;
        this.engineProperties = engineProperties;
    }

    /**
     * 读取知识库生效的 RAG 设置。
     *
     * @param libraryId 知识库 id
     * @return 已用默认值补齐的设置（永不为 {@code null}）
     */
    @Transactional(readOnly = true)
    public RagSettings get(Long libraryId) {
        KbLibrary lib = require(libraryId);
        RagSettings stored = KbJson.readSettings(lib.getRagSettingsJson());
        return stored == null ? RagSettings.defaults() : stored.withDefaults();
    }

    /**
     * 保存 RAG 设置并同步引擎（L-08）。
     *
     * @param libraryId 知识库 id
     * @param settings  待保存设置
     * @return 落库后生效的设置
     */
    @Transactional
    public RagSettings save(Long libraryId, RagSettings settings) {
        KbLibrary lib = require(libraryId);
        RagSettings effective = enforceRerankAvailability(validate(settings).withDefaults(), libraryId);

        lib.setRagSettingsJson(KbJson.writeSettings(effective));
        lib.setUpdatedAt(Instant.now());
        KbLibrary saved = libraryRepository.save(lib);

        syncToEngine(saved, effective);
        return effective;
    }

    /**
     * 知识库详情聚合（L-06）。
     *
     * @param libraryId 知识库 id
     * @return 基本信息 + 文档数 + 授权摘要 + RAG 设置
     */
    @Transactional(readOnly = true)
    public KbLibraryDetailVO detail(Long libraryId) {
        KbLibrary lib = require(libraryId);
        RagSettings stored = KbJson.readSettings(lib.getRagSettingsJson());
        RagSettings effective = stored == null ? RagSettings.defaults() : stored.withDefaults();
        long docCount = documentRepository.countByLibraryId(libraryId);
        List<AclSummaryVO> acls = aclRepository.findByLibraryId(libraryId).stream()
                .map(RagSettingsService::toAclSummary)
                .toList();
        // T03：KbLibraryVO 末位追加 5 字段。engineSyncFailed / engineSyncMessage 是
        // 「本次 update 调用的瞬时结果」，详情接口恒传 null（口径见 KbLibraryVO 类级说明）。
        KbLibraryVO meta = new KbLibraryVO(
                lib.getId(), lib.getCategoryId(), lib.getName(), lib.getSecrecy(), lib.getStatus(),
                lib.getOwner(), lib.getEngineType(), effective, docCount,
                lib.getCreatedAt(), lib.getUpdatedAt(),
                lib.getEngineSyncStatus(), lib.getEngineCheckedAt(), lib.getArchivedAt(),
                null, null);
        return new KbLibraryDetailVO(meta, docCount, acls, effective);
    }

    // ---------------------------------------------------------------- 内部

    /**
     * 参数校验。
     *
     * <p>只拦截「会让检索行为异常」的取值，不做过度约束：
     * embeddingModel/separator 属自由文本，交给引擎判断。
     *
     * <p><b>本方法只校验不改写</b>（主理人约束②）。尤其是
     * {@code vectorSimilarityWeight}：即便当前 {@code retrievalMethod} 不是 hybrid，
     * 也<b>原样保留</b>用户设的值——「vector→1.0 / keyword→0.0」的强制覆写只属于
     * 检索期合并阶段（{@link com.mis.kb.domain.model.RetrieveQueryResolver} S3），
     * 不得污染持久化值。否则用户「设 0.4 → 切 vector 保存 → 切回 hybrid」时权重会被吃掉。
     */
    private RagSettings validate(RagSettings settings) {
        if (settings == null) {
            return RagSettings.defaults();
        }
        if (settings.topK() != null && (settings.topK() < 1 || settings.topK() > 100)) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        // WA-01：向量相似度权重必须落在 [0,1]；越界直接拒绝，不做静默截断
        if (settings.vectorSimilarityWeight() != null
                && (settings.vectorSimilarityWeight() < 0D || settings.vectorSimilarityWeight() > 1D)) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        if (settings.scoreThreshold() != null
                && (settings.scoreThreshold() < 0D || settings.scoreThreshold() > 1D)) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        // chunkTokenNum 有效区间 [256, 4096]（与 DocumentChunkConfig.MIN/MAX_TOKEN_NUM 同源，
        // 设计 §3.2.2「常量唯一事实源」）；下限 256 起，低于 256 切片过碎直接拒绝
        if (settings.chunkTokenNum() != null
                && (settings.chunkTokenNum() < DocumentChunkConfig.MIN_TOKEN_NUM
                    || settings.chunkTokenNum() > DocumentChunkConfig.MAX_TOKEN_NUM)) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        if (settings.retrievalMethod() != null && !settings.retrievalMethod().isBlank()
                && !VALID_RETRIEVAL_METHODS.contains(settings.retrievalMethod().trim().toLowerCase())) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        if (settings.chunkMethod() != null && !settings.chunkMethod().isBlank()
                && !DocumentChunkConfig.isValidChunkMethod(settings.chunkMethod())) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        if (settings.emptyResultStrategy() != null && !settings.emptyResultStrategy().isBlank()
                && !EmptyResultStrategy.isValid(settings.emptyResultStrategy())) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        return settings;
    }

    /**
     * 重排可用性收敛（WA-06 演进 + kb_settings_model_chunk，Rerank 三道防线的第一道）。
     *
     * <p>kb_settings_model_chunk 后重排模型可以<b>库级</b>（{@code rerankModelId}），但
     * <b>全局模型仍是开关闸门</b>（设计 U3：库级 rerankModelId 仅在有全局模型时参与合并链；
     * PRD R-P0-05 验收「全局未配置 → 现有置灰逻辑不变」）。因此这里仍以
     * {@code mis.kb.engine.rerank-model-id} 是否配置为判据：未配全局却让 {@code rerank=true}
     * 落库，会造成「界面显示已开启、实际检索永远不重排」的静默偏差——保存时直接改写为
     * {@code false} 并记 WARN。
     *
     * <p>为什么是<b>静默强制</b>而不是抛错：用户可能只是在改别的参数，顺带把历史遗留的
     * {@code rerank=true} 带上来；为此整单保存失败属于误伤。前端另有置灰 + 理由文案
     * （第二道防线），检索期合并器还会再判一次（第三道），三道口径一致。
     *
     * @param settings  已校验并补齐默认值的设置
     * @param libraryId 知识库 id（仅用于日志定位）
     * @return 重排开关已收敛的设置
     */
    private RagSettings enforceRerankAvailability(RagSettings settings, Long libraryId) {
        if (!Boolean.TRUE.equals(settings.rerank()) || engineProperties.hasRerankModel()) {
            return settings;
        }
        log.warn("未配置全局重排模型（mis.kb.engine.rerank-model-id 为空），"
                + "已强制关闭该库的 rerank 开关 libraryId={}", libraryId);
        return new RagSettings(
                settings.topK(),
                settings.scoreThreshold(),
                Boolean.FALSE,
                settings.embeddingModel(),
                settings.retrievalMethod(),
                settings.chunkMethod(),
                settings.chunkTokenNum(),
                settings.separator(),
                settings.emptyResultStrategy(),
                settings.vectorSimilarityWeight(),
                settings.rerankModelId());
    }

    /**
     * 同步设置到引擎。
     *
     * <p>停用库与无引擎映射的库直接跳过；失败只记日志不抛出（口径见类级 Javadoc）。
     */
    private void syncToEngine(KbLibrary lib, RagSettings settings) {
        if (lib.getEngineLibraryRef() == null) {
            log.debug("知识库无引擎映射，跳过 RAG 设置同步 libraryId={}", lib.getId());
            return;
        }
        if (lib.getStatus() == null || !LibraryStatus.isEnabled(lib.getStatus())) {
            log.debug("知识库已停用，跳过 RAG 设置同步 libraryId={}", lib.getId());
            return;
        }
        try {
            enginePort.updateLibrarySettings(
                    new EngineLibraryRef(lib.getEngineType(), lib.getEngineLibraryRef()), settings);
            log.info("RAG 设置已同步至引擎 libraryId={} engineType={}", lib.getId(), lib.getEngineType());
        } catch (Exception e) {
            // 不回滚本地事务：本地是唯一事实源，下次保存会重新全量下发
            log.error("RAG 设置同步引擎失败（本地已保存，将在下次保存时重试）libraryId={}: {}",
                    lib.getId(), e.getMessage(), e);
        }
    }

    private KbLibrary require(Long libraryId) {
        return libraryRepository.findById(libraryId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_LIBRARY_NOT_FOUND));
    }

    private static AclSummaryVO toAclSummary(KbAcl acl) {
        return new AclSummaryVO(acl.getSubjectType(), acl.getSubjectId(), acl.getAction());
    }
}
