package com.mis.kb.engine;

import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.CreateLibraryCmd;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.model.EngineLibraryBrief;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineModel;
import com.mis.kb.domain.model.EngineModelPool;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQuery;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.dto.RfChunk;
import com.mis.kb.engine.dto.RfDataset;
import com.mis.kb.engine.dto.RfModel;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.RestClient;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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

    @Override
    public void deleteLibrary(EngineLibraryRef ref) {
        client.deleteDataset(ref.nativeId());
    }

    /**
     * 重命名引擎侧 dataset（T02：归档流程调用）。
     *
     * @param ref     知识库引擎引用
     * @param newName 新名字（调用方已按 {@link RagflowDatasetNaming#forArchive} 加工）
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

    @Override
    public Map<String, String> queryDocumentParseStatuses(EngineLibraryRef ref, List<String> nativeDocIds) {
        Map<String, String> out = new HashMap<>();
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
                if (status != null) {
                    out.put(docId, status);
                }
            } catch (Exception e) {
                log.warn("查询 RAGFlow 文档解析状态失败 datasetId={} docId={}: {}",
                        ref.nativeId(), docId, e.getMessage());
            }
        }
        return out;
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
        if (query.libraryIds() != null) {
            for (Long libraryId : query.libraryIds()) {
                KbLibrary lib = libraryRepository.findById(libraryId).orElse(null);
                if (lib != null && lib.getEngineLibraryRef() != null) {
                    datasetIds.add(lib.getEngineLibraryRef());
                }
            }
        }
        if (datasetIds.isEmpty()) {
            return List.of();
        }
        List<RfChunk> chunks = client.retrieve(query, datasetIds);
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
     * @return 能力声明；{@code hybrid} 恒支持，{@code rerank} 随模型 ID 配置动态变化，
     *         {@code delete} 随 {@code delete-supported} 配置变化
     */
    @Override
    public EngineCapabilities capabilities() {
        boolean rerankAvailable = props != null && props.hasRerankModel();
        if (!rerankAvailable) {
            log.debug("未配置 mis.kb.engine.rerank-model-id，capabilities 声明 rerankSupported=false");
        }
        boolean deleteAvailable = props != null && props.isDeleteSupported();
        return EngineCapabilities.of(rerankAvailable, true, true, true, deleteAvailable);
    }
}
