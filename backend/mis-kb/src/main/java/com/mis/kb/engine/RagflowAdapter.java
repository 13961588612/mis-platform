package com.mis.kb.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.ChunkQuery;
import com.mis.kb.domain.model.CreateLibraryCmd;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.model.DocumentChunkPageView;
import com.mis.kb.domain.model.DocumentChunkView;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineDocumentBrief;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.model.EngineLibraryBrief;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineModel;
import com.mis.kb.domain.model.EngineModelPool;
import com.mis.kb.domain.model.GraphBuildSnapshot;
import com.mis.kb.domain.model.ParseStatus;
import com.mis.kb.domain.model.ParseStatusSnapshot;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RaptorBuildSnapshot;
import com.mis.kb.domain.model.RetrieveQuery;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.dto.RfChunk;
import com.mis.kb.engine.dto.RfDataset;
import com.mis.kb.engine.dto.RfDocument;
import com.mis.kb.engine.dto.RfDocumentChunk;
import com.mis.kb.engine.dto.RfDocumentChunkPage;
import com.mis.kb.engine.dto.RfModel;
import com.mis.kb.engine.dto.RfSearchChunk;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * RAGFlow 真实适配器（HTTP 调 RAGFlow）。
 *
 * <p>负责 MIS ID ↔ RAGFlow 原生 id 的双向翻译：检索入参的 MIS libraryId → 原生 dataset id；
 * 检索出参的原生 document_id → MIS documentId/libraryId（由 repository 反查）。
 *
 * <p>本适配器<b>不做任何参数决策</b>——检索方式、权重、rerank 开关全部由
 * {@link com.mis.kb.domain.model.RetrieveQueryResolver} 在领域层合并完毕后随
 * {@link RetrieveQuery} 传入，这里只负责翻译 ID 与转发。
 */
public class RagflowAdapter implements KnowledgeEnginePort {

    public static final String ENGINE_TYPE = "ragflow";

    private static final Logger log = LoggerFactory.getLogger(RagflowAdapter.class);

    private final RagflowClient client;
    private final RagflowProperties props;
    private final KbLibraryRepository libraryRepository;
    private final KbDocumentRepository documentRepository;

    public RagflowAdapter(
            RagflowProperties props,
            RestClient.Builder restClientBuilder,
            KbLibraryRepository libraryRepository,
            KbDocumentRepository documentRepository) {
        this.props = props;
        this.client = new RagflowClient(restClientBuilder, props);
        this.libraryRepository = libraryRepository;
        this.documentRepository = documentRepository;
    }

    @Override
    public String engineType() {
        return ENGINE_TYPE;
    }

    /**
     * 在引擎侧创建 dataset（T02：按命名规范加工名字）。
     *
     * <p>引擎侧名字 = {@code {一级分类名}-{库名}-{MIS库ID后6位}}，加工完全封在本层，
     * 业务层传的仍是原始 MIS 库名。<b>MIS 侧 {@code kb_library.name} 不受影响。</b>
     *
     * @param cmd 建库命令（已带 {@code libraryId} 与 {@code topCategoryName}）
     * @return 引擎引用
     */
    @Override
    public EngineLibraryRef createLibrary(CreateLibraryCmd cmd) {
        String datasetName = RagflowDatasetNaming.forCreate(
                cmd.topCategoryName(), cmd.name(), cmd.libraryId());
        log.info("RAGFlow 建库：MIS 库名={} → dataset 名={}（libraryId={}）",
                cmd.name(), datasetName, cmd.libraryId());
        String datasetId = client.createDataset(datasetName);
        return new EngineLibraryRef(ENGINE_TYPE, datasetId);
    }

    @Override
    public void updateLibrarySettings(EngineLibraryRef ref, RagSettings settings) {
        client.updateDatasetSettings(ref.nativeId(), settings);
    }

    /**
     * 触发图谱构建（Wave B GraphRAG PoC，T02）。
     *
     * <p>前置校验（能力/上限/状态机/文档非空）由 {@code KbGraphService.build} 完成，
     * 本方法只负责翻译 MIS ref → 引擎 datasetId 并转发
     * {@code POST /datasets/{id}/index?type=graph}（type 值 = {@code graph}，禁写 graphrag）。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return 引擎侧构图任务 id
     */
    @Override
    public String buildGraph(EngineLibraryRef ref) {
        if (ref == null || ref.nativeId() == null || ref.nativeId().isBlank()) {
            throw new IllegalArgumentException("构图失败：知识库无引擎映射");
        }
        return client.buildGraph(ref.nativeId());
    }

    /**
     * 查询图谱构建状态（Wave B GraphRAG PoC，T02）。
     *
     * <p>把 RAGFlow task dict 映射为 {@link GraphBuildSnapshot}：
     * {@code progress==1.0 → READY}；{@code progress<0 → FAILED}；其他数值 → BUILDING；
     * 无任务/空 data → NONE（调用方保留本地状态）。{@code progress_msg} 摘要与
     * {@code process_duration} 原样透出，由 {@code KbGraphService} 决定是否落库。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return 构图状态快照；恒非 {@code null}
     */
    @Override
    public GraphBuildSnapshot queryGraphBuildStatus(EngineLibraryRef ref) {
        if (ref == null || ref.nativeId() == null || ref.nativeId().isBlank()) {
            return GraphBuildSnapshot.none();
        }
        JsonNode data;
        try {
            data = client.queryGraphBuildStatus(ref.nativeId());
        } catch (Exception e) {
            log.warn("RAGFlow 查询图谱构建状态失败 datasetId={}: {}", ref.nativeId(), e.getMessage());
            return GraphBuildSnapshot.none();
        }
        if (data == null || data.isEmpty()) {
            return GraphBuildSnapshot.none();
        }
        String taskId = data.path("task_id").asText(null);
        Double progress = data.path("progress").isNumber() ? data.path("progress").asDouble() : null;
        String progressMsg = data.path("progress_msg").asText(null);
        Long processDurationMs = data.path("process_duration").isNumber()
                ? (long) (data.path("process_duration").asDouble() * 1000D) : null;
        return new GraphBuildSnapshot(taskId, progress, mapGraphProgress(progress), progressMsg, processDurationMs);
    }

