package com.mis.adminbff.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.adminbff.config.AgentOpsProperties;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Map;

/**
 * ai-platform 下游客户端（智能体运营控制台）。
 *
 * <p>结构对齐既有 {@link KbWebClient}：{@code @Component} + 构造注入 {@code plainWebClientBuilder}
 * + 每个下游端点一个方法。差异只有两处，都是本功能域的客观约束：
 * <ol>
 *   <li><b>两个基址</b>。§4.3 的 58 条里 57 条落 backend（FastAPI:8000），
 *       只有 #54 落 gateway（Node:3100）。合成一个基址会让 #54 永远 404，
 *       而 404 在本模块会被归一成「下游未实现」—— 一个配置错误就此伪装成
 *       「T04 还没做」，直到联调末期才暴露。故显式分开（见 {@link AgentOpsProperties}）。</li>
 *   <li><b>{@link JsonNode} 而非强类型返回</b>。impl-plan §10.2 约定 7 的透传策略 A：
 *       BFF 不参与加工的端点一律原样转发。给它们逐个建 DTO 只会在
 *       ai-platform 加字段时多一次「BFF 没跟着改 ⇒ 字段静默丢失」的机会 ——
 *       这类问题不报错、单测全绿，只有真人在页面上发现少了一列才会暴露。
 *       BFF <b>确实要加工</b>的少数结构（授权 / 企微脱敏 / 会话查询）才建 DTO。</li>
 * </ol>
 *
 * <h2>下游未实现的 19 条</h2>
 * T02 交付时下列下游尚在 T04 排期：agent 技能绑定（#20/#21）、配置文件（#22–#24）、
 * coordination（#25/#26）、会话列表与批量删除（#27/#31）、Worker Catalog（#43/#44）、
 * 调度追踪（#45）、企微 Bot（#48–#54）、审批（#57/#58）。
 * 这些方法<b>照常写全</b>，由 {@link AgentOpsTransport} 在收到 404/405 时抛
 * {@code DownstreamNotImplementedException} → HTTP 501。
 * 不预先在 Java 侧 hardcode「这条没做」，否则 T04 上线后还要回来逐条删判断，
 * 且漏删一条就是一个永久 501 的死端点。
 *
 * <p><b>#27 会拿到 405 而不是 404</b>：ai-platform 的 {@code session.py} 只注册了
 * {@code @router.post("")}，没有 {@code @router.get("")}，路径存在而方法不存在。
 * 只判 404 会让这一条漏进 {@code 50000}，所以传输层两个码都收。
 */
@Component
public class AgentOpsClient extends AgentOpsTransport {

    // ---- 下游路径前缀（集中定义，避免散落在 50 多个方法里各写各的）----
    private static final String SKILLS = "/api/v1/skills";
    private static final String AGENTS = "/api/v1/agents";
    private static final String SESSIONS = "/api/v1/sessions";
    private static final String MCP = "/api/v1/mcp";
    private static final String ADMIN = "/api/v1/admin";
    /** HITL 审批与主动推送域（T04 收口：审批端点从 /admin 迁到 /push）。 */
    private static final String PUSH = "/api/v1/push";

