package com.mis.kb.engine;

import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.CreateLibraryCmd;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineModelPool;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQuery;

import java.util.List;
import java.util.Map;

/**
 * 检索增强生成（RAG）引擎抽象端口。
 *
 * <p>mis-kb 与具体引擎实现解耦；当前提供 {@code ragflow}（真实 HTTP）、{@code noop}（无操作）、
 * {@code mock}（内存假数据，CI 用）三种实现，经 {@link EngineAdapterSelector} 按 {@code mis.kb.engine.type} 选择。
 *
 * <p>所有方法对外只认 MIS 业务 ID（libraryId/documentId）；nativeId 仅在返回 {@link EngineLibraryRef} /
 * {@link EngineDocumentRef} 时透出，由 service 层落库，绝不下发给前端。
 */
public interface KnowledgeEnginePort {

    /** 引擎类型标识（ragflow / noop / mock）。 */
    String engineType();

    /** 在引擎侧创建知识库（dataset），返回 MIS↔引擎映射引用。 */
    EngineLibraryRef createLibrary(CreateLibraryCmd cmd);

    /** 更新知识库 RAG 设置。 */
    void updateLibrarySettings(EngineLibraryRef ref, RagSettings settings);

    /** 删除知识库。 */
    void deleteLibrary(EngineLibraryRef ref);

    /** 上传文档，返回 MIS↔引擎文档映射引用。 */
    EngineDocumentRef uploadDocument(EngineLibraryRef ref, DocumentUploadInput input);

    /** 替换文档内容。 */
    void replaceDocument(EngineLibraryRef ref, EngineDocumentRef docRef, DocumentUploadInput input);

    /** 删除文档。 */
    void deleteDocument(EngineLibraryRef ref, EngineDocumentRef docRef);

    /** 启停文档（影响检索可见性）。 */
    void setDocumentEnabled(EngineLibraryRef ref, EngineDocumentRef docRef, boolean enabled);

    /** 重新解析文档。 */
    void reparseDocument(EngineLibraryRef ref, EngineDocumentRef docRef);

    /**
     * 探测引擎模型池（T02，kb_settings_model_chunk）。
     *
     * <p><b>默认实现：不支持/失败返回 unavailable（绝不当空列表，设计 §8-6）。</b>
     * noop/mock 引擎走默认实现，调用方（{@code EngineModelPoolService}）无需特判。
     *
     * @return 分类模型池快照，恒非 {@code null}
     */
    default EngineModelPool probeModelPool() {
        return EngineModelPool.unavailable("当前引擎不支持模型池探测", null);
    }

    /**
     * 更新文档级切片配置（T04，kb_settings_model_chunk）。
     *
     * <p><b>默认实现：noop（noop/mock 引擎零改动）。</b>RAGFlow 实现为
     * 「PUT 文档配置 → 显式 POST /chunks」两步式（T00 P5 实测：PUT 后不自动重解析）。
     *
     * @param ref    知识库引擎引用
     * @param docRef 文档引擎引用
     * @param config 文件级切片配置；全 null 表示清空文件级覆盖（快照式继承库级）
     */
    default void updateDocumentChunkConfig(
            EngineLibraryRef ref, EngineDocumentRef docRef, DocumentChunkConfig config) {
        // noop：不支持文档级切片配置的引擎静默忽略
    }

    /**
     * 查询引擎侧文档解析状态，回写到 {@code kb_document.parse_status} 用。
     *
     * <p>key = 引擎原生 document id；value = MIS {@code pending|parsing|success|failed}。
     * 查不到或引擎不支持时返回空 map（调用方保留本地原值）。
     *
     * @param ref          知识库引擎引用
     * @param nativeDocIds 待查询的原生文档 id；空则返回空 map
     */
    default Map<String, String> queryDocumentParseStatuses(EngineLibraryRef ref, List<String> nativeDocIds) {
        return Map.of();
    }

    /** 检索，返回统一 {@link ChunkHit}（仅含 MIS 业务 ID）。 */
    List<ChunkHit> retrieve(RetrieveQuery query);

    /** 引擎健康探测。 */
    EngineHealth health();

    /** 引擎能力声明。 */
    EngineCapabilities capabilities();
}