    /**
     * 触发 RAPTOR 摘要构建（Wave C RAPTOR，T02）。
     *
     * <p>前置校验（能力/状态机/文档非空）由 {@code KbRaptorService.build} 完成，
     * 本方法只负责翻译 MIS ref → 引擎 datasetId 并转发
     * {@code POST /datasets/{id}/index?type=raptor}（type 值 = {@code raptor}）。
     * graph/raptor 构建<b>不互斥可并行</b>（T00 P2c 实测）。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return 引擎侧 RAPTOR 构建任务 id
     */
    @Override
    public String buildRaptor(EngineLibraryRef ref) {
        if (ref == null || ref.nativeId() == null || ref.nativeId().isBlank()) {
            throw new IllegalArgumentException("RAPTOR 构建失败：知识库无引擎映射");
        }
        return client.buildRaptor(ref.nativeId());
    }

    /**
     * 查询 RAPTOR 构建状态（Wave C RAPTOR，T02）。
     *
     * <p>把 RAGFlow task dict 映射为 {@link RaptorBuildSnapshot}：
     * {@code progress==1.0 → READY}；{@code progress<0 → FAILED}；其他数值 → BUILDING；
     * 无任务/空 data → NONE（调用方保留本地状态）。{@code progress_msg} 摘要与
     * {@code process_duration} 原样透出，由 {@code KbRaptorService} 决定是否落库。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return RAPTOR 构建状态快照；恒非 {@code null}
     */
    @Override
    public RaptorBuildSnapshot queryRaptorBuildStatus(EngineLibraryRef ref) {
        if (ref == null || ref.nativeId() == null || ref.nativeId().isBlank()) {
            return RaptorBuildSnapshot.none();
        }
        JsonNode data;
        try {
            data = client.queryRaptorBuildStatus(ref.nativeId());
        } catch (Exception e) {
            log.warn("RAGFlow 查询 RAPTOR 构建状态失败 datasetId={}: {}", ref.nativeId(), e.getMessage());
            return RaptorBuildSnapshot.none();
        }
        if (data == null || data.isEmpty()) {
            return RaptorBuildSnapshot.none();
        }
        String taskId = data.path("task_id").asText(null);
        Double progress = data.path("progress").isNumber() ? data.path("progress").asDouble() : null;
        String progressMsg = data.path("progress_msg").asText(null);
        Long processDurationMs = data.path("process_duration").isNumber()
                ? (long) (data.path("process_duration").asDouble() * 1000D) : null;
        return new RaptorBuildSnapshot(taskId, progress, mapRaptorProgress(progress), progressMsg, processDurationMs);
    }

    /**
     * RAGFlow {@code progress} → {@link RaptorBuildSnapshot.Status}（T00 P2b 契约，与 graph 同构）。
     *
     * @param progress 引擎进度；{@code null} 按 NONE（无法判定，保留本地）
     * @return 映射后的状态
     */
    private static RaptorBuildSnapshot.Status mapRaptorProgress(Double progress) {
        if (progress == null) {
            return RaptorBuildSnapshot.Status.NONE;
        }
        if (Double.compare(progress, 1.0D) >= 0) {
            return RaptorBuildSnapshot.Status.READY;
        }
        if (progress < 0D) {
            return RaptorBuildSnapshot.Status.FAILED;
        }
        return RaptorBuildSnapshot.Status.BUILDING;
    }

    /**
     * RAGFlow {@code progress} → {@link GraphBuildSnapshot.Status}（T00 G3 契约）。
     *
     * @param progress 引擎进度；{@code null} 按 NONE（无法判定，保留本地）
     * @return 映射后的状态
     */
    private static GraphBuildSnapshot.Status mapGraphProgress(Double progress) {
        if (progress == null) {
            return GraphBuildSnapshot.Status.NONE;
        }
        if (Double.compare(progress, 1.0D) >= 0) {
            return GraphBuildSnapshot.Status.READY;
        }
        if (progress < 0D) {
            return GraphBuildSnapshot.Status.FAILED;
        }
        return GraphBuildSnapshot.Status.BUILDING;
    }

    /**
     * 删除引擎侧 dataset（Q1 两段式确认流的引擎侧动作）。
     *
     * <p>透传 {@link RagflowClient#deleteDataset}。当引擎侧 dataset 已不存在（HTTP 404，
     * 运维可能在 RAGFlow 控制台手工删除）时，客户端抛
     * {@link EngineDatasetMissingException}，本方法<b>原样上抛不拦截</b>——
     * 由 {@code KbLibraryService} 捕获后进入两段式确认流（force=false 提示态 /
     * force=true 跳过引擎直接本地执行）。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @throws EngineDatasetMissingException 引擎侧 dataset 已不存在（missing 信号，透传）
     * @throws BusinessException             引擎删除非 404 失败（透传，调用方回滚本地事务）
     */
    @Override
    public void deleteLibrary(EngineLibraryRef ref) {
        client.deleteDataset(ref.nativeId());
    }

