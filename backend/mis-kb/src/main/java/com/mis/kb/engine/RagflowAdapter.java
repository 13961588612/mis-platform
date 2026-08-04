package com.mis.kb.engine;

import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.CreateLibraryCmd;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQuery;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.dto.RfChunk;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.List;

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

    @Override
    public EngineLibraryRef createLibrary(CreateLibraryCmd cmd) {
        String datasetId = client.createDataset(cmd.name());
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

    @Override
    public EngineDocumentRef uploadDocument(EngineLibraryRef ref, DocumentUploadInput input) {
        String docId = client.uploadDocument(ref.nativeId(), input);
        return new EngineDocumentRef(ENGINE_TYPE, docId);
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
        // RAGFlow 通过 enable/disable 文档端点控制；此处以 retrieval 是否命中由 enabled 字段在 mis-kb 侧过滤，
        // 引擎侧不强制同步（P0）。
        if (!enabled) {
            client.deleteDocument(ref.nativeId(), docRef.nativeId());
        }
    }

    /**
     * 重新解析文档（T04，WA-09）。
     *
     * <p>P0 这里是空实现，导致「重新解析」按钮点了只把本地状态改成 PARSING，引擎侧
     * 纹丝不动——切片参数改完永远不生效。现落地为真实调用
     * {@code POST /api/v1/datasets/{id}/chunks}。
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
     * @return 能力声明；{@code hybrid} 恒支持，{@code rerank} 随模型 ID 配置动态变化
     */
    @Override
    public EngineCapabilities capabilities() {
        boolean rerankAvailable = props != null && props.hasRerankModel();
        if (!rerankAvailable) {
            log.debug("未配置 mis.kb.engine.rerank-model-id，capabilities 声明 rerankSupported=false");
        }
        return EngineCapabilities.of(rerankAvailable, true, true, true);
    }
}