    public AgentOpsClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            AgentOpsProperties properties,
            ObjectMapper objectMapper) {
        super(
                plainBuilder.clone().baseUrl(properties.getBackendBaseUrl()).build(),
                plainBuilder.clone().baseUrl(properties.getGatewayBaseUrl()).build(),
                properties.getTimeoutMs(),
                properties.getChatTimeoutMs(),
                objectMapper);
    }

    // ==================================================================
    // 技能池 §4.3 #1–#9
    // ==================================================================

    /** #1 {@code GET /api/v1/skills}。 */
    public JsonNode listSkills(Map<String, String> query) {
        return getJson(builder -> AgentOpsUri.query(builder.path(SKILLS), query).build(),
                "GET " + SKILLS);
    }

    /** #2 {@code GET /api/v1/skills/stats}。 */
    public JsonNode skillStats() {
        return getJson(builder -> builder.path(SKILLS + "/stats").build(), "GET " + SKILLS + "/stats");
    }

    /**
     * #3 {@code GET /api/v1/skills/{id}}。
     *
     * <p>{@code id} 允许含点（V21 里就有 {@code member.profile} 这种）。这里走
     * {@code UriBuilder.build(Object...)} 的模板展开，点号会被原样保留并正确编码；
     * 手工拼字符串则要自己处理编码，容易在含点或含中文的 id 上出错。
     */
    public JsonNode getSkill(String skillId) {
        return getJson(builder -> builder.path(SKILLS + "/{id}").build(skillId), "GET " + SKILLS + "/{id}");
    }

    /** #4 {@code POST /api/v1/skills}。 */
    public JsonNode createSkill(Object body) {
        return postJson(builder -> builder.path(SKILLS).build(), body, "POST " + SKILLS);
    }

    /** #5 {@code PUT /api/v1/skills/{id}}。 */
    public JsonNode updateSkill(String skillId, Object body) {
        return putJson(builder -> builder.path(SKILLS + "/{id}").build(skillId), body,
                "PUT " + SKILLS + "/{id}");
    }

    /** #6 {@code DELETE /api/v1/skills/{id}}。 */
    public JsonNode deleteSkill(String skillId) {
        return deleteJson(builder -> builder.path(SKILLS + "/{id}").build(skillId),
                "DELETE " + SKILLS + "/{id}");
    }

    /** #7 {@code POST /api/v1/skills/{id}/enable}。 */
    public JsonNode enableSkill(String skillId) {
        return postJson(builder -> builder.path(SKILLS + "/{id}/enable").build(skillId), null,
                "POST " + SKILLS + "/{id}/enable");
    }

    /** #8 {@code POST /api/v1/skills/{id}/disable}。 */
    public JsonNode disableSkill(String skillId) {
        return postJson(builder -> builder.path(SKILLS + "/{id}/disable").build(skillId), null,
                "POST " + SKILLS + "/{id}/disable");
    }

    /** #9 {@code POST /api/v1/skills/reindex}。 */
    public JsonNode reindexSkills() {
        return postJson(builder -> builder.path(SKILLS + "/reindex").build(), null,
                "POST " + SKILLS + "/reindex");
    }

    /** 解析 SKILL.md（透传）。body `{content}`，下游回 `{metadata, body}`。 */
    public JsonNode parseSkill(Object body) {
        return postJson(builder -> builder.path(SKILLS + "/parse").build(), body,
                "POST " + SKILLS + "/parse");
    }

    // ==================================================================
    // Agent §4.3 #13–#26
    // ==================================================================

    /** #13 {@code GET /api/v1/agents}。 */
    public JsonNode listAgents(Map<String, String> query) {
        return getJson(builder -> AgentOpsUri.query(builder.path(AGENTS), query).build(), "GET " + AGENTS);
    }

    /** #14 {@code GET /api/v1/agents/{id}}。 */
    public JsonNode getAgent(String agentId) {
        return getJson(builder -> builder.path(AGENTS + "/{id}").build(agentId), "GET " + AGENTS + "/{id}");
    }

    /**
     * #15–#18 生命周期动作：{@code start / pause / resume / stop}。
     *
     * <p>四个动作合成一个方法而不是写四遍：它们的差异只有路径末段一个词，
     * 复制四份等于把同一处改动风险乘以四。调用方由 Facade 用常量约束，
     * 不存在传入任意字符串的路径。
     *
     * @param action 必须是 {@code start|pause|resume|stop} 之一
     */
    public JsonNode agentLifecycle(String agentId, String action) {
        return postJson(builder -> builder.path(AGENTS + "/{id}/{action}").build(agentId, action), null,
                "POST " + AGENTS + "/{id}/" + action);
    }

    /** #19 {@code GET /api/v1/agents/{id}/health}。 */
    public JsonNode agentHealth(String agentId) {
        return getJson(builder -> builder.path(AGENTS + "/{id}/health").build(agentId),
                "GET " + AGENTS + "/{id}/health");
    }

    /** #20 {@code GET /api/v1/agents/{id}/skills}（T04 待建，当前 404 → 501）。 */
    public JsonNode listAgentSkills(String agentId) {
        return getJson(builder -> builder.path(AGENTS + "/{id}/skills").build(agentId),
                "GET " + AGENTS + "/{id}/skills");
    }

    /** #21 {@code PUT /api/v1/agents/{id}/skills}（T04 待建）。 */
    public JsonNode saveAgentSkills(String agentId, Object body) {
        return putJson(builder -> builder.path(AGENTS + "/{id}/skills").build(agentId), body,
                "PUT " + AGENTS + "/{id}/skills");
    }

    /** #22 {@code GET /api/v1/agents/{id}/config-files}（T04 待建）。 */
    public JsonNode configFileTree(String agentId) {
        return getJson(builder -> builder.path(AGENTS + "/{id}/config-files").build(agentId),
                "GET " + AGENTS + "/{id}/config-files");
    }

    /**
     * #23 {@code GET /api/v1/agents/{id}/config-files/{file}}。
     *
     * <p>真实下游把文件路径放在<b>路径段</b>里（ai-platform
     * `@router.get("/{agent_id}/config-files/{file_path:path}")`，随后 `unquote` 还原）。
     * 这里用模板变量 `{file}` + {@code build(agentId, path)}：Spring 会把变量值里的
     * `/` 编码成 `%2F`，下游 `unquote` 后再得到原路径 —— 不再走
     * `/config-files/content?path=` 的 query 形式（那会错打到名为 `content` 的文件）。
     */
    public JsonNode configFileContent(String agentId, String path) {
        return getJson(builder -> builder.path(AGENTS + "/{id}/config-files/{file}")
                        .build(agentId, path),
                "GET " + AGENTS + "/{id}/config-files/{file}");
    }

    /**
     * #24 {@code PUT /api/v1/agents/{id}/config-files/{file}}。
     *
     * <p>路径修正同上；body 只透传 `{content}`（下游 `WriteConfigFileRequest`
     * 只认 content，无 sha256 并发保护）。从入参里摘出 content 重建对象，
     * 避免旧客户端把 `path`/`base_sha256` 一起带过去被忽略或误伤。
     */
    public JsonNode saveConfigFileContent(String agentId, String path, Object body) {
        Object outbound = body;
        if (body instanceof JsonNode node && node.has("content")) {
            outbound = mapper().createObjectNode().set("content", node.get("content"));
        }
        return putJson(builder -> builder.path(AGENTS + "/{id}/config-files/{file}")
                        .build(agentId, path),
                outbound,
                "PUT " + AGENTS + "/{id}/config-files/{file}");
    }

    /** #25 {@code GET /api/v1/agents/{id}/coordination}（T04 待建）。 */
    public JsonNode getCoordination(String agentId) {
        return getJson(builder -> builder.path(AGENTS + "/{id}/coordination").build(agentId),
                "GET " + AGENTS + "/{id}/coordination");
    }

    /** #26 {@code PUT /api/v1/agents/{id}/coordination}（T04 待建）。 */
    public JsonNode saveCoordination(String agentId, Object body) {
        return putJson(builder -> builder.path(AGENTS + "/{id}/coordination").build(agentId), body,
                "PUT " + AGENTS + "/{id}/coordination");
    }

    // ==================================================================
    // 会话与对话 §4.3 #27–#33
    // ==================================================================

    /** #27 {@code GET /api/v1/sessions}（T04 待建；下游只有 POST，故为 <b>405</b> 而非 404）。 */
    public JsonNode listSessions(Map<String, String> query) {
        return getJson(builder -> AgentOpsUri.query(builder.path(SESSIONS), query).build(), "GET " + SESSIONS);
    }

    /** #28 {@code GET /api/v1/sessions/{id}}。 */
    public JsonNode getSession(String sessionId) {
        return getJson(builder -> builder.path(SESSIONS + "/{id}").build(sessionId),
                "GET " + SESSIONS + "/{id}");
    }

    /** #29 {@code GET /api/v1/sessions/{id}/messages}。 */
    public JsonNode sessionMessages(String sessionId, Map<String, String> query) {
        return getJson(builder -> AgentOpsUri.query(builder.path(SESSIONS + "/{id}/messages"), query)
                        .build(sessionId),
                "GET " + SESSIONS + "/{id}/messages");
    }

    /** #30 {@code DELETE /api/v1/sessions/{id}}。 */
    public JsonNode deleteSession(String sessionId) {
        return deleteJson(builder -> builder.path(SESSIONS + "/{id}").build(sessionId),
                "DELETE " + SESSIONS + "/{id}");
    }

    /** #31 {@code POST /api/v1/sessions/batch-delete}（T04 待建）。 */
    public JsonNode batchDeleteSessions(Object body) {
        return postJson(builder -> builder.path(SESSIONS + "/batch-delete").build(), body,
                "POST " + SESSIONS + "/batch-delete");
    }

    // ==================================================================
    // 会话反馈 CF-01 / CF-03 / CF-05
    // ==================================================================

    /**
     * CF-01 {@code GET /api/v1/sessions/feedback}。
     *
     * <p>分页 + rating/comment_only/agent_id/channel/from/to/keyword/status 过滤；
     * 下游默认按「吐槽且 comment 非空」优先排序。操作人/身份走登录上下文头透传。
     */
    public JsonNode listFeedback(Map<String, String> query) {
        return getJson(builder -> AgentOpsUri.query(builder.path(SESSIONS + "/feedback"), query).build(),
                "GET " + SESSIONS + "/feedback");
    }

    /**
     * CF-05 {@code GET /api/v1/sessions/feedback/stats}。
     *
     * <p>基础计数 + 按 agent 维度 + 按日趋势；from/to/agent_id/channel 过滤由门面装配。
     */
    public JsonNode feedbackStats(Map<String, String> query) {
        return getJson(builder -> AgentOpsUri.query(builder.path(SESSIONS + "/feedback/stats"), query).build(),
                "GET " + SESSIONS + "/feedback/stats");
    }

    /**
     * CF-03 {@code POST /api/v1/sessions/feedback/{id}/process}。
     *
     * <p>body {@code {status: handled|ignored, note?}}；操作人经登录上下文头透传下游。
     */
    public JsonNode processFeedback(String feedbackId, Object body) {
        return postJson(builder -> builder.path(SESSIONS + "/feedback/{id}/process").build(feedbackId), body,
                "POST " + SESSIONS + "/feedback/{id}/process");
    }

    /**
     * CF-03 {@code POST /api/v1/sessions/feedback/batch-process}。
     *
     * <p>body {@code {ids[], status, note?}}；单次上限 200 由下游裁定。
     */
    public JsonNode batchProcessFeedback(Object body) {
        return postJson(builder -> builder.path(SESSIONS + "/feedback/batch-process").build(), body,
                "POST " + SESSIONS + "/feedback/batch-process");
    }

    /** #32 {@code POST /api/v1/sessions}（新建对话会话）。 */
    public JsonNode createChatSession(Object body) {
        return postJson(builder -> builder.path(SESSIONS).build(), body, "POST " + SESSIONS);
    }

    /** #33 {@code POST /api/v1/sessions/{id}/messages}，走 {@code chat-timeout-ms}。 */
    public JsonNode sendChatMessage(String sessionId, Object body) {
        return postChatJson(builder -> builder.path(SESSIONS + "/{id}/messages").build(sessionId), body,
                "POST " + SESSIONS + "/{id}/messages");
    }

    // ==================================================================
    // MCP §4.3 #34–#42
    //
    // 注意下游路径是 /api/v1/mcp 而非 /api/v1/mcp/servers —— BFF 侧多出的
    // servers 段是给前端的语义化命名（同一个 mcp 域后续还会挂 tools 等子资源），
    // 与下游不是同形。照抄 BFF 路径去请求下游会全线 404。
    // ==================================================================

    /** #34 {@code GET /api/v1/mcp}。 */
    public JsonNode listMcpServers() {
        return getJson(builder -> builder.path(MCP).build(), "GET " + MCP);
    }

    /** #35 {@code GET /api/v1/mcp/health}。 */
    public JsonNode mcpHealth() {
        return getJson(builder -> builder.path(MCP + "/health").build(), "GET " + MCP + "/health");
    }

    /** #36 {@code GET /api/v1/mcp/{name}}。 */
    public JsonNode getMcpServer(String name) {
        return getJson(builder -> builder.path(MCP + "/{name}").build(name), "GET " + MCP + "/{name}");
    }

    /** #37 {@code GET /api/v1/mcp/{name}/tools}。 */
    public JsonNode mcpTools(String name) {
        return getJson(builder -> builder.path(MCP + "/{name}/tools").build(name),
                "GET " + MCP + "/{name}/tools");
    }

    /** #38 {@code POST /api/v1/mcp}。 */
    public JsonNode createMcpServer(Object body) {
        return postJson(builder -> builder.path(MCP).build(), body, "POST " + MCP);
    }

    /**
     * #39–#41 连接态动作：{@code connect / disconnect / discover}。
     *
     * @param action 必须是 {@code connect|disconnect|discover} 之一
     */
    public JsonNode mcpAction(String name, String action) {
        return postJson(builder -> builder.path(MCP + "/{name}/{action}").build(name, action), null,
                "POST " + MCP + "/{name}/" + action);
    }

    /** #42 {@code POST /api/v1/mcp/{name}/call}（高危，权限码 {@code agent:mcp:call}）。 */
    public JsonNode callMcpTool(String name, Object body) {
        return postJson(builder -> builder.path(MCP + "/{name}/call").build(name), body,
                "POST " + MCP + "/{name}/call");
    }

    // ==================================================================
    // Worker Catalog §4.3 #43–#44（T04 待建）
    // ==================================================================

    /** #43 {@code GET /api/v1/admin/worker-catalog}。 */
    public JsonNode workerCatalog() {
        return getJson(builder -> builder.path(ADMIN + "/worker-catalog").build(),
                "GET " + ADMIN + "/worker-catalog");
    }

    /** #44 {@code PUT /api/v1/admin/worker-catalog}。 */
    public JsonNode saveWorkerCatalog(Object body) {
        return putJson(builder -> builder.path(ADMIN + "/worker-catalog").build(), body,
                "PUT " + ADMIN + "/worker-catalog");
    }

    // ==================================================================
    // 调度观测 §4.3 #45–#47
    // ==================================================================

    /** #45 {@code GET /api/v1/admin/dispatch-traces}（T04 待建）。 */
    public JsonNode dispatchTraces(Map<String, String> query) {
        return getJson(builder -> AgentOpsUri.query(builder.path(ADMIN + "/dispatch-traces"), query).build(),
                "GET " + ADMIN + "/dispatch-traces");
    }

    /** #46 {@code GET /api/v1/admin/route-logs}。 */
    public JsonNode routeLogs(Map<String, String> query) {
        return getJson(builder -> AgentOpsUri.query(builder.path(ADMIN + "/route-logs"), query).build(),
                "GET " + ADMIN + "/route-logs");
    }

    /** #47 {@code GET /api/v1/admin/route-stats}。 */
    public JsonNode routeStats(Map<String, String> query) {
        return getJson(builder -> AgentOpsUri.query(builder.path(ADMIN + "/route-stats"), query).build(),
                "GET " + ADMIN + "/route-stats");
    }

    // ==================================================================
    // 企微 Bot §4.3 #48–#54
    //
    // #48–#53 落 backend；#54 落 gateway —— 这是全表唯一跨进程的一条。
    //
    // ⚠ 路径不带 /admin 段：T04 的 channels 路由在 ai-platform 以
    // `prefix="/api/v1"` 挂载（main.py），router 自身前缀是 `/channels`
    // （channels.py），故最终下游路径是 /api/v1/channels/wecom/bots。
    // 曾在常量里误写 ADMIN + "/channels/wecom/bots"（即 /api/v1/admin/...），
    // 后端 404 被归一成「T04 未实现」——与历史 bug 的表现完全一致。
    // ==================================================================

    private static final String WECOM_BOTS = "/api/v1/channels/wecom/bots";

    /** #48 {@code GET /api/v1/channels/wecom/bots}。 */
    public JsonNode listWecomBots() {
        return getJson(builder -> builder.path(WECOM_BOTS).build(), "GET " + WECOM_BOTS);
    }

    /** #49 {@code POST /api/v1/channels/wecom/bots}。 */
    public JsonNode createWecomBot(Object body) {
        return postJson(builder -> builder.path(WECOM_BOTS).build(), body, "POST " + WECOM_BOTS);
    }

    /** #50 {@code PUT /api/v1/channels/wecom/bots/{botId}}。 */
    public JsonNode updateWecomBot(String botId, Object body) {
        return putJson(builder -> builder.path(WECOM_BOTS + "/{botId}").build(botId), body,
                "PUT " + WECOM_BOTS + "/{botId}");
    }

    /** #51 {@code DELETE /api/v1/channels/wecom/bots/{botId}}。 */
    public JsonNode deleteWecomBot(String botId) {
        return deleteJson(builder -> builder.path(WECOM_BOTS + "/{botId}").build(botId),
                "DELETE " + WECOM_BOTS + "/{botId}");
    }

    /**
     * #52–#53 启停：{@code enable / disable}。
     *
     * @param action 必须是 {@code enable|disable} 之一
     */
    public JsonNode wecomBotToggle(String botId, String action) {
        return postJson(builder -> builder.path(WECOM_BOTS + "/{botId}/{action}").build(botId, action), null,
                "POST " + WECOM_BOTS + "/{botId}/" + action);
    }

    /**
     * #54 Gateway {@code GET /admin/bots/health}。
     *
     * <p>全表唯一走 {@code gateway-base-url} 的一条。WS 连接活在 Node 网关进程里，
     * FastAPI 那边根本没有这份状态，打到 backend 只会拿到 404 —— 而 404 会被归一成
     * 「T04 未实现」，于是一个基址配错会伪装成排期问题。
     */
    public JsonNode wecomBotsHealth() {
        return getGatewayJson(builder -> builder.path("/admin/bots/health").build(),
                "GET gateway /admin/bots/health");
    }

    // ==================================================================
    // 监控与审批 §4.3 #55–#58
    // ==================================================================

    /** #55 组成部分之一：{@code GET /api/v1/admin/proxy/status}。 */
    public JsonNode proxyStatus() {
        return getJson(builder -> builder.path(ADMIN + "/proxy/status").build(),
                "GET " + ADMIN + "/proxy/status");
    }

    /** #55 组成部分之二：{@code GET /api/v1/admin/llm/status}。 */
    public JsonNode llmStatus() {
        return getJson(builder -> builder.path(ADMIN + "/llm/status").build(),
                "GET " + ADMIN + "/llm/status");
    }

    /** #55 组成部分之三：{@code GET /api/v1/admin/health}，用于 agents 运行数。 */
    public JsonNode adminHealth() {
        return getJson(builder -> builder.path(ADMIN + "/health").build(), "GET " + ADMIN + "/health");
    }

    /** #56 {@code POST /api/v1/admin/failover/reset}。 */
    public JsonNode resetFailover(Object body) {
        return postJson(builder -> builder.path(ADMIN + "/failover/reset").build(), body,
                "POST " + ADMIN + "/failover/reset");
    }

    /**
     * #57 {@code GET /api/v1/push/approvals}（HITL）。
     *
     * <p>T04 收口：真实下游在 `/push` 域（`api/routes/push.py`），不在 `/admin`。
     * query 原样透传 `status` / `user_id` / `limit`。
     */
    public JsonNode listApprovals(Map<String, String> query) {
        return getJson(builder -> AgentOpsUri.query(builder.path(PUSH + "/approvals"), query).build(),
                "GET " + PUSH + "/approvals");
    }

    /**
     * #58 {@code POST /api/v1/push/approvals/{id}/respond}（HITL）。
     *
     * <p>T04 收口两处修正：路径从 `/admin/approvals/{id}/decision` 迁到
     * `/push/approvals/{id}/respond`；body 从前端透传的 `{approved, comment}`
     * 加工成下游契约 `{decision: "approved"|"rejected", comment}` —— 归一下游
     * 契约是 BFF 的既有职责，前端 `decideApproval` 语义保持不变。
     */
    public JsonNode decideApproval(String approvalId, Object body) {
        boolean approved = false;
        String comment = "";
        if (body instanceof JsonNode node) {
            approved = node.path("approved").asBoolean(false);
            comment = node.path("comment").asText("");
        }
        ObjectNode outbound = mapper().createObjectNode();
        outbound.put("decision", approved ? "approved" : "rejected");
        outbound.put("comment", comment == null ? "" : comment);
        return postJson(builder -> builder.path(PUSH + "/approvals/{id}/respond").build(approvalId),
                outbound,
                "POST " + PUSH + "/approvals/{id}/respond");
    }
}