    /**
     * 重命名引擎侧 dataset（T02：归档流程调用）。
     *
     * <p>透传 {@link RagflowClient#renameDataset}。当引擎侧 dataset 已不存在（HTTP 404 或
     * 业务响应命中缺失文案）时，客户端抛 {@link EngineDatasetMissingException}，
     * 本方法<b>原样上抛不拦截</b>——由 {@code KbLibraryService} 捕获后进入归档两段式确认流。
     *
     * @param ref     知识库引擎引用
     * @param newName 新名字（调用方已按 {@link RagflowDatasetNaming#forArchive} 加工）
     * @throws EngineDatasetMissingException 引擎侧 dataset 已不存在（missing 信号，透传）
     * @throws BusinessException             引擎改名非 missing 失败（透传，调用方记待对账）
     */
    @Override
    public void renameLibrary(EngineLibraryRef ref, String newName) {
        if (ref == null || ref.nativeId() == null || ref.nativeId().isBlank()) {
            log.warn("重命名知识库被跳过：引擎引用为空 newName={}", newName);
            return;
        }
        client.renameDataset(ref.nativeId(), newName);
        log.info("RAGFlow 已重命名 dataset：{} → {}", ref.nativeId(), newName);
    }

    /**
     * 列举引擎侧全部 dataset（T02：对账用）。
     *
     * <p>循环翻页直到「返回不足一页」或「触到 {@code reconcile.max-pages} 上限」。
     * 触顶时记 WARN 并返回<b>已拉到的部分</b>——对账服务据此仍能发现大部分差异，
     * 比直接抛异常导致整轮对账作废要好。
     *
     * @return dataset 摘要列表，恒非 {@code null}
     */
    @Override
    public List<EngineLibraryBrief> listLibraries() {
        int pageSize = props.getReconcile().effectivePageSize();
        int maxPages = props.getReconcile().effectiveMaxPages();
        List<EngineLibraryBrief> result = new ArrayList<>();
        for (int page = 1; page <= maxPages; page++) {
            List<RfDataset> batch = client.listDatasets(page, pageSize);
            for (RfDataset ds : batch) {
                result.add(new EngineLibraryBrief(
                        ds.id(),
                        ds.name(),
                        ds.documentCount(),
                        toInstant(ds.updateTime())));
            }
            if (batch.size() < pageSize) {
                return result;
            }
            if (page == maxPages) {
                log.warn("列举引擎知识库触到 max-pages={} 上限（pageSize={}，已拉取 {} 条），"
                                + "本轮对账结果可能不完整，请调大 mis.kb.engine.reconcile.max-pages",
                        maxPages, pageSize, result.size());
            }
        }
        return result;
    }

    /**
     * 列举引擎侧某 dataset 下的全部文档（T03：文档级对账用）。
     *
     * <p>循环翻页直到「返回不足一页」或「触到 {@code reconcile.max-pages} 上限」，与
     * {@link #listLibraries()} 同口径；触顶记 WARN 返回已拉到的部分。单库文档数通常不大，
     * 此处的分页主要为防御「某库挂了几万文档」的极端情况。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return 文档摘要列表，恒非 {@code null}
     */
    @Override
    public List<EngineDocumentBrief> listDocuments(EngineLibraryRef ref) {
        if (ref == null || ref.nativeId() == null || ref.nativeId().isBlank()) {
            return List.of();
        }
        int pageSize = props.getReconcile().effectivePageSize();
        int maxPages = props.getReconcile().effectiveMaxPages();
        List<EngineDocumentBrief> result = new ArrayList<>();
        for (int page = 1; page <= maxPages; page++) {
            List<RfDocument> batch;
            try {
                batch = client.listDocuments(ref.nativeId(), page, pageSize);
            } catch (Exception e) {
                log.warn("列举引擎文档失败 datasetId={}：{}", ref.nativeId(), e.getMessage());
                break;
            }
            if (batch == null || batch.isEmpty()) {
                break;
            }
            for (RfDocument d : batch) {
                if (d != null && StringUtils.hasText(d.id())) {
                    result.add(new EngineDocumentBrief(d.id(), d.name()));
                }
            }
            if (batch.size() < pageSize) {
                return result;
            }
        }
        return result;
    }

    /**
     * RAGFlow 的 {@code update_time} 毫秒时间戳 → {@link Instant}。
     *
     * @param epochMillis 毫秒时间戳，允许 {@code null}
     * @return 对应时刻；入参为 {@code null} 或非正数时返回 {@code null}
     */
    private static Instant toInstant(Long epochMillis) {
        if (epochMillis == null || epochMillis <= 0L) {
            return null;
        }
        return Instant.ofEpochMilli(epochMillis);
    }

    @Override
    public EngineDocumentRef uploadDocument(EngineLibraryRef ref, DocumentUploadInput input) {
        String docId = client.uploadDocument(ref.nativeId(), input);
        // kb_settings_model_chunk 两段式（T00 P5 实测）：有文件级切片参数时先 PUT 文档配置，
        // 再显式 POST /chunks 触发解析；PUT 本身不会自动重解析。
        if (input != null && input.chunkConfig() != null && input.chunkConfig().hasAnyOverride()) {
            try {
                client.updateDocumentConfig(ref.nativeId(), docId, input.chunkConfig());
                log.info("上传后已下发文档级切片配置 datasetId={} docId={} config={}",
                        ref.nativeId(), docId, input.chunkConfig());
            } catch (Exception e) {
                log.warn("上传后更新文档配置失败（文档仍会按 dataset 快照解析，可稍后改参）"
                        + "datasetId={} docId={}: {}", ref.nativeId(), docId, e.getMessage());
            }
        }
        // RAGFlow 上传后默认 UNSTART，必须显式 POST /chunks 才会进入解析队列
        try {
            client.parseDocuments(ref.nativeId(), List.of(docId));
        } catch (Exception e) {
            log.warn("上传后触发解析失败，文档将保持待解析/解析中，可手动重解析 datasetId={} docId={}: {}",
                    ref.nativeId(), docId, e.getMessage());
        }
        return new EngineDocumentRef(ENGINE_TYPE, docId);
    }

