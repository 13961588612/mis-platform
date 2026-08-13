package com.mis.kb.engine;

import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.ChunkQuery;
import com.mis.kb.domain.model.CreateLibraryCmd;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.model.DocumentChunkPageView;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineDocumentBrief;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.model.EngineLibraryBrief;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineModelPool;
import com.mis.kb.domain.model.GraphBuildSnapshot;
import com.mis.kb.domain.model.ParseStatusSnapshot;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RaptorBuildSnapshot;
import com.mis.kb.domain.model.RetrieveQuery;
import org.slf4j.LoggerFactory;

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

    /**
     * 重命名引擎侧知识库（dataset）——归档流程的核心动作（引擎删除策略 P0 / T01）。
     *
     * <p><b>默认实现：空操作 + WARN 日志</b>，noop/mock 引擎零改动。
     * 归档以本地语义为主，引擎改名失败不阻断归档，但会被记 {@code engine_sync_status=3}
     * 等待对账，所以这里的「静默成功」对上层是可接受的（上层看 engineSynced 标志）。
     *
     * @param ref     知识库引擎引用
     * @param newName 新的 dataset 名（已在 adapter 层按命名规范加工并截断）
     */
    default void renameLibrary(EngineLibraryRef ref, String newName) {
        LoggerFactory.getLogger(KnowledgeEnginePort.class)
                .warn("当前引擎[{}]不支持重命名知识库，已跳过：ref={}, newName={}",
                        engineType(), ref == null ? null : ref.nativeId(), newName);
    }

    /**
     * 列举引擎侧全部知识库（dataset）摘要——对账服务用（引擎删除策略 P0 / T01）。
     *
     * <p><b>默认实现返回空列表</b>，noop/mock 引擎零改动。
     *
     * <p><b>护栏提醒：</b>空列表会让对账把全部 MIS 库判成「引擎缺失」，
     * 所以 {@code KbEngineReconcileService} 入口第一行就判 {@code engineType != "ragflow"}
     * → {@code skipped=true} 直接返回，一个字段都不写库。别把这个护栏挪走。
     *
     * @return 引擎侧 dataset 摘要列表，恒非 {@code null}
     */
    default List<EngineLibraryBrief> listLibraries() {
        return List.of();
    }

    /**
     * 列举引擎侧某 dataset 下的全部文档摘要——文档级对账用（增量 P1 / T03）。
     *
     * <p><b>默认实现返回空列表</b>，noop/mock 引擎零改动（与 {@link #listLibraries()} 同口径）。
     * 文档级对账入口同样只在 {@code type == ragflow} 时调用，故默认空列表不会污染本地数据。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return 文档摘要列表，恒非 {@code null}
     */
    default List<EngineDocumentBrief> listDocuments(EngineLibraryRef ref) {
        return List.of();
    }

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
     * 查询引擎侧文档解析状态，回写到 {@code kb_document.parse_status / parse_progress / parse_error} 用。
     *
     * <p>key = 引擎原生 document id；value = 解析状态快照（状态码值 + 进度 0~100 + 失败原因摘要）。
     * 查不到或引擎不支持时返回空 map（调用方保留本地原值）。
     *
     * @param ref          知识库引擎引用
     * @param nativeDocIds 待查询的原生文档 id；空则返回空 map
     * @return 文档 id → 解析状态快照；恒非 {@code null}
     */
    default Map<String, ParseStatusSnapshot> queryDocumentParseStatuses(
            EngineLibraryRef ref, List<String> nativeDocIds) {
        return Map.of();
    }

    /**
     * 分页列举某文档的切片（「查看文档切分效果」）。
     *
     * <p><b>默认实现返回空页</b>，noop/mock 引擎零改动（与 {@link #listDocuments()} 同口径）。
     * RAGFlow 实现走 {@code GET /api/v1/datasets/{id}/documents/{docId}/chunks}
     * （{@code RagflowClient.listChunks}），在适配层完成 MIS id 翻译与正文清洗。
     *
     * <p><b>异常语义：</b>引擎不可达 / RAGFlow 报错时<b>向上抛出</b>（不做静默空页），
     * 由调用方（{@code KbDocumentService}）捕获后降级为空态 +「引擎暂不可达」提示
     * （与 {@code syncOpenParseStatuses} 的降级风格一致）；无引擎映射等前置条件不满足
     * 返回空页。
     *
     * @param query 切片查询（MIS libraryId/documentId + 关键字 + 分页）
     * @return 切片分页视图；恒非 {@code null}
     */
    default DocumentChunkPageView listDocumentChunks(ChunkQuery query) {
        int page = query == null ? 1 : query.page();
        int pageSize = query == null ? 20 : query.pageSize();
        return DocumentChunkPageView.empty(page, pageSize);
    }

    /** 检索，返回统一 {@link ChunkHit}（仅含 MIS 业务 ID）。 */
    List<ChunkHit> retrieve(RetrieveQuery query);

    /**
     * 触发图谱构建（Wave B GraphRAG PoC，T02）。
     *
     * <p><b>默认实现：抛 {@link UnsupportedOperationException}</b>（引擎不支持构图）。
     * RAGFlow 实现走 {@code POST /api/v1/datasets/{id}/index?type=graph}
     * （{@code RagflowClient.buildGraph}，type 值必须是 {@code graph}，禁写 {@code graphrag}）。
     * 引擎侧只排队任务并立即返回 {@code task_id}，构图完成在后台进行（状态走
     * {@link #queryGraphBuildStatus} 轮询）。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return 引擎侧构图任务 id
     */
    default String buildGraph(EngineLibraryRef ref) {
        throw new UnsupportedOperationException("当前引擎不支持图谱构建");
    }

    /**
     * 查询图谱构建状态（Wave B GraphRAG PoC，T02）。
     *
     * <p><b>默认实现：返回 NONE 快照</b>（noop/mock 引擎零改动），调用方保留本地状态。
     * RAGFlow 实现走 {@code GET /api/v1/datasets/{id}/index?type=graph}，映射
     * {@code progress}（1.0=ready / -1=failed / 其他=building；无任务 → NONE）。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return 构图状态快照；恒非 {@code null}
     */
    default GraphBuildSnapshot queryGraphBuildStatus(EngineLibraryRef ref) {
        return GraphBuildSnapshot.none();
    }

    /**
     * 触发 RAPTOR 摘要构建（Wave C RAPTOR，T02）。
     *
     * <p><b>默认实现：抛 {@link UnsupportedOperationException}</b>（引擎不支持 RAPTOR）。
     * RAGFlow 实现走 {@code POST /api/v1/datasets/{id}/index?type=raptor}
     * （{@code RagflowClient.buildRaptor}，type 值必须是 {@code raptor}，T00 P2a 实测）。
     * 引擎侧只排队任务并立即返回 {@code task_id}，构建完成在后台进行（状态走
     * {@link #queryRaptorBuildStatus} 轮询）。graph/raptor 构建<b>不互斥可并行</b>
     * （T00 P2c 实测），两者各自独立状态机。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return 引擎侧 RAPTOR 构建任务 id
     */
    default String buildRaptor(EngineLibraryRef ref) {
        throw new UnsupportedOperationException("当前引擎不支持 RAPTOR 摘要构建");
    }

    /**
     * 查询 RAPTOR 构建状态（Wave C RAPTOR，T02）。
     *
     * <p><b>默认实现：返回 NONE 快照</b>（noop/mock 引擎零改动），调用方保留本地状态。
     * RAGFlow 实现走 {@code GET /api/v1/datasets/{id}/index?type=raptor}，映射
     * {@code progress}（1.0=ready / -1=failed / 其他=building；无任务 → NONE）。
     *
     * @param ref 知识库引擎引用（nativeId = dataset id）
     * @return RAPTOR 构建状态快照；恒非 {@code null}
     */
    default RaptorBuildSnapshot queryRaptorBuildStatus(EngineLibraryRef ref) {
        return RaptorBuildSnapshot.none();
    }

    /** 引擎健康探测。 */
    EngineHealth health();

    /** 引擎能力声明。 */
    EngineCapabilities capabilities();
}
