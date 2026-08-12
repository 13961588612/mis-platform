package com.mis.kb.engine;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 引擎连接配置（S-04）。
 *
 * <p>优先由 Nacos 的 {@code mis.kb.engine.*} 覆盖；本地/CI 默认 {@code type=noop}（无 RAGFlow 实例也可编译跑通）。
 * 不建配置表；{@code apiKey} 仅服务端持有，禁止进 Git。
 */
@ConfigurationProperties(prefix = "mis.kb.engine")
public class RagflowProperties {

    /** ragflow / noop / mock。 */
    private String type = "noop";

    /** RAGFlow 基础地址，如 http://ragflow:80。 */
    private String baseUrl = "";

    /** RAGFlow API Key（Bearer）。 */
    private String apiKey = "";

    /**
     * 全局重排模型 ID（WA-05，如 {@code BAAI/bge-reranker-v2-m3}）。
     *
     * <p><b>刻意做成平台级而非库级</b>（主理人决策②）：重排模型是要占显存、要运维统一升级的
     * 平台资源，允许每个知识库各挑一个，运维根本收不拢。库级只保留 {@code rerank} 开关。
     *
     * <p>空串 = 全平台禁用重排。此时：
     * <ul>
     *   <li>{@code capabilities().rerankSupported} 返回 false（前端置灰）；</li>
     *   <li>保存 RAG 设置时强制 {@code rerank=false} 并记 WARN（后端兜底）；</li>
     *   <li>检索期合并阶段再判一次，仍为真则降级并记 {@code degradedReasons}（最后一道）。</li>
     * </ul>
     */
    private String rerankModelId = "";

    /**
     * 当前引擎版本是否支持在线删除知识库（dataset）。
     *
     * <p><b>写死配置，不做启动探测</b>（Q5 裁定）。默认 {@code false}：
     * 当前部署的 RAGFLOW 版本删除接口不可用，{@code DELETE ?mode=physical} 一律被拒
     * （{@code KB_ENGINE_DELETE_UNSUPPORTED}），业务侧只能走归档。
     * 等 RAGFLOW 升级（P2）后把这里翻成 {@code true} 即可放开，代码分支无需改动。
     *
     * <p>该值同时决定 {@code capabilities().deleteSupported} 与能力码 {@code "delete"}。
     */
    private boolean deleteSupported = false;

    /**
     * 可开启知识图谱的库数上限（Wave B GraphRAG PoC，U7 裁定进配置）。
     *
     * <p>默认 {@code 2}（主规划 §6「至多 2 个关系密集库可开 Graph」）。
     * {@code useKnowledgeGraph=true} 且当前启用该开关的库数 ≥ 本值 → 拒绝保存/构图
     * （{@code KB_GRAPH_LIBRARY_LIMIT}）。Nacos 可热调，无需重启。
     */
    private int graphMaxLibraries = 2;

    /** 引擎对账配置（定时任务 + 手动触发共用）。 */
    private final Reconcile reconcile = new Reconcile();

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getRerankModelId() {
        return rerankModelId;
    }

    public void setRerankModelId(String rerankModelId) {
        this.rerankModelId = rerankModelId;
    }

    public boolean isDeleteSupported() {
        return deleteSupported;
    }

    public void setDeleteSupported(boolean deleteSupported) {
        this.deleteSupported = deleteSupported;
    }

    public int getGraphMaxLibraries() {
        return graphMaxLibraries;
    }

    public void setGraphMaxLibraries(int graphMaxLibraries) {
        this.graphMaxLibraries = graphMaxLibraries;
    }

    /**
     * 归一化后的图谱库数上限（防配 0 或负数导致「一库都开不了」）。
     *
     * @return 至少为 1 的上限值
     */
    public int effectiveGraphMaxLibraries() {
        return Math.max(graphMaxLibraries, 1);
    }

    public Reconcile getReconcile() {
        return reconcile;
    }

    /**
     * 是否已配置全局重排模型。
     *
     * @return 模型 ID 非空白返回 {@code true}
     */
    public boolean hasRerankModel() {
        return rerankModelId != null && !rerankModelId.isBlank();
    }

    /**
     * 是否为真实 RAGFlow 引擎。
     *
     * <p>对账服务的入口护栏用：noop/mock 的 {@code listLibraries()} 返回空列表，
     * 直接对账会把全部 MIS 库判成「引擎缺失」并批量写坏 {@code engine_sync_status}。
     *
     * @return {@code type} 为 {@code ragflow}（忽略大小写与首尾空白）返回 {@code true}
     */
    public boolean isRagflow() {
        return type != null && "ragflow".equalsIgnoreCase(type.trim());
    }

    /**
     * 引擎对账配置（{@code mis.kb.engine.reconcile.*}）。
     *
     * <p>{@code enabled} 刻意不用 {@code @ConditionalOnProperty}——那样只能重启生效，
     * 而运维需要在 Nacos 里热关。定时方法体第一行读本值直接 return 即可。
     */
    public static class Reconcile {

        /** 定时对账总开关（热调）。 */
        private boolean enabled = true;

        /** 定时对账间隔，毫秒。默认 30 分钟。 */
        private long intervalMs = 1_800_000L;

        /** {@code listDatasets} 分页大小。 */
        private int pageSize = 100;

        /** 分页拉取的硬上限，防引擎侧 dataset 巨多时打爆。 */
        private int maxPages = 50;

        /** ShedLock 最长持锁时长（实例崩溃后锁自动释放的兜底）。 */
        private String lockAtMostFor = "PT10M";

        /** ShedLock 最短持锁时长（防同一窗口内多实例连续抢跑）。 */
        private String lockAtLeastFor = "PT30S";

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public long getIntervalMs() {
            return intervalMs;
        }

        public void setIntervalMs(long intervalMs) {
            this.intervalMs = intervalMs;
        }

        public int getPageSize() {
            return pageSize;
        }

        public void setPageSize(int pageSize) {
            this.pageSize = pageSize;
        }

        public int getMaxPages() {
            return maxPages;
        }

        public void setMaxPages(int maxPages) {
            this.maxPages = maxPages;
        }

        public String getLockAtMostFor() {
            return lockAtMostFor;
        }

        public void setLockAtMostFor(String lockAtMostFor) {
            this.lockAtMostFor = lockAtMostFor;
        }

        public String getLockAtLeastFor() {
            return lockAtLeastFor;
        }

        public void setLockAtLeastFor(String lockAtLeastFor) {
            this.lockAtLeastFor = lockAtLeastFor;
        }

        /**
         * 归一化后的分页大小（防配 0 或负数导致死循环）。
         *
         * @return 落在 {@code [1, 1000]} 内的分页大小
         */
        public int effectivePageSize() {
            if (pageSize < 1) {
                return 1;
            }
            return Math.min(pageSize, 1000);
        }

        /**
         * 归一化后的最大页数（防配 0 导致一页都不拉）。
         *
         * @return 至少为 1 的页数上限
         */
        public int effectiveMaxPages() {
            return Math.max(maxPages, 1);
        }
    }
}
