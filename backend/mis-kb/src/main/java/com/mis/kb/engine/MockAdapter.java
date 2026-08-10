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

import java.util.ArrayList;
import java.util.List;

/**
 * 内存假数据适配器（CI 用）。
 *
 * <p>不依赖任何外部引擎，retrieve 依据请求的 MIS libraryId 返回确定性命中，便于自动化测试覆盖主流程。
 */
public class MockAdapter implements KnowledgeEnginePort {

    public static final String ENGINE_TYPE = "mock";

    @Override
    public String engineType() {
        return ENGINE_TYPE;
    }

    @Override
    public EngineLibraryRef createLibrary(CreateLibraryCmd cmd) {
        return new EngineLibraryRef(ENGINE_TYPE, "mock-ds-" + cmd.name());
    }

    @Override
    public void updateLibrarySettings(EngineLibraryRef ref, RagSettings settings) {
        // no-op
    }

    @Override
    public void deleteLibrary(EngineLibraryRef ref) {
        // no-op
    }

    @Override
    public EngineDocumentRef uploadDocument(EngineLibraryRef ref, DocumentUploadInput input) {
        return new EngineDocumentRef(ENGINE_TYPE, "mock-doc-" + input.filename());
    }

    @Override
    public void replaceDocument(EngineLibraryRef ref, EngineDocumentRef docRef, DocumentUploadInput input) {
        // no-op
    }

    @Override
    public void deleteDocument(EngineLibraryRef ref, EngineDocumentRef docRef) {
        // no-op
    }

    @Override
    public void setDocumentEnabled(EngineLibraryRef ref, EngineDocumentRef docRef, boolean enabled) {
        // no-op（刻意）：mock 引擎仅 CI 假数据，无真实状态可同步；检索可见性由
        // mis-kb 侧 enabled 过滤兜底（RagflowAdapter.retrieve 的 B1 过滤逻辑）。
    }

    @Override
    public void reparseDocument(EngineLibraryRef ref, EngineDocumentRef docRef) {
        // no-op
    }

    @Override
    public List<ChunkHit> retrieve(RetrieveQuery query) {
        List<Long> libs = query.libraryIds() == null || query.libraryIds().isEmpty()
                ? List.of(1L)
                : query.libraryIds();
        int topK = Math.min(query.effectiveTopK(), 3);
        List<ChunkHit> hits = new ArrayList<>();
        for (Long libraryId : libs) {
            for (int i = 0; i < topK; i++) {
                hits.add(new ChunkHit(
                        libraryId,
                        libraryId * 1000 + i,
                        "[mock] 知识库 " + libraryId + " 的片段 #" + i,
                        0.9 - i * 0.1,
                        "mock-doc-" + libraryId,
                        i * 200,
                        i + 1));
            }
        }
        return hits;
    }

    @Override
    public EngineHealth health() {
        return EngineHealth.up();
    }

    /**
     * 能力声明：全支持（T05）。
     *
     * <p>CI/本地联调需要能走通 hybrid + rerank 的完整分支，若这里像 P0 那样声明
     * {@code replace=false}、不声明 {@code hybrid}，参数合并器就会在本地一路降级，
     * 联调时看到的行为与生产不一致，反而掩盖问题。
     *
     * @return 四项能力全开的声明
     */
    @Override
    public EngineCapabilities capabilities() {
        return EngineCapabilities.of(true, true, true, true);
    }
}
