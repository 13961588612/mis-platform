package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * MCP 服务器（§4.3 #34/#36，对应前端 {@code types.ts:McpServer}）。
 *
 * <p><b>{@code name} 就是主键</b>：MCP 服务器没有数字 ID，§4.3 的 #36–#42
 * 全部以 {@code {name}} 作为路径段。这意味着 name 里若出现 {@code /} 会破坏路由 ——
 * 编码由 {@code AgentOpsClient} 的 {@code UriBuilder} 模板展开负责，
 * 不要在任何地方手工拼接这个路径。
 *
 * @param name      服务器名，主键
 * @param transport {@code stdio} | {@code sse} | {@code http}
 * @param endpoint  连接地址，{@code stdio} 传输时可为 null
 * @param state     {@code connected} | {@code disconnected} | {@code error} | {@code unknown}
 * @param toolCount 已发现工具数
 * @param enabled   是否启用
 * @param updatedAt 最后更新时间
 */
public record McpServerVO(
        @JsonProperty("name") String name,
        @JsonProperty("transport") String transport,
        @JsonProperty("endpoint") String endpoint,
        @JsonProperty("state") String state,
        @JsonProperty("tool_count") Integer toolCount,
        @JsonProperty("enabled") Boolean enabled,
        @JsonProperty("updated_at") String updatedAt) {

    /** 已连接。 */
    public static final String STATE_CONNECTED = "connected";

    /** 状态未知（下游未返回或探测失败）。 */
    public static final String STATE_UNKNOWN = "unknown";

    /** @return 是否处于已连接状态 */
    public boolean isConnected() {
        return STATE_CONNECTED.equals(state);
    }
}
