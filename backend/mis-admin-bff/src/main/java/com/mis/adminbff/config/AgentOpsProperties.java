package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 智能体运营控制台（agent_ops_console）下游适配配置。
 *
 * <p>对应 impl-plan §9.2 的 {@code mis.agent-ops.*}。本配置只描述 <b>BFF 往哪里发请求</b>，
 * 不含任何认证材料 —— MIS JWT → ai-platform 的信任链由既有
 * {@code AiPlatformTrustConfig} + {@code AbstractDownstreamClient.loginContextHeaders()}
 * 承担（impl-plan §10.2 约定 8：<b>不新建认证机制</b>）。
 *
 * <h3>为什么需要两个 base-url</h3>
 * §4.3 的 58 条端点里，<b>57 条</b>落到 ai-platform backend（FastAPI，默认 8000），
 * 只有 <b>#54 {@code GET /channels/wecom/bots/health}</b> 落到 ai-platform gateway
 * （Node，默认 3100）的 {@code /admin/bots/health}。两者是<b>不同进程、不同端口</b>，
 * 合成一个 base-url 会让 #54 永远 404 —— 而 404 在本模块会被归一成「下游未实现」，
 * 于是这个配置错误会伪装成「T04 还没做」，一直到联调末期才暴露。故显式分开。
 *
 * <h3>端口取值的分歧（已核对，取 3100）</h3>
 * {@code spec.md §2.1} 与本次派单均写 <b>3100</b>，{@code impl-plan §9.2} 的示例片段写的是
 * 3000。此处以 spec.md 为准取 <b>3100</b>，并在交付报告中列为文档待订正项。
 * 部署时可用环境变量 {@code AGENT_OPS_GATEWAY_BASE_URL} 覆盖，不必改代码。
 */
@ConfigurationProperties(prefix = "mis.agent-ops")
public class AgentOpsProperties {

    /**
     * ai-platform backend（FastAPI）基址，承载 §4.3 中除 #54 外的全部端点。
     *
     * <p>融合部署用服务名 {@code http://ai-platform-backend:8000}；本地开发务必用
     * {@code 127.0.0.1} 而非 {@code localhost} —— Windows 上 {@code localhost} 会先解析到
     * {@code ::1}，而 uvicorn 默认只监听 IPv4，表现为「服务明明起着却连不上」
     * （与既有 {@code mis.ai-platform.base-url} 的 R1 备注同源）。
     */
    private String backendBaseUrl = "http://ai-platform-backend:8000";

    /** ai-platform gateway（Node）基址，<b>仅</b>供 §4.3 #54 企微 Bot 健康探测使用。 */
    private String gatewayBaseUrl = "http://ai-platform-gateway:3100";

    /**
     * 常规调用超时（毫秒）。
     *
     * <p>比 {@code mis.bff.aggregate-timeout-ms}（3000）宽松：运营台的下游动作里
     * 「启动 Agent」「重建技能索引」「连接 MCP 服务器」都涉及真实的进程/网络初始化，
     * 3 秒会把正常操作误判成超时。
     */
    private long timeoutMs = 15000;

    /**
     * 对话类调用超时（毫秒），用于 §4.3 #33 {@code POST /chat/sessions/{id}/messages}。
     *
     * <p>这一跳背后是一次完整的 LLM 推理，与其它端点不是一个数量级；
     * 复用 {@link #timeoutMs} 会让「消息发出去了、BFF 先超时」成为常态 ——
     * 用户看到失败，下游其实已经写入会话，属于最难排查的一类不一致。
     */
    private long chatTimeoutMs = 60000;

    public String getBackendBaseUrl() {
        return backendBaseUrl;
    }

    public void setBackendBaseUrl(String backendBaseUrl) {
        this.backendBaseUrl = backendBaseUrl;
    }

    public String getGatewayBaseUrl() {
        return gatewayBaseUrl;
    }

    public void setGatewayBaseUrl(String gatewayBaseUrl) {
        this.gatewayBaseUrl = gatewayBaseUrl;
    }

    public long getTimeoutMs() {
        return timeoutMs;
    }

    public void setTimeoutMs(long timeoutMs) {
        this.timeoutMs = timeoutMs;
    }

    public long getChatTimeoutMs() {
        return chatTimeoutMs;
    }

    public void setChatTimeoutMs(long chatTimeoutMs) {
        this.chatTimeoutMs = chatTimeoutMs;
    }
}
