package com.mis.kb.engine;

import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.CreateLibraryCmd;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQuery;

import java.util.List;

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

    /** 检索，返回统一 {@link ChunkHit}（仅含 MIS 业务 ID）。 */
    List<ChunkHit> retrieve(RetrieveQuery query);

    /** 引擎健康探测。 */
    EngineHealth health();

    /** 引擎能力声明。 */
    EngineCapabilities capabilities();
}
