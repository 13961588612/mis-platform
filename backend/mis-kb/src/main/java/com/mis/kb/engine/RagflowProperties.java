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

    /**
     * 是否已配置全局重排模型。
     *
     * @return 模型 ID 非空白返回 {@code true}
     */
    public boolean hasRerankModel() {
        return rerankModelId != null && !rerankModelId.isBlank();
    }
}