    /**
     * 模型池探测（T02，kb_settings_model_chunk）。
     *
     * <p><b>T00 P1/P2/P4 实测：</b>{@code GET /api/v1/models} 返回原生字段
     * {@code name/model_type/provider_name/instance_name}；id 全限定拼接
     * {@code name@instance_name@provider_name}（embedding 裸名被拒 code:101、rerank 裸名 code:100）。
     * 本实例列表接口不提供 {@code dimension}/{@code language}，对应字段保持 null。
     *
     * <p>失败不抛异常：返回 {@code EngineModelPool.unavailable(...)}（available=false + 原因），
     * 由 {@code EngineModelPoolService} 缓存并按降级语义展示（设计 §8-6）。
     *
     * @return 模型池快照，恒非 {@code null}
     */
    @Override
    public EngineModelPool probeModelPool() {
        String globalRerankModelId = props == null ? null : props.getRerankModelId();
        try {
            List<RfModel> models = client.listModels();
            List<EngineModel> embedding = new ArrayList<>();
            List<EngineModel> rerank = new ArrayList<>();
            if (models != null) {
                for (RfModel m : models) {
                    if (m == null || m.name() == null || m.name().isBlank()) {
                        continue;
                    }
                    if (m.isEmbedding()) {
                        embedding.add(new EngineModel(
                                fullyQualifiedId(m), m.name(), EngineModel.TYPE_EMBEDDING,
                                m.providerName(), null, null));
                    } else if (m.isRerank()) {
                        rerank.add(new EngineModel(
                                fullyQualifiedId(m), m.name(), EngineModel.TYPE_RERANK,
                                m.providerName(), null, null));
                    }
                }
            }
            return new EngineModelPool(
                    List.copyOf(embedding), List.copyOf(rerank), true, null,
                    globalRerankModelId, Instant.now());
        } catch (Exception e) {
            log.warn("RAGFlow 模型池探测失败: {}", e.getMessage());
            return EngineModelPool.unavailable("模型池探测失败：" + e.getMessage(), globalRerankModelId);
        }
    }

    /**
     * 更新文档级切片配置（T04，kb_settings_model_chunk；两步式）。
     *
     * <p><b>清空文件级覆盖（config 全 null）→ 快照式继承库级</b>（设计 §3.2.2 / §8-5）：
     * 下发库级当前有效切片参数到该文档。注意这是引擎侧快照语义——库级后续变更不会自动
     * 跟进存量文档（前端文案已提示，设计 §7.5 限制）。
     *
     * <p>PUT 后必须显式 {@code POST /chunks} 才触发重解析（T00 P5 实测）。
     *
     * @param ref    知识库引擎引用
     * @param docRef 文档引擎引用
     * @param config 文件级切片配置；全 null = 清空文件级覆盖
     */
    @Override
    public void updateDocumentChunkConfig(
            EngineLibraryRef ref, EngineDocumentRef docRef, DocumentChunkConfig config) {
        if (ref == null || ref.nativeId() == null || ref.nativeId().isBlank()
                || docRef == null || docRef.nativeId() == null || docRef.nativeId().isBlank()) {
            log.warn("文档切片配置更新跳过：引擎引用缺失 ref={} docRef={}", ref, docRef);
            return;
        }
        DocumentChunkConfig toSend = (config != null && config.hasAnyOverride())
                ? config
                : libraryEffectiveChunkConfig(ref);
        client.updateDocumentConfig(ref.nativeId(), docRef.nativeId(), toSend);
        // T00 P5：PUT 后不自动重解析，必须显式 POST /chunks
        client.parseDocuments(ref.nativeId(), List.of(docRef.nativeId()));
        log.info("已更新文档切片配置并触发重解析 datasetId={} docId={} config={}",
                ref.nativeId(), docRef.nativeId(), toSend);
    }

    /**
     * 快照式继承：取库级当前有效切片参数（供「清空文件级覆盖」时下发）。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return 库级有效切片参数；查不到库时返回 null（客户端收到 null 直接跳过下发）
     */
    private DocumentChunkConfig libraryEffectiveChunkConfig(EngineLibraryRef ref) {
        KbLibrary lib = libraryRepository.findByEngineLibraryRef(ref.nativeId()).orElse(null);
        if (lib == null) {
            log.warn("按引擎映射查不到知识库，清空文件级覆盖时无法下发库级快照 datasetId={}",
                    ref.nativeId());
            return null;
        }
        RagSettings settings = KbJson.readSettings(lib.getRagSettingsJson());
        RagSettings effective = settings == null ? RagSettings.defaults() : settings.withDefaults();
        return new DocumentChunkConfig(
                effective.chunkMethod(), effective.chunkTokenNum(), effective.separator());
    }

    /**
     * RAGFlow 模型全限定 id（T00 P1 实测）：{@code name@instance_name@provider_name}。
     *
     * @param m 原生模型项（name 已判非空）
     * @return 全限定 id
     */
    private static String fullyQualifiedId(RfModel m) {
        return m.name() + "@" + (m.instanceName() == null ? "" : m.instanceName())
                + "@" + (m.providerName() == null ? "" : m.providerName());
    }

