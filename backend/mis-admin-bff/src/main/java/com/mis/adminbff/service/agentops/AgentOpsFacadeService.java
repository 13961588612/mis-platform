package com.mis.adminbff.service.agentops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.adminbff.client.AgentOpsClient;
import com.mis.adminbff.client.AgentOpsUri;
import com.mis.adminbff.dto.agentops.SessionQuery;
import com.mis.adminbff.dto.agentops.SkillUpsertRequest;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 智能体运营控制台门面（§4.3 全量透明端点 + 两处 BFF 加工）。
 *
 * <h2>为什么透明端点也走门面而不是 Controller 直连 Client</h2>
 * 透传端点（策略 A，返回 {@link JsonNode}）在 BFF 这层「什么都不做」，但让它们
 * 各自直接依赖 {@link AgentOpsClient} 会把「下游契约」散落到 30 多个 Controller 方法里。
 * 一旦 ai-platform 改路径前缀（历史上确实发生过 {@code /mcp} ↔ {@code /mcp/servers} 的错位），
 * 改动点就从「Client 一处」扩散成「Client + 所有 Controller」。门面把这道边界收口在 Service 层，
 * 真正「什么都不做」的方法集中在这一个文件，未来改路径只动 Client。
 *
 * <h2>本门面承担的加工</h2>
 * <ul>
 *   <li><b>新建技能后懒注册执行码</b>（{@link #createSkill}）：详见
 *       {@code SkillPermissionCodeService} —— 技能一建出来就必须可授权，否则授权页第一次打开
 *       还要等一次补建，体验上像「建完技能点不开授权」。</li>
 *   <li><b>监控总览聚合</b>（{@link #monitorOverview}）：#55 在 SQL 里是<b>一条</b>端点，
 *       但真实数据是三个下游只读接口拼出来的。聚合放在 BFF，前端一次请求拿齐，
 *       而不是并发打三个接口再自己拼 —— 并发失败的竞态、部分的 loading 状态都留给后端处理。</li>
 *   <li><b>新建对话会话注入 {@code user_id}</b>（{@link #createChatSession}）：下游
 *       {@code POST /api/v1/sessions} 强制要求 body {@code user_id}；Web 渠道该字段即为
 *       MIS userId。前端只传 {@code agent_id}，由本门面从登录上下文写入，禁止信任客户端伪造。</li>
 * </ul>
 *
 * <h2>会话列表的分页兜底在门面里做</h2>
 * {@link #listSessions} 接收已校验的 {@link SessionQuery}，在这里归一 {@code page / page_size}
 * （缺省 1 / 20，上限 200）后转成 snake_case 参数表下发给下游。具体理由见
 * {@code SessionQuery} 类注释：分页封顶是运营台流量的全局防线，不该下放给下游去迁就单个前端。
 */
@Service
public class AgentOpsFacadeService {

    private static final Logger log = LoggerFactory.getLogger(AgentOpsFacadeService.class);

    private final AgentOpsClient client;
    private final SkillPermissionCodeService skillPermissionCodeService;
    private final ObjectMapper objectMapper;

    public AgentOpsFacadeService(
            AgentOpsClient client,
            SkillPermissionCodeService skillPermissionCodeService,
            ObjectMapper objectMapper) {
        this.client = client;
        this.skillPermissionCodeService = skillPermissionCodeService;
        this.objectMapper = objectMapper;
    }

    // ==================================================================
    // 技能池 §4.3 #1–#9
    // ==================================================================

    /** #1 技能列表（透传）。 */
    public JsonNode listSkills(Map<String, String> query) {
        return client.listSkills(query);
    }

    /** #2 技能统计（透传）。 */
    public JsonNode skillStats() {
        return client.skillStats();
    }

    /** #3 技能详情（透传）。 */
    public JsonNode getSkill(String skillId) {
        return client.getSkill(skillId);
    }

    /**
     * #4 新建技能（加工：建完即补执行码）。
     *
     * <p>先下创建请求，再 {@code ensureCode}。顺序不能反 —— 下游还没这个技能时补码虽然
     * 不依赖技能实体存在（码挂在 mis-system 菜单树，与 ai-platform 的技能记录解耦），
     * 但「先建技能再补码」能让用户在创建成功的同一页面立刻进授权，
     * 不用等下一次进授权页时再触发懒注册。
     *
     * <p>{@code skillId} 必填由本方法显式校验（{@link SkillUpsertRequest#normalizedId()}
     * 不强制），报错信息比注解式校验更贴合场景。
     *
     * @param request 新建请求
     * @return 下游返回的已建技能（透传）
     */
    public JsonNode createSkill(SkillUpsertRequest request) {
        String skillId = request.normalizedId();
        if (skillId == null) {
            throw new BusinessException(AgentOpsErrorCodes.SKILL_CODE_UNAVAILABLE, "新建技能必须指定 ID");
        }
        JsonNode created = client.createSkill(request);
        // 双调用点其一：技能一建出来就保证可授权（另一处在进入授权页时，兜历史技能）
        skillPermissionCodeService.ensureCode(skillId);
        return created;
    }

    /** #5 编辑技能（透传）。 */
    public JsonNode updateSkill(String skillId, JsonNode body) {
        return client.updateSkill(skillId, body);
    }

    /** #6 删除技能（透传）。 */
    public JsonNode deleteSkill(String skillId) {
        return client.deleteSkill(skillId);
    }

    /** #7 启用技能（透传）。 */
    public JsonNode enableSkill(String skillId) {
        return client.enableSkill(skillId);
    }

    /** #8 停用技能（透传）。 */
    public JsonNode disableSkill(String skillId) {
        return client.disableSkill(skillId);
    }

    /** #9 重建索引（透传）。 */
    public JsonNode reindexSkills() {
        return client.reindexSkills();
    }

    /** 解析 SKILL.md（透传）。 */
    public JsonNode parseSkill(JsonNode body) {
        return client.parseSkill(body);
    }

    /** AI 对话创建技能（C 功能，透传，走 chat 超时）。 */
    public JsonNode builderChat(JsonNode body) {
        return client.builderChat(body);
    }

    // ==================================================================
    // Agent §4.3 #13–#26
    // ==================================================================

    /** #13 Agent 列表（透传）。 */
    public JsonNode listAgents(Map<String, String> query) {
        return client.listAgents(query);
    }

    /** #14 Agent 详情（透传）。 */
    public JsonNode getAgent(String agentId) {
        return client.getAgent(agentId);
    }

    /** #15–#18 生命周期动作（透传）。 */
    public JsonNode agentLifecycle(String agentId, String action) {
        return client.agentLifecycle(agentId, action);
    }

    /** #19 Agent 健康（透传）。 */
    public JsonNode agentHealth(String agentId) {
        return client.agentHealth(agentId);
    }

    /** #20 可用技能（透传，T04 待建）。 */
    public JsonNode listAgentSkills(String agentId) {
        return client.listAgentSkills(agentId);
    }

    /** #21 保存技能绑定（透传，T04 待建）。 */
    public JsonNode saveAgentSkills(String agentId, JsonNode body) {
        return client.saveAgentSkills(agentId, body);
    }

    /** #22 配置文件树（透传，T04 待建）。 */
    public JsonNode configFileTree(String agentId) {
        return client.configFileTree(agentId);
    }

    /**
     * #23 读取配置文件。
     *
     * <p>Spring {@code {*file}} 捕获值带前导 {@code /}（如 {@code /runtime/prompts/system.md}），
     * 下游 {@code resolve_path} 会按绝对路径拒绝；此处剥成相对路径再转发。
     */
    public JsonNode configFileContent(String agentId, String path) {
        return client.configFileContent(agentId, relativeConfigPath(path));
    }

    /**
     * #24 保存配置文件（路径语义同 {@link #configFileContent}）。
     */
    public JsonNode saveConfigFileContent(String agentId, String path, JsonNode body) {
        return client.saveConfigFileContent(agentId, relativeConfigPath(path), body);
    }

    /**
     * 把 Controller {@code {*file}} 捕获的路径规范成下游要求的 POSIX 相对路径。
     */
    static String relativeConfigPath(String path) {
        if (path == null || path.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "配置文件路径不能为空");
        }
        String normalized = path.replace('\\', '/');
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        if (normalized.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "配置文件路径不能为空");
        }
        return normalized;
    }

    /** #25 读取调度配置（透传，T04 待建）。 */
    public JsonNode getCoordination(String agentId) {
        return client.getCoordination(agentId);
    }

    /** #26 保存调度配置（透传，T04 待建）。 */
    public JsonNode saveCoordination(String agentId, JsonNode body) {
        return client.saveCoordination(agentId, body);
    }

    // ==================================================================
    // 会话与对话 §4.3 #27–#33
    // ==================================================================

    /**
     * #27 会话列表（加工：分页归一）。
     *
     * @param query 已对齐前端字段的查询条件
     * @return 下游会话列表（透传）
     */
    public JsonNode listSessions(SessionQuery query) {
        Map<String, String> params = AgentOpsUri.of(
                "agent_id", query.agentId(),
                "channel", query.channel(),
                "keyword", query.keyword(),
                "from", query.from(),
                "to", query.to(),
                "page", query.normalizedPage(),
                "page_size", query.normalizedPageSize());
        return client.listSessions(params);
    }

    /** #28 会话详情（透传）。 */
    public JsonNode getSession(String sessionId) {
        return client.getSession(sessionId);
    }

    /** #29 会话消息（透传）。 */
    public JsonNode sessionMessages(String sessionId, Map<String, String> query) {
        return client.sessionMessages(sessionId, query);
    }

    /** #30 删除会话（透传）。 */
    public JsonNode deleteSession(String sessionId) {
        return client.deleteSession(sessionId);
    }

    /** #31 批量删除（透传，T04 待建）。 */
    public JsonNode batchDeleteSessions(JsonNode body) {
        return client.batchDeleteSessions(body);
    }

    /** A-5 会话最近一轮各阶段耗时（透传，T01 新增）。 */
    public JsonNode getSessionTiming(String sessionId) {
        return client.getSessionTiming(sessionId);
    }

    /** A-6 批量会话耗时（透传，列表「耗时」列用，T01 新增）。 */
    public JsonNode batchSessionTiming(JsonNode body) {
        return client.batchSessionTiming(body);
    }

    // ==================================================================
    // 会话反馈 CF-01 / CF-03 / CF-05
    // ==================================================================

    /**
     * CF-01 会话反馈列表（加工：分页归一 + 参数装配）。
     *
     * <p>分页兜底与 {@link #listSessions} 同款：page 缺省 1、page_size 缺省 20 且封顶 200。
     * 其余条件原样装配，null/空串自动剔除（{@link AgentOpsUri#of}）。操作人/身份不在此组装——
     * 走 {@code AgentOpsTransport} 的登录上下文头透传（X-User-Id / X-Username），
     * 与既有会话端点保持一致。
     *
     * @param rating       反馈方向：up / down；null = 不限
     * @param commentOnly  仅看带说明的反馈；null = 不限
     * @param agentId      按 Agent 过滤；null = 不限
     * @param channel      按渠道过滤；null = 不限
     * @param from         起始时间（ISO-8601）
     * @param to           截止时间（ISO-8601）
     * @param keyword      关键词（评论 / 回答摘要）
     * @param status       处理状态：pending / handled / ignored；null = 不限
     * @param page         页码，从 1 开始
     * @param pageSize     每页条数
     * @return 下游反馈分页（透传）
     */
    public JsonNode listFeedback(
            String rating, Boolean commentOnly, String agentId, String channel,
            String from, String to, String keyword, String status,
            Integer page, Integer pageSize) {
        Map<String, String> params = AgentOpsUri.of(
                "rating", rating,
                "comment_only", commentOnly,
                "agent_id", agentId,
                "channel", channel,
                "from", from,
                "to", to,
                "keyword", keyword,
                "status", status,
                "page", normalizedPage(page),
                "page_size", normalizedPageSize(pageSize));
        return client.listFeedback(params);
    }

    /**
     * CF-05 会话反馈统计（加工：参数装配）。
     *
     * @param from     起始时间（ISO-8601）
     * @param to       截止时间（ISO-8601）
     * @param agentId  按 Agent 过滤；null = 不限
     * @param channel  按渠道过滤；null = 不限
     * @return 下游统计（基础计数 + 按 agent + 按日趋势，透传）
     */
    public JsonNode feedbackStats(String from, String to, String agentId, String channel) {
        Map<String, String> params = AgentOpsUri.of(
                "from", from,
                "to", to,
                "agent_id", agentId,
                "channel", channel);
        return client.feedbackStats(params);
    }

    /**
     * CF-03 标记单条反馈已处理/忽略（透传）。
     *
     * <p>操作人身份经 {@code AgentOpsTransport} 的登录上下文头透传下游，不在 body 里注入——
     * 与 {@code listSessions} 同款口径，禁止信任客户端伪造处理人。
     *
     * @param feedbackId 反馈 id
     * @param body       {@code {status: handled|ignored, note?}}
     * @return 更新后的反馈行（透传）
     */
    public JsonNode processFeedback(String feedbackId, JsonNode body) {
        return client.processFeedback(feedbackId, body);
    }

    /**
     * CF-03 批量标记反馈已处理/忽略（透传）。
     *
     * <p>单次上限 200 由下游裁定；操作人透传语义同 {@link #processFeedback}。
     *
     * @param body {@code {ids[], status, note?}}
     * @return 批量处理结果（透传）
     */
    public JsonNode batchProcessFeedback(JsonNode body) {
        return client.batchProcessFeedback(body);
    }

    /**
     * #32 新建对话会话。
     *
     * <p>下游 {@code CreateSessionRequest.user_id} 必填；运营台 Web 对话只提交 {@code agent_id}。
     * 在此用当前登录用户的 MIS {@code userId} 覆盖写入（客户端若带了 {@code user_id} 也不采信），
     * 缺省 {@code channel=web}。
     */
    public JsonNode createChatSession(JsonNode body) {
        ObjectNode payload = body != null && body.isObject()
                ? ((ObjectNode) body).deepCopy()
                : objectMapper.createObjectNode();
        LoginUser user = RequestContext.requireLoginUser();
        if (user.getUserId() == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        payload.put("user_id", String.valueOf(user.getUserId()));
        if (!payload.hasNonNull("channel") || payload.get("channel").asText().isBlank()) {
            payload.put("channel", "web");
        }
        return client.createChatSession(payload);
    }

    /** #33 发送对话消息（透传，走 chat 超时）。 */
    public JsonNode sendChatMessage(String sessionId, JsonNode body) {
        return client.sendChatMessage(sessionId, body);
    }

    // ==================================================================
    // MCP §4.3 #34–#42
    // ==================================================================

    /** #34 MCP 服务器列表（透传）。 */
    public JsonNode listMcpServers() {
        return client.listMcpServers();
    }

    /** #35 MCP 健康（透传）。 */
    public JsonNode mcpHealth() {
        return client.mcpHealth();
    }

    /** #36 MCP 服务器详情（透传）。 */
    public JsonNode getMcpServer(String name) {
        return client.getMcpServer(name);
    }

    /** #37 MCP 工具列表（透传）。 */
    public JsonNode mcpTools(String name) {
        return client.mcpTools(name);
    }

    /** #38 新增 MCP 服务器（透传）。 */
    public JsonNode createMcpServer(JsonNode body) {
        return client.createMcpServer(body);
    }

    /** #39–#41 连接态动作（透传）。 */
    public JsonNode mcpAction(String name, String action) {
        return client.mcpAction(name, action);
    }

    /** #42 手动调用 MCP 工具（透传，高危）。 */
    public JsonNode callMcpTool(String name, JsonNode body) {
        return client.callMcpTool(name, body);
    }

    // ==================================================================
    // Worker Catalog / 调度观测 §4.3 #43–#47
    // ==================================================================

    /** #43 读取 Worker Catalog（透传，T04 待建）。 */
    public JsonNode workerCatalog() {
        return client.workerCatalog();
    }

    /** #44 写回 Worker Catalog（透传，T04 待建）。 */
    public JsonNode saveWorkerCatalog(JsonNode body) {
        return client.saveWorkerCatalog(body);
    }

    /** #45 调度链路追踪（透传，T04 待建）。 */
    public JsonNode dispatchTraces(Map<String, String> query) {
        return client.dispatchTraces(query);
    }

    /** #46 路由日志（透传）。 */
    public JsonNode routeLogs(Map<String, String> query) {
        return client.routeLogs(query);
    }

    /** #47 路由统计（透传）。 */
    public JsonNode routeStats(Map<String, String> query) {
        return client.routeStats(query);
    }

    // ==================================================================
    // 监控与审批 §4.3 #55–#58
    // ==================================================================

    /**
     * #55 监控总览（加工：聚合三个下游只读接口）。
     *
     * <p>SQL 里 #55 是<b>单条</b>端点，但真实数据来自：
     * <ul>
     *   <li>{@code proxyStatus()} —— 反向代理状态；</li>
     *   <li>{@code llmStatus()} —— 大模型网关状态；</li>
     *   <li>{@code adminHealth()} —— agents 运行数等。</li>
     * </ul>
     * 三者任一未实现（下游 404/405）会抛 {@code DownstreamNotImplementedException} → HTTP 501，
     * 此时整条总览 501 是正确行为：总览数据不完整，不该用半截数据伪装成 200。
     *
     * @return {@code {proxy, llm, admin}} 聚合对象
     */
    public JsonNode monitorOverview() {
        ObjectNode root = objectMapper.createObjectNode();
        root.set("proxy", client.proxyStatus());
        root.set("llm", client.llmStatus());
        root.set("admin", client.adminHealth());
        return root;
    }

    /** #56 重置 failover（透传）。 */
    public JsonNode resetFailover(JsonNode body) {
        return client.resetFailover(body);
    }

    /** #57 审批列表（透传，T04 待建）。 */
    public JsonNode listApprovals(Map<String, String> query) {
        return client.listApprovals(query);
    }

    /** #58 审批通过/驳回（透传，T04 待建）。 */
    public JsonNode decideApproval(String approvalId, JsonNode body) {
        return client.decideApproval(approvalId, body);
    }

    // ==================================================================
    // 内部：分页归一（与 SessionQuery 同款兜底，避免反馈列表 page=0 / page_size 越界）
    // ==================================================================

    /**
     * 归一页码，恒 ≥ 1。
     *
     * @param page 原始页码；{@code null} 或 &lt; 1 时回落 1
     * @return 归一后的页码
     */
    private static int normalizedPage(Integer page) {
        return (page == null || page < 1) ? 1 : page;
    }

    /**
     * 归一每页条数，恒落在 [1, 200]。
     *
     * @param pageSize 原始条数；{@code null} 或 &lt; 1 时回落 20，超 200 封顶
     * @return 归一后的条数
     */
    private static int normalizedPageSize(Integer pageSize) {
        if (pageSize == null || pageSize < 1) {
            return 20;
        }
        return Math.min(pageSize, 200);
    }
}
