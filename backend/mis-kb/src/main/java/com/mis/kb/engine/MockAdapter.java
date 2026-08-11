package com.mis.kb.engine;

import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.CreateLibraryCmd;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.model.EngineLibraryBrief;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQuery;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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

    /**
     * 内存 dataset 表：{@code nativeId → 名字}。
     *
     * <p>T02 引入，给对账相关单测提供可控样本（引擎缺失 / 游离 / 名称漂移 / 一致）。
     * 用 {@link LinkedHashMap} 保证列举顺序稳定，断言才好写。
     */
    private final Map<String, String> datasets = new LinkedHashMap<>();

    @Override
    public EngineLibraryRef createLibrary(CreateLibraryCmd cmd) {
        String nativeId = "mock-ds-" + cmd.name();
        datasets.put(nativeId,
                RagflowDatasetNaming.forCreate(cmd.topCategoryName(), cmd.name(), cmd.libraryId()));
        return new EngineLibraryRef(ENGINE_TYPE, nativeId);
    }

    @Override
    public void updateLibrarySettings(EngineLibraryRef ref, RagSettings settings) {
        // no-op
    }

    @Override
    public void deleteLibrary(EngineLibraryRef ref) {
        if (ref != null && ref.nativeId() != null) {
            datasets.remove(ref.nativeId());
        }
    }

    @Override
    public void renameLibrary(EngineLibraryRef ref, String newName) {
        if (ref == null || ref.nativeId() == null) {
            return;
        }
        // 与真实适配器一致：只改名，不新建。不存在的 dataset 不凭空造出来，
        // 否则「引擎缺失」这种对账样本永远构造不出来。
        if (datasets.containsKey(ref.nativeId())) {
            datasets.put(ref.nativeId(), newName);
        }
    }

    @Override
    public List<EngineLibraryBrief> listLibraries() {
        List<EngineLibraryBrief> result = new ArrayList<>(datasets.size());
        for (Map.Entry<String, String> entry : datasets.entrySet()) {
            result.add(EngineLibraryBrief.of(entry.getKey(), entry.getValue()));
        }
        return result;
    }

    /**
     * 直接注入一条引擎侧 dataset（仅测试用，用来构造「游离 / 漂移」样本）。
     *
     * @param nativeId 引擎原生 id
     * @param name     dataset 名
     */
    public void seedDataset(String nativeId, String name) {
        datasets.put(nativeId, name);
    }

    /**
     * 移除一条引擎侧 dataset（仅测试用，用来构造「引擎缺失」样本）。
     *
     * @param nativeId 引擎原生 id
     */
    public void removeDataset(String nativeId) {
        datasets.remove(nativeId);
    }

    /** 清空内存 dataset 表（仅测试用）。 */
    public void clearDatasets() {
        datasets.clear();
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
     * <p>T02 起 {@code deleteSupported} 同样为 {@code true}：mock 引擎的删除是内存 map
     * remove，本来就"支持"；这样 CI 才能覆盖 {@code physical} 删除成功的那条分支
     * （真实 ragflow 因配置 false 永远走不到）。
     *
     * <p>企业级增强一期（KE-06/KE-07）起 {@code parser_ocr}/{@code parser_overlap} 同样为
     * {@code true}：mock 引擎没有真实 parser_config 下发，声明支持让 CI 能覆盖 OCR/overlap
     * 参数合并、校验、UI 回显的完整分支（真实 ragflow 本期恒 false 走置灰分支）。
     *
     * @return 七项能力全开的声明
     */
    @Override
    public EngineCapabilities capabilities() {
        return EngineCapabilities.of(true, true, true, true, true, true, true);
    }
}