    /**
     * 查询 RAGFlow 文档解析状态快照（KE-03/KE-04）。
     *
     * <p>逐文档 {@code GET /datasets/{id}/documents/{docId}}，组装
     * {@link ParseStatusSnapshot}（状态码值 + 进度 0~100 + 失败原因摘要）：
     * <ul>
     *   <li>status：{@link RagflowParseStatusMapper#toParseStatus}（兼容字符串/数字 run）；</li>
     *   <li>progress：{@link RagflowParseStatusMapper#toProgress}（0~1 → 0~100）；</li>
     *   <li>error：仅失败态携带 RAGFlow {@code progress_msg} 摘要（≤500 由快照构造截断）。</li>
     * </ul>
     * 单个文档查询异常记 WARN 后跳过（保留本地原值），不阻断整批。
     *
     * @param ref          知识库引擎引用
     * @param nativeDocIds 待查询的原生文档 id
     * @return 文档 id → 解析状态快照；恒非 {@code null}
     */
    @Override
    public Map<String, ParseStatusSnapshot> queryDocumentParseStatuses(
            EngineLibraryRef ref, List<String> nativeDocIds) {
        Map<String, ParseStatusSnapshot> out = new HashMap<>();
        if (ref == null || ref.nativeId() == null || ref.nativeId().isBlank()
                || nativeDocIds == null || nativeDocIds.isEmpty()) {
            return out;
        }
        for (String docId : nativeDocIds) {
            if (docId == null || docId.isBlank()) {
                continue;
            }
            try {
                var doc = client.getDocument(ref.nativeId(), docId);
                if (doc == null) {
                    continue;
                }
                String status = RagflowParseStatusMapper.toParseStatus(doc.run(), doc.progress());
                if (status == null) {
                    continue;
                }
                Integer progress = RagflowParseStatusMapper.toProgress(doc.progress());
                // progress_msg 仅在失败态有意义；成功/进行中一律不携带 error（清空口径）
                String error = ParseStatus.FAILED.code().equals(status)
                        ? doc.progressMsg() : null;
                out.put(docId, new ParseStatusSnapshot(status, progress, error));
            } catch (Exception e) {
                log.warn("查询 RAGFlow 文档解析状态失败 datasetId={} docId={}: {}",
                        ref.nativeId(), docId, e.getMessage());
            }
        }
        return out;
    }

    /**
     * 分页列举文档切片（「查看文档切分效果」）。
     *
     * <p>MIS libraryId/documentId → 引擎 dataset/doc 原生 id 翻译在本层闭环；
     * 返回的 {@link DocumentChunkView} 仅携带 MIS documentId 与清洗后纯文本
     * （引擎原生 chunk id 不下发）。
     *
     * <p><b>异常语义：</b>引擎不可达 / RAGFlow 报错（{@link RagflowClient#listChunks}
     * 抛 {@link com.mis.common.core.exception.BusinessException}）在此<b>向上抛出</b>，
     * 不做静默空页——由 {@code KbDocumentService} 捕获后降级为空态 +「引擎暂不可达」提示
     * （与 {@code syncOpenParseStatuses} 的降级风格一致）。仅「库/文档无引擎映射」等
     * 前置条件不满足时返回空页。
     *
     * @param query 切片查询（MIS id + 关键字 + 分页）
     * @return 切片分页视图；恒非 {@code null}
     */
    @Override
    public DocumentChunkPageView listDocumentChunks(ChunkQuery query) {
        int page = query == null ? 1 : query.page();
        int pageSize = query == null ? 20 : query.pageSize();
        if (query == null || query.libraryId() == null || query.documentId() == null) {
            return DocumentChunkPageView.empty(page, pageSize);
        }
        KbLibrary lib = libraryRepository.findById(query.libraryId()).orElse(null);
        if (lib == null || !StringUtils.hasText(lib.getEngineLibraryRef())) {
            return DocumentChunkPageView.empty(page, pageSize);
        }
        KbDocument doc = documentRepository.findById(query.documentId()).orElse(null);
        if (doc == null || !StringUtils.hasText(doc.getEngineDocumentRef())) {
            return DocumentChunkPageView.empty(page, pageSize);
        }
        RfDocumentChunkPage enginePage = client.listChunks(
                lib.getEngineLibraryRef(), doc.getEngineDocumentRef(),
                query.keywords(), page, pageSize);
        List<DocumentChunkView> views = new ArrayList<>();
        if (enginePage != null && enginePage.chunks() != null) {
            for (RfDocumentChunk c : enginePage.chunks()) {
                if (c == null) {
                    continue;
                }
                views.add(new DocumentChunkView(
                        query.documentId(),
                        cleanContent(c.content()),
                        c.pageNo(),
                        c.importantKeywords() == null
                                ? List.of() : List.copyOf(c.importantKeywords()),
                        c.normalizedImageId()));
            }
        }
        int total = enginePage == null || enginePage.total() == null
                ? views.size() : Math.max(enginePage.total(), 0);
        Integer chunkCount = enginePage == null || enginePage.doc() == null
                ? null : enginePage.doc().chunkCount();
        Integer tokenCount = enginePage == null || enginePage.doc() == null
                ? null : enginePage.doc().tokenCount();
        return new DocumentChunkPageView(views, total, page, pageSize, chunkCount, tokenCount);
    }

    /**
     * 拉取分片版面截图（透传 {@link RagflowClient#getChunkImage}）。
     *
     * @param imageId 引擎 {@code image_id}
     * @return 图片字节
     */
    @Override
    public byte[] fetchChunkImage(String imageId) {
        return client.getChunkImage(imageId);
    }

