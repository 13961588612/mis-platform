package com.mis.kb.domain.service;

import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.AclSummaryVO;
import com.mis.kb.api.dto.KbLibraryDetailVO;
import com.mis.kb.api.dto.KbLibraryVO;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.model.EmptyResultStrategy;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RaptorConfig;
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
    private final KbGraphService graphService;
    private final KbRaptorService raptorService;

    public RagSettingsService(
            KbLibraryRepository libraryRepository,
            KbAclRepository aclRepository,
            KbDocumentRepository documentRepository,
            KnowledgeEnginePort enginePort,
            RagflowProperties engineProperties,
            KbGraphService graphService,
            KbRaptorService raptorService) {
        this.libraryRepository = libraryRepository;
        this.aclRepository = aclRepository;
        this.documentRepository = documentRepository;
        this.enginePort = enginePort;
        this.engineProperties = engineProperties;
        this.graphService = graphService;
        this.raptorService = raptorService;
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
     * 保存 RAG 设置并同步引擎（L-08；Wave B 增加图谱开关联动；Wave C 增加 RAPTOR 联动）。
     *
     * <p><b>图谱开关联动（U2 裁定：开关 false→true 保存时自动触发一次构图）：</b>
     * 检测到 {@code useKnowledgeGraph} 从 {@code false}→{@code true} 且
     * {@code kgBuildStatus != building} 时，保存成功后调用 {@code KbGraphService.build}
     * 自动排队构图。构图失败<b>不阻断保存</b>（设置已落库，可手动「开始构建」重试）。
     * 引擎侧构图只排队任务并立即返回，保存响应不会等构图完成（构建过程走 3s 轮询）。
     *
     * <p><b>RAPTOR 开关联动（U2 同款裁定，Wave C）：</b>检测到 {@code useRaptor} 从
     * {@code false}→{@code true} 且 {@code raptorBuildStatus != building} 时，保存成功后
     * 调用 {@code KbRaptorService.build} 自动排队构建。graph/raptor <b>可并行</b>
     * （T00 P2c 实测），两个自动触发互不干扰。
     *
     * @param libraryId 知识库 id
     * @param settings  待保存设置
     * @return 落库后生效的设置
     */
    @Transactional
    public RagSettings save(Long libraryId, RagSettings settings) {
        KbLibrary lib = require(libraryId);
        RagSettings oldEffective = get(libraryId);
        // 三道防线第二道（保存强制关）：rerank → graph → raptor 依次收敛；
        // 引擎不支持的能力开关一律静默强制 false（前端置灰是第一道，检索期降级是第三道）
        RagSettings validated = enforceGraphAvailability(
                enforceRaptorAvailability(
                        enforceRerankAvailability(validate(settings).withDefaults(), libraryId),
                        libraryId),
                libraryId);
        // 服务端维护图谱/RAPTOR 状态字段：请求里的 kgBuildStatus/kgBuildMessage 与
        // raptorBuildStatus/raptorBuildMessage 一律忽略（仅回显），以 DB 里的服务端事实为准
        // （设计 §5.1）——防客户端脏写把状态改成 building/ready。
        validated = withServerGraphState(validated, oldEffective);
        // 上限校验（保存与构图共用 KbGraphService.canEnableGraph）：开启图谱且已达上限 → 拒
        if (Boolean.TRUE.equals(validated.useKnowledgeGraph())) {
            graphService.canEnableGraph(libraryId);
        }
        // false→true 且非 building → 保存后自动触发构图（U2：自动触发一次）
        boolean autoBuild = !Boolean.TRUE.equals(oldEffective.useKnowledgeGraph())
                && Boolean.TRUE.equals(validated.useKnowledgeGraph())
                && !RagSettings.KG_STATUS_BUILDING.equals(oldEffective.kgBuildStatus());
        // RAPTOR 同款：false→true 且非 building → 保存后自动触发构建（U2；与构图可并行）
        boolean autoRaptorBuild = !Boolean.TRUE.equals(oldEffective.useRaptor())
                && Boolean.TRUE.equals(validated.useRaptor())
                && !RagSettings.RAPTOR_STATUS_BUILDING.equals(oldEffective.raptorBuildStatus());

        lib.setRagSettingsJson(KbJson.writeSettings(validated));
        lib.setUpdatedAt(Instant.now());
        KbLibrary saved = libraryRepository.save(lib);

        syncToEngine(saved, validated);
        boolean anyAutoBuild = false;
        if (autoBuild) {
            triggerAutoBuild(libraryId);
            anyAutoBuild = true;
        }
        if (autoRaptorBuild) {
            triggerRaptorAutoBuild(libraryId);
            anyAutoBuild = true;
        }
        if (anyAutoBuild) {
            // 自动触发后重新读取：构图/RAPTOR 排队成功会回写 building，
            // 返回给前端的状态必须反映落库事实——否则前端看不到 building，3s 轮询无法启动
            // （若触发失败，这里读到的是 none/failed，前端展示「未构建」+ 手动按钮重试）。
            RagSettings after = KbJson.readSettings(
                    libraryRepository.findById(libraryId).orElse(saved).getRagSettingsJson());
            return after == null ? validated : after.withDefaults();
        }
        return validated;
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
        // KE-06/KE-07：OCR/overlap 校验（只校验不改写）。当前引擎不支持时仍允许保存
        // （落库 + 回显 + 提示，设计 §1.4 降级路径），但非法取值直接拒绝。
        if (settings.chunkOverlapTokenNum() != null && settings.chunkOverlapTokenNum() < 0) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        // 语言码值只认产品三档（zh/en/zh_en）：null = 缺省（前端不选时不发）；
        // 非 null 一律 trim+小写后比对，空白串/超集码值同样拒绝（不静默改写）。
        if (settings.ocrLanguage() != null) {
            String lang = settings.ocrLanguage().trim().toLowerCase();
            if (!RagSettings.OCR_LANGUAGE_ZH.equals(lang)
                    && !RagSettings.OCR_LANGUAGE_EN.equals(lang)
                    && !RagSettings.OCR_LANGUAGE_ZH_EN.equals(lang)) {
                throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
            }
        }
        // Wave B GraphRAG PoC（T02）：图谱字段校验（设计 §2.1）。
        // kgBuildStatus 只接受四态码值（防脏写，非法直接拒——withDefaults 的归一化兜底
        // 只适用于反序列化旧数据，保存入口必须显式拒非法值）；kgBuildMessage ≤200。
        // 注意：合法值也只是「不拒」——保存路径随后用服务端事实覆盖请求值（设计 §5.1）。
        if (settings.kgBuildStatus() != null && !settings.kgBuildStatus().isBlank()
                && !RagSettings.KG_STATUS_NONE.equals(settings.kgBuildStatus())
                && !RagSettings.KG_STATUS_BUILDING.equals(settings.kgBuildStatus())
                && !RagSettings.KG_STATUS_READY.equals(settings.kgBuildStatus())
                && !RagSettings.KG_STATUS_FAILED.equals(settings.kgBuildStatus())) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        if (settings.kgBuildMessage() != null && settings.kgBuildMessage().length() > 200) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        // Wave C RAPTOR（T02）：RAPTOR 字段校验（设计 §2.0 / T00 P1 实测）。
        // raptorBuildStatus 只接受四态码值（防脏写，口径同 kgBuildStatus）；raptorBuildMessage ≤200；
        // raptorMaxTokenNum ∈ [512,2048]（T00 P1b：4096 → 引擎 code:101 被拒，MIS 校验收窄对齐
        // 用户期望下限 512，常量见 RaptorConfig）；raptorThreshold ∈ [0,1]（含 0，T00 实测）；
        // raptorMaxCluster ∈ [1,1024]；raptorPrompt ≤2000（引擎不强制 {cluster_content} 占位符，
        // T00 P1g 实测）。越界一律直接拒（不做静默截断——与 chunkTokenNum 同口径）。
        if (settings.raptorBuildStatus() != null && !settings.raptorBuildStatus().isBlank()
                && !RagSettings.RAPTOR_STATUS_NONE.equals(settings.raptorBuildStatus())
                && !RagSettings.RAPTOR_STATUS_BUILDING.equals(settings.raptorBuildStatus())
                && !RagSettings.RAPTOR_STATUS_READY.equals(settings.raptorBuildStatus())
                && !RagSettings.RAPTOR_STATUS_FAILED.equals(settings.raptorBuildStatus())) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        if (settings.raptorBuildMessage() != null && settings.raptorBuildMessage().length() > 200) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        if (settings.raptorMaxTokenNum() != null
                && !RaptorConfig.isValidMaxTokenNum(settings.raptorMaxTokenNum())) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        if (settings.raptorThreshold() != null
                && !RaptorConfig.isValidThreshold(settings.raptorThreshold())) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        if (settings.raptorMaxCluster() != null
                && !RaptorConfig.isValidMaxCluster(settings.raptorMaxCluster())) {
            throw new KbBusinessException(KbResultCode.KB_RAG_SETTINGS_INVALID);
        }
        if (settings.raptorPrompt() != null
                && settings.raptorPrompt().length() > RaptorConfig.MAX_PROMPT_LENGTH) {
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
        // 24 参 canonical 透传图谱三字段与 RAPTOR 七字段（useKnowledgeGraph/kgBuildStatus/
        // kgBuildMessage/useRaptor/raptorMaxTokenNum/raptorThreshold/raptorMaxCluster/
        // raptorPrompt/raptorBuildStatus/raptorBuildMessage）——绝不能走 14 参旧构造，
        // 否则图谱/RAPTOR 字段被静默置 null（record 末位追加铁律 §10-8）
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
                settings.rerankModelId(),
                settings.ocrEnabled(),
                settings.ocrLanguage(),
                settings.chunkOverlapTokenNum(),
                settings.useKnowledgeGraph(),
                settings.kgBuildStatus(),
                settings.kgBuildMessage(),
                settings.useRaptor(),
                settings.raptorMaxTokenNum(),
                settings.raptorThreshold(),
                settings.raptorMaxCluster(),
                settings.raptorPrompt(),
                settings.raptorBuildStatus(),
                settings.raptorBuildMessage());
    }

    /**
     * 图谱可用性收敛（Wave B GraphRAG PoC，T02；三道防线第二道）。
     *
     * <p><b>与 {@link #enforceRerankAvailability} 同款静默强制口径：</b>
     * {@code useKnowledgeGraph=true} 但 {@code capabilities.graphrag=false} →
     * 落库强制 {@code false} + WARN（设计 §2.1）。为什么静默强制而非抛错：用户可能只是
     * 在改别的参数，顺带把历史遗留的开关带上来，整单保存失败属于误伤；前端另有置灰 +
     * 提示（第一道），构图入口还有 {@code KB_GRAPH_UNSUPPORTED}（第三道），三道口径一致。
     *
     * @param settings  已校验并补齐默认值的设置
     * @param libraryId 知识库 id（仅用于日志定位）
     * @return 图谱开关已收敛的设置
     */
    private RagSettings enforceGraphAvailability(RagSettings settings, Long libraryId) {
        if (!Boolean.TRUE.equals(settings.useKnowledgeGraph())) {
            return settings;
        }
        if (enginePort.capabilities().supports(EngineCapabilities.CAP_GRAPH)) {
            return settings;
        }
        log.warn("当前引擎不支持知识图谱（capabilities.graphrag=false），"
                + "已强制关闭该库的 useKnowledgeGraph libraryId={}", libraryId);
        // 24 参 canonical 保留其余字段（含 kgBuildStatus/kgBuildMessage 与 RAPTOR 七字段）
        return new RagSettings(
                settings.topK(),
                settings.scoreThreshold(),
                settings.rerank(),
                settings.embeddingModel(),
                settings.retrievalMethod(),
                settings.chunkMethod(),
                settings.chunkTokenNum(),
                settings.separator(),
                settings.emptyResultStrategy(),
                settings.vectorSimilarityWeight(),
                settings.rerankModelId(),
                settings.ocrEnabled(),
                settings.ocrLanguage(),
                settings.chunkOverlapTokenNum(),
                Boolean.FALSE,
                settings.kgBuildStatus(),
                settings.kgBuildMessage(),
                settings.useRaptor(),
                settings.raptorMaxTokenNum(),
                settings.raptorThreshold(),
                settings.raptorMaxCluster(),
                settings.raptorPrompt(),
                settings.raptorBuildStatus(),
                settings.raptorBuildMessage());
    }

    /**
     * RAPTOR 可用性收敛（Wave C RAPTOR，T02；三道防线第二道）。
     *
     * <p><b>与 {@link #enforceGraphAvailability} 同款静默强制口径：</b>
     * {@code useRaptor=true} 但 {@code capabilities.raptor=false} →
     * 落库强制 {@code false} + WARN（U4：无库数上限，只有能力/平台开关闸门）。
     * <b>U4 裁定：不设库数上限</b>——不存在 {@code KB_RAPTOR_LIBRARY_LIMIT}，
     * 这里只判能力 {@code raptor}（平台总开关 {@code mis.kb.engine.raptor-enabled}
     * 已在适配层折叠进 capabilities）。
     *
     * @param settings  已校验并补齐默认值的设置
     * @param libraryId 知识库 id（仅用于日志定位）
     * @return RAPTOR 开关已收敛的设置
     */
    private RagSettings enforceRaptorAvailability(RagSettings settings, Long libraryId) {
        if (!Boolean.TRUE.equals(settings.useRaptor())) {
            return settings;
        }
        if (enginePort.capabilities().supports(EngineCapabilities.CAP_RAPTOR)) {
            return settings;
        }
        log.warn("当前引擎不支持 RAPTOR（capabilities.raptor=false），"
                + "已强制关闭该库的 useRaptor libraryId={}", libraryId);
        // 24 参 canonical 保留其余字段（含图谱三字段与 RAPTOR 其余六字段）
        return new RagSettings(
                settings.topK(),
                settings.scoreThreshold(),
                settings.rerank(),
                settings.embeddingModel(),
                settings.retrievalMethod(),
                settings.chunkMethod(),
                settings.chunkTokenNum(),
                settings.separator(),
                settings.emptyResultStrategy(),
                settings.vectorSimilarityWeight(),
                settings.rerankModelId(),
                settings.ocrEnabled(),
                settings.ocrLanguage(),
                settings.chunkOverlapTokenNum(),
                settings.useKnowledgeGraph(),
                settings.kgBuildStatus(),
                settings.kgBuildMessage(),
                Boolean.FALSE,
                settings.raptorMaxTokenNum(),
                settings.raptorThreshold(),
                settings.raptorMaxCluster(),
                settings.raptorPrompt(),
                settings.raptorBuildStatus(),
                settings.raptorBuildMessage());
    }

    /**
     * 以服务端事实覆盖请求里的图谱/RAPTOR 状态字段（设计 §5.1：前端提交状态时忽略或仅回显）。
     *
     * <p>{@code kgBuildStatus}/{@code kgBuildMessage} 由 {@code KbGraphService} 维护、
     * {@code raptorBuildStatus}/{@code raptorBuildMessage} 由 {@code KbRaptorService}
     * 维护（触发写 building、状态查询映射 ready/failed 回写），保存请求里的值不可信——
     * 客户端若把状态改成 building/ready，会绕过状态机制造假状态。故保存时一律
     * 用 DB 旧值覆盖（{@code null} 兜底 {@code none}/{@code RAPTOR_STATUS_NONE}）。
     *
     * @param settings     本次待保存设置（图谱/RAPTOR 开关可能已改）
     * @param serverState  DB 里当前服务端事实（旧设置，已 withDefaults）
     * @return 图谱/RAPTOR 状态字段已收敛的设置（24 参 canonical 保留其余字段）
     */
    private RagSettings withServerGraphState(RagSettings settings, RagSettings serverState) {
        return new RagSettings(
                settings.topK(),
                settings.scoreThreshold(),
                settings.rerank(),
                settings.embeddingModel(),
                settings.retrievalMethod(),
                settings.chunkMethod(),
                settings.chunkTokenNum(),
                settings.separator(),
                settings.emptyResultStrategy(),
                settings.vectorSimilarityWeight(),
                settings.rerankModelId(),
                settings.ocrEnabled(),
                settings.ocrLanguage(),
                settings.chunkOverlapTokenNum(),
                settings.useKnowledgeGraph(),
                serverState.kgBuildStatus() == null
                        ? RagSettings.KG_STATUS_NONE : serverState.kgBuildStatus(),
                serverState.kgBuildMessage(),
                settings.useRaptor(),
                settings.raptorMaxTokenNum(),
                settings.raptorThreshold(),
                settings.raptorMaxCluster(),
                settings.raptorPrompt(),
                serverState.raptorBuildStatus() == null
                        ? RagSettings.RAPTOR_STATUS_NONE : serverState.raptorBuildStatus(),
                serverState.raptorBuildMessage());
    }

    /**
     * 保存后自动触发一次构图（U2 裁定；开关 false→true 且非 building）。
     *
     * <p><b>不阻塞保存返回：</b>引擎侧构图只排队任务并立即返回 {@code task_id}，
     * 故在本请求线程内完成排队是安全的；若引擎不可达/触发失败，捕获后记 WARN——
     * 设置已落库（kgBuildStatus=none），前端「开始构建」按钮可手动重试（R4 降级路径）。
     *
     * @param libraryId 知识库 id
     */
    private void triggerAutoBuild(Long libraryId) {
        Long userId = SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
        if (userId == null) {
            log.warn("图谱自动触发跳过：无法获取当前用户 libraryId={}（可手动触发）", libraryId);
            return;
        }
        try {
            graphService.build(libraryId, userId);
        } catch (Exception e) {
            log.warn("图谱自动触发失败（设置已保存，可手动重试）libraryId={}: {}",
                    libraryId, e.getMessage());
        }
    }

    /**
     * 保存后自动触发一次 RAPTOR 构建（U2 同款裁定；开关 false→true 且非 building）。
     *
     * <p><b>不阻塞保存返回：</b>引擎侧构建只排队任务并立即返回 {@code task_id}，
     * 故在本请求线程内完成排队是安全的；若引擎不可达/触发失败，捕获后记 WARN——
     * 设置已落库（raptorBuildStatus=none），前端「开始构建」按钮可手动重试（R4 降级路径）。
     * graph/raptor 构建<b>可并行</b>（T00 P2c 实测），与 {@link #triggerAutoBuild}
     * 互不干扰。
     *
     * @param libraryId 知识库 id
     */
    private void triggerRaptorAutoBuild(Long libraryId) {
        Long userId = SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
        if (userId == null) {
            log.warn("RAPTOR 自动触发跳过：无法获取当前用户 libraryId={}（可手动触发）", libraryId);
            return;
        }
        try {
            raptorService.build(libraryId, userId);
        } catch (Exception e) {
            log.warn("RAPTOR 自动触发失败（设置已保存，可手动重试）libraryId={}: {}",
                    libraryId, e.getMessage());
        }
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
