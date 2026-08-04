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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * 无操作适配器。
 *
 * <p>当未配置 RAGFlow（本地/CI/无引擎实例）时启用，使 mis-kb 主流程可编译、可跑通：
 * 创建库/文档不报错（返回占位 ref），retrieve 返回空 hits，health 恒为绿。
 *
 * <p><b>T06（WA-03）降级语义：</b>「返回空结果」是<b>刻意的静默降级</b>而非异常——
 * 没有引擎的环境本就不该让问答链路 500。但静默不等于无痕：retrieve 会打一条带
 * 库 ID / 检索方式 / 权重的 WARN，否则排障时只能看到「怎么什么都搜不出来」，
 * 完全无从判断是引擎没配还是参数不对。
 */
public class NoopAdapter implements KnowledgeEnginePort {

    public static final String ENGINE_TYPE = "noop";

    private static final Logger log = LoggerFactory.getLogger(NoopAdapter.class);

    @Override
    public String engineType() {
        return ENGINE_TYPE;
    }

    @Override
    public EngineLibraryRef createLibrary(CreateLibraryCmd cmd) {
        return new EngineLibraryRef(ENGINE_TYPE, "noop-" + cmd.name());
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
        return new EngineDocumentRef(ENGINE_TYPE, "noop-" + input.filename());
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
        // no-op
    }

    @Override
    public void reparseDocument(EngineLibraryRef ref, EngineDocumentRef docRef) {
        log.warn("[noop] 引擎未启用，重解析请求被忽略 libraryRef={} docRef={}",
                ref == null ? null : ref.nativeId(), docRef == null ? null : docRef.nativeId());
    }

    /**
     * 检索恒返空，并留下可观测痕迹。
     *
     * @param query 检索参数
     * @return 空列表（不抛异常，链路继续走空结果策略）
     */
    @Override
    public List<ChunkHit> retrieve(RetrieveQuery query) {
        log.warn("[noop] 引擎未启用，检索返回空结果 libraryIds={} retrievalMethod={} weight={}",
                query == null ? null : query.libraryIds(),
                query == null ? null : query.effectiveRetrievalMethod(),
                query == null ? null : query.effectiveVectorSimilarityWeight());
        return List.of();
    }

    @Override
    public EngineHealth health() {
        return EngineHealth.up();
    }

    /**
     * 能力声明：全不支持。
     *
     * <p>显式声明 {@code hybridSupported=false} / {@code rerankSupported=false}，
     * 让参数合并器把 hybrid 降级为 vector 并记录原因，前端也能据此置灰。
     *
     * @return {@link EngineCapabilities#unsupported()}
     */
    @Override
    public EngineCapabilities capabilities() {
        return EngineCapabilities.unsupported();
    }
}