    /**
     * 引擎注入标记正则：{@code <weight ...>}/{@code <sep>}/{@code <em>xxx</em>} 及闭标签。
     *
     * <p>在 {@link RfSearchChunk#text()} 的 {@code weight|sep} 基础上扩展 {@code em}——
     * chunks 端点的正文用 {@code <em>} 包裹命中关键字（现网探测结论），展示前必须剥离，
     * 否则「正文带尖括号标签」的展示事故会直接复现。
     */
    private static final Pattern ENGINE_MARKUP_PATTERN =
            Pattern.compile("</?(?:weight|sep|em)[^>]*>");

    /** 残留 HTML 标签正则（{@code <table>}/{@code <td>} 等包装，剥离后保留换行）。 */
    private static final Pattern RESIDUAL_HTML_PATTERN =
            Pattern.compile("<[^>]+>");

    /**
     * 清洗 RAGFlow chunk 正文为纯文本（R3 风险防线：杜绝 XSS 与「正文带尖括号」事故）。
     *
     * <p>两步剥离：
     * <ol>
     *   <li>剥 {@code <weight>}/{@code <sep>}/{@code <em>} 标记（引擎注入的排版/高亮标记）；</li>
     *   <li>剥残留 HTML 标签 {@code <[^>]+>}（chunks 正文可能被 {@code <table>} 等包装）。
     *       换行保留——表格单元格、段落结构靠换行保持可读。</li>
     * </ol>
     * 归一空白：连续空格/Tab 压为单空格，行首行尾空白去除，连续空行压为至多两个。
     *
     * @param raw 引擎原始正文；可为 {@code null}
     * @return 清洗后纯文本；原值为空时返回空串
     */
    static String cleanContent(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        String cleaned = ENGINE_MARKUP_PATTERN.matcher(raw).replaceAll("");
        cleaned = RESIDUAL_HTML_PATTERN.matcher(cleaned).replaceAll("");
        cleaned = cleaned.replaceAll("[ \\t\\x0B\\f]+", " ");
        cleaned = cleaned.replaceAll(" *\\r?\\n *", "\n");
        cleaned = cleaned.replaceAll("\\n{3,}", "\n\n");
        return cleaned.trim();
    }

    @Override
    public void replaceDocument(EngineLibraryRef ref, EngineDocumentRef docRef, DocumentUploadInput input) {
        // RAGFlow 无单独 replace 端点：删除后重传
        client.deleteDocument(ref.nativeId(), docRef.nativeId());
        client.uploadDocument(ref.nativeId(), input);
    }

    @Override
    public void deleteDocument(EngineLibraryRef ref, EngineDocumentRef docRef) {
        client.deleteDocument(ref.nativeId(), docRef.nativeId());
    }

    @Override
    public void setDocumentEnabled(EngineLibraryRef ref, EngineDocumentRef docRef, boolean enabled) {
        // B1 修复（2026-08-11，实测 10.254.16.6:9380）：
        // 旧实现 enabled=false 调 deleteDocument（不可逆删除）、enabled=true 什么都不做，
        // 与注释声称的「mis-kb 侧按 enabled 过滤」完全不符——检索链路（本类 retrieve）此前
        // 根本没有该过滤（见 retrieve 的 B1 注释），停用文档在引擎侧永远保持可检索。
        // RAGFlow 支持文档级启停：PUT /datasets/{id}/documents/{docId} + {"enabled": 0|1}，
        // 实测停用后 retrieval 不再命中、文档与 chunks 原样保留（绝不删除）。现改为真实启停语义。
        client.updateDocumentEnabled(ref.nativeId(), docRef.nativeId(), enabled);
        log.info("已同步文档启用状态到 RAGFlow datasetId={} docId={} enabled={}",
                ref.nativeId(), docRef.nativeId(), enabled);
    }

    /**
     * 重新解析文档（T04，WA-09）。
     *
     * <p>P0 这里是空实现，导致「重新解析」按钮点了只把本地状态改成 PARSING，引擎侧
     * 纹丝不动——切片参数改完永远不生效。现落地为真实调用
     * {@code POST /api/v1/datasets/{id}/chunks}。
     *
     * <p><b>B2 重要限制（2026-08-11 核实）：</b>RAGFlow 的「重新解析」使用<b>文档自身
     * 保存的 parser_config 快照</b>（上传时从 dataset 复制而来），<b>不会</b>采用 dataset
     * 当前配置。因此改了 {@code RagSettingsService} 中的分隔符/切片参数后，对存量文档点
     * 「重新解析」<b>不会</b>让新分隔符生效——正确操作路径是<b>删除后重新上传</b>
     * （新上传的文档会快照 dataset 当前 parser_config）。此限制已同步到前端提示文案。
     *
     * <p>异常<b>直接向上抛</b>，由 {@link com.mis.kb.domain.service.KbDocumentService}
     * 捕获后把文档置 {@code FAILED} 并记录原因（§7.5-6 错误处理分野）。
     */
    @Override
    public void reparseDocument(EngineLibraryRef ref, EngineDocumentRef docRef) {
        client.parseDocuments(ref.nativeId(), List.of(docRef.nativeId()));
        log.info("已触发 RAGFlow 文档重解析 datasetId={} docId={}", ref.nativeId(), docRef.nativeId());
    }

    @Override
    public List<ChunkHit> retrieve(RetrieveQuery query) {
        List<String> datasetIds = new ArrayList<>();
        Map<Long, String> libraryRefById = new HashMap<>();
        if (query.libraryIds() != null) {
            for (Long libraryId : query.libraryIds()) {
                KbLibrary lib = libraryRepository.findById(libraryId).orElse(null);
                if (lib != null && lib.getEngineLibraryRef() != null) {
                    datasetIds.add(lib.getEngineLibraryRef());
                    libraryRefById.put(libraryId, lib.getEngineLibraryRef());
                }
            }
        }
        if (datasetIds.isEmpty()) {
            return List.of();
        }
        // KE-08/KE-09：文档过滤（MIS 文档 id → 引擎原生 document ref 集）。
        // 只下发「本次检索库内 + enabled=1 + 有引擎映射」的文档；解析结果为空 = 不过滤
        // （R5：不下发 document_ids 键，引擎返回全量）。
        List<String> nativeDocIds = resolveDocumentIds(query.documentIds(), libraryRefById);

        // Wave B GraphRAG PoC（T03）：图谱增强分流。
        // resolver 已保证 effectiveUseKnowledgeGraph()==true 时必然单库（S4.5 多库降级）。
        // 走 /datasets/{id}/search + use_kg:true（T00 G5 实测：/api/v1/retrieval 静默忽略 use_kg）。
        if (query.effectiveUseKnowledgeGraph()) {
            if (datasetIds.size() != 1) {
                // 理论不可达（resolver 已降级多库）；防御性回落经典检索，绝不静默走错端点
                log.warn("图谱增强检索遇到多库 datasetIds={}，防御性回落经典检索（resolver 应已降级）",
                        datasetIds);
            } else {
                return retrieveWithGraph(datasetIds.get(0), query, nativeDocIds);
            }
        }

        List<RfChunk> chunks = client.retrieve(query, datasetIds, nativeDocIds);
        List<ChunkHit> hits = new ArrayList<>();
        for (RfChunk c : chunks) {
            KbDocument doc = documentRepository.findByEngineDocumentRef(c.documentId()).orElse(null);
            // B1：mis-kb 侧同样按 enabled 过滤（双保险）。RAGFlow 引擎侧已按 enabled 排除
            // 停用文档，但引擎侧状态可能与本地不一致（noop/mock 不同步、或历史遗留），
            // 本地 enabled=0 的文档绝不允许进入检索结果。doc 为 null 时无法判断本地状态，
            // 维持旧行为（透传引擎信息），不做额外丢弃。
            if (doc != null && !Integer.valueOf(1).equals(doc.getEnabled())) {
                log.debug("检索命中本地已停用文档，丢弃 chunk documentId={} docId={}",
                        c.documentId(), doc.getId());
                continue;
            }
            Long docId = doc != null ? doc.getId() : null;
            Long libId = doc != null ? doc.getLibraryId() : null;
            // F-04：透传引擎给出的页码/偏移（不可得时为 null，前端降级展示）
            hits.add(new ChunkHit(libId, docId, c.text(), c.score(), c.documentName(),
                    c.charOffset(), c.firstPage()));
        }
        return hits;
    }

    /**
     * 单库图谱增强检索（Wave B GraphRAG PoC，T03）。
     *
     * <p>走 {@code client.searchDataset}（{@code POST /datasets/{id}/search} + {@code use_kg:true}），
     * 把 {@link RfSearchChunk}（T00 G7 字段契约）映射为统一 {@link ChunkHit}：
     * <ul>
     *   <li>{@code chunkText} ← {@code content_with_weight} 剥离 {@code <weight>} 标记（R3）；</li>
     *   <li>{@code docTitle} ← {@code docnm_kwd}（引擎已给文档名，优先用）；</li>
     *   <li>{@code documentId} ← {@code doc_id} → repository 反查 MIS {@code KbDocument.id}；</li>
     *   <li>{@code libraryId} ← {@code kb_id} → 反查 MIS {@code KbLibrary.id}；</li>
     *   <li>{@code score} ← {@code similarity}；{@code offset/page} 置 null（该响应无此字段）。</li>
     * </ul>
     * 反查不到时对应字段为 {@code null}（与经典检索「本地未同步」口径一致，绝不下发原生 id）。
     *
     * @param datasetId    引擎原生 dataset id（单库）
     * @param query        已合并完成的检索参数（{@code effectiveUseKnowledgeGraph()} 已保证 true）
     * @param nativeDocIds 引擎原生 document id 列表（文档过滤；空 = 全量）
     * @return 统一 chunk 命中列表；恒非 {@code null}
     */
    private List<ChunkHit> retrieveWithGraph(
            String datasetId, RetrieveQuery query, List<String> nativeDocIds) {
        List<RfSearchChunk> chunks = client.searchDataset(datasetId, query, nativeDocIds);
        List<ChunkHit> hits = new ArrayList<>();
        for (RfSearchChunk c : chunks) {
            if (c == null) {
                continue;
            }
            KbDocument doc = c.docId() == null || c.docId().isBlank()
                    ? null
                    : documentRepository.findByEngineDocumentRef(c.docId()).orElse(null);
            // B1 双保险：本地 enabled=0 的文档绝不允许进入检索结果（同经典检索口径）
            if (doc != null && !Integer.valueOf(1).equals(doc.getEnabled())) {
                log.debug("图谱增强命中本地已停用文档，丢弃 chunk docId={} misDocId={}",
                        c.docId(), doc.getId());
                continue;
            }
            Long docId = doc != null ? doc.getId() : null;
            Long libId = null;
            if (c.kbId() != null && !c.kbId().isBlank()) {
                libId = libraryRepository.findByEngineLibraryRef(c.kbId())
                        .map(KbLibrary::getId).orElse(null);
            }
            // docTitle 优先用引擎给的文档名（docnm_kwd），反查不到本地文档时仍可展示
            hits.add(new ChunkHit(libId, docId, c.text(), c.similarity(),
                    c.docnmKwd(), null, null));
        }
        return hits;
    }

    /**
     * MIS 文档 id 集 → 引擎原生 document ref 集（KE-08/KE-09）。
     *
     * <p>翻译铁律（设计 §1.5）：
     * <ul>
     *   <li><b>只下发本次检索库内的文档</b>——引擎会校验 document 归属（code:102），
     *       越库下发直接拒整单；</li>
     *   <li><b>仅 enabled=1</b>——双保险，避免检索到停用文档；</li>
     *   <li>无引擎映射的文档跳过（本地尚未同步的文档引擎侧不存在）；</li>
     *   <li>结果为空 = 无过滤（R5：不下发 {@code document_ids} 键，引擎全量返回）。</li>
     * </ul>
     *
     * @param misDocumentIds MIS 文档 id 集；空 = 不过滤
     * @param libraryRefById 本次检索库 id → 引擎 dataset ref 映射
     * @return 引擎原生 document ref 列表；恒非 {@code null}
     */
    private List<String> resolveDocumentIds(List<Long> misDocumentIds, Map<Long, String> libraryRefById) {
        if (misDocumentIds == null || misDocumentIds.isEmpty()) {
            return List.of();
        }
        List<String> nativeIds = new ArrayList<>();
        for (KbDocument doc : documentRepository.findAllById(misDocumentIds)) {
            if (doc == null) {
                continue;
            }
            if (!Integer.valueOf(1).equals(doc.getEnabled())) {
                log.debug("文档过滤：跳过已停用文档 docId={}", doc.getId());
                continue;
            }
            String libRef = doc.getLibraryId() == null ? null : libraryRefById.get(doc.getLibraryId());
            if (libRef == null) {
                log.debug("文档过滤：跳过非本次检索库文档 docId={} libraryId={}",
                        doc.getId(), doc.getLibraryId());
                continue;
            }
            if (doc.getEngineDocumentRef() == null || doc.getEngineDocumentRef().isBlank()) {
                log.debug("文档过滤：跳过无引擎映射文档 docId={}", doc.getId());
                continue;
            }
            nativeIds.add(doc.getEngineDocumentRef());
        }
        return nativeIds;
    }

    @Override
    public EngineHealth health() {
        try {
            return client.health() ? EngineHealth.up() : EngineHealth.down("RAGFlow unhealthy");
        } catch (Exception e) {
            return EngineHealth.down(e.getMessage());
        }
    }

    /**
     * 引擎能力声明（T05，WA-03 / WA-06）。
     *
     * <p>{@code rerankSupported} 采用「<b>当前配置下实际可用</b>」口径而非「理论支持」：
     * RAGFlow 本身当然支持重排，但没配全局模型 ID 就等于不可用。若这里恒返 true，
     * 前端会把开关亮着让人去点，点完保存又被后端强制关掉——纯粹的体验事故。
     *
     * <p><b>T02 新增 {@code deleteSupported}</b>：同样是「当前配置下实际可用」口径，
     * 取自 {@code mis.kb.engine.delete-supported}（默认 false）。当前部署的 RAGFlow 版本
     * {@code DELETE /datasets/{id}} 返回 405，所以这里恒为 false，前端据此把「物理删除」
     * 置灰并给出说明；升级后翻配置即可，本方法不用改。
     *
     * <p><b>企业级增强一期（KE-06/KE-07）新增 parser 两位恒 false：</b>
     * 当前 RAGFlow 实例实测<b>不支持</b> parser_config 的 OCR / overlap 键（硬下发即
     * code:101/102 拒整单），所以 {@code parser_ocr}/{@code parser_overlap} 能力恒不声明，
     * 前端据此置灰 + 提示「当前引擎版本暂不支持」；同时 {@code RagflowClient} 侧白名单
     * 保证这两个键一律不下发。引擎升级后翻转下方两个 {@code false} 即可放行，代码分支不动。
     *
     * <p><b>Wave B GraphRAG PoC（T01）新增 {@code graphSupported=true}：</b>
     * 按 <b>T00 实测</b>（{@code ragflow-graphrag-probe-2026-08-11.md} G1/G2/G5）——
     * 本实例支持 {@code parser_config.graphrag.use_graphrag} 配置、构图
     * {@code POST /datasets/{id}/index?type=graph} 与增强检索 {@code use_kg}，
     * 故声明 {@code true}。语义口径与 {@code rerankSupported} 一致：「当前部署引擎版本下
     * 实际可用」。若未来引擎升级破坏契约，把下方 {@code graph} 参数翻成 {@code false}
     * 即可走「前端置灰 + 保存强制关 + 检索期降级」三道防线，代码分支不动（共享知识 §10-1）。
     *
     * @return 能力声明；{@code hybrid} 恒支持，{@code rerank} 随模型 ID 配置动态变化，
     *         {@code delete} 随 {@code delete-supported} 配置变化，OCR/overlap 本期恒不支持，
     *         {@code graph} 恒支持（T00 实测）
     */
    @Override
    public EngineCapabilities capabilities() {
        boolean rerankAvailable = props != null && props.hasRerankModel();
        if (!rerankAvailable) {
            log.debug("未配置 mis.kb.engine.rerank-model-id，capabilities 声明 rerankSupported=false");
        }
        boolean deleteAvailable = props != null && props.isDeleteSupported();
        boolean raptorAvailable = props == null || props.isRaptorEnabled();
        // 9 参：rerank / metadataFilter / replace / hybrid / delete / parserOcr /
        // parserOverlap / graph / raptor。raptor 受平台总开关 mis.kb.engine.raptor-enabled
        // 控制（U4 裁定；默认 true，Nacos 可热调）。
        return EngineCapabilities.of(rerankAvailable, true, true, true, deleteAvailable,
                false, false, true, raptorAvailable);
    }
}
