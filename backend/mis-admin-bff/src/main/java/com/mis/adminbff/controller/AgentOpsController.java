package com.mis.adminbff.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.mis.adminbff.dto.agentops.SessionQuery;
import com.mis.adminbff.dto.agentops.SkillUpsertRequest;
import com.mis.adminbff.service.agentops.AgentOpsFacadeService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 智能体运营控制台 BFF 端点（§4.3 #1–#9、#13–#47、#55–#58）。
 *
 * <h2>路径必须与 {@code sys_api} 注册表逐字一致</h2>
 * V20 登记了 58 行 {@code sys_api}（92100–92157），判权走
 * {@code ApiPermissionInterceptor} + 注册表（T01 已建，见 impl-plan §7.2）。
 * 本模块配 {@code api-permission.deny-unmapped: true}（<b>未映射即拒绝</b>，这是
 * {@code application.yml} 的实际默认值，不是 false）：路径写错会直接 403，而非「悄悄不判权」。
 * 因此每条 {@code @RequestMapping} 的路径与方法都照 SQL 一字未改；新增端点
 * （如 #11 {@code builder/chat}）必须同步在 {@code sys_api} 注册（见 V51），否则上线即 403。
 *
 * <h2>为什么把 50+ 端点塞进一个 Controller</h2>
 * 与 {@code KbSynonymController}「自成一体的子域要独立」相反，这里是<b>同一功能域的
 * 主体</b>，拆成多个类只会增加「这个端点在哪个文件」的认知成本，没有隔离收益。
 * 真正需要独立的是<b>授权域</b>（{@code AgentOpsGrantController}）和<b>企微域</b>
 * （{@code AgentOpsChannelController}）—— 它们各有独立的加工逻辑与权限码族，
 * 混进来只会让本类更难读。
 *
 * <h2>透明端点统一返回 {@code Result<JsonNode>}</h2>
 * 策略 A：BFF 不加工的结构原样透传，用 {@link JsonNode} 承接，下游加字段也不丢。
 * 只有 {@code createSkill} 收强类型 {@link SkillUpsertRequest}（要校验 + 补码），
 * {@code listSessions} 收 {@link SessionQuery}（要归一分页）。
 *
 * <h2>生命周期 / 连接动作的动词约束</h2>
 * {@code /agents/{id}/{action}} 用正则 {@code start|pause|resume|stop} 收口，
 * {@code /mcp/servers/{name}/{action}} 用 {@code connect|disconnect|discover} 收口。
 * 不让调用方传任意字符串拼进路径 —— 凡是能拼路径的入参，就值得在路由层先卡一道。
 *
 * <h2>判权走主路径，不写 {@code @PreAuthorize}</code></h2>
 * 权限码由注册表判定，这里再写注解式判权就成了两个真值来源。
 */
@RestController
@RequestMapping("/api/v1/agent-ops")
public class AgentOpsController {

    private final AgentOpsFacadeService facade;

    public AgentOpsController(AgentOpsFacadeService facade) {
        this.facade = facade;
    }

    // ---------------------------------------------------------------- 技能池 #1–#9

    /** #1 技能列表。 */
    @GetMapping("/skills")
    public Result<JsonNode> listSkills(@RequestParam Map<String, String> query) {
        return Result.ok(facade.listSkills(query));
    }

    /** #2 技能统计。 */
    @GetMapping("/skills/stats")
    public Result<JsonNode> skillStats() {
        return Result.ok(facade.skillStats());
    }

    /** #3 技能详情。 */
    @GetMapping("/skills/{id}")
    public Result<JsonNode> getSkill(@PathVariable String id) {
        return Result.ok(facade.getSkill(id));
    }

    /** #4 新建技能（强类型入参 + 补执行码）。 */
    @PostMapping("/skills")
    public Result<JsonNode> createSkill(@Valid @RequestBody SkillUpsertRequest request) {
        return Result.ok(facade.createSkill(request));
    }

    /** #5 编辑技能。 */
    @PutMapping("/skills/{id}")
    public Result<JsonNode> updateSkill(@PathVariable String id, @RequestBody JsonNode body) {
        return Result.ok(facade.updateSkill(id, body));
    }

    /** #6 删除技能。 */
    @DeleteMapping("/skills/{id}")
    public Result<JsonNode> deleteSkill(@PathVariable String id) {
        return Result.ok(facade.deleteSkill(id));
    }

    /** #7 启用技能。 */
    @PostMapping("/skills/{id}/enable")
    public Result<JsonNode> enableSkill(@PathVariable String id) {
        return Result.ok(facade.enableSkill(id));
    }

    /** #8 停用技能。 */
    @PostMapping("/skills/{id}/disable")
    public Result<JsonNode> disableSkill(@PathVariable String id) {
        return Result.ok(facade.disableSkill(id));
    }

    /** #9 重建技能索引。 */
    @PostMapping("/skills/reindex")
    public Result<JsonNode> reindexSkills() {
        return Result.ok(facade.reindexSkills());
    }

    /** #10 解析 SKILL.md（透传）。 */
    @PostMapping("/skills/parse")
    public Result<JsonNode> parseSkill(@RequestBody JsonNode body) {
        return Result.ok(facade.parseSkill(body));
    }

    /**
     * #11 AI 对话创建技能（C 功能，透传，走 chat 超时）。
     *
     * <p>权限码 {@code agent:skill:manage}（与新建/编辑技能同族），由 V46 在
     * {@code sys_api} 注册表登记；路径必须与注册表逐字一致（见本类文件头）。
     */
    @PostMapping("/skills/builder/chat")
    public Result<JsonNode> builderChat(@RequestBody JsonNode body) {
        return Result.ok(facade.builderChat(body));
    }

    // ---------------------------------------------------------------- Agent #13–#26

    /** #13 Agent 列表。 */
    @GetMapping("/agents")
    public Result<JsonNode> listAgents(@RequestParam Map<String, String> query) {
        return Result.ok(facade.listAgents(query));
    }

    /** #14 Agent 详情。 */
    @GetMapping("/agents/{id}")
    public Result<JsonNode> getAgent(@PathVariable String id) {
        return Result.ok(facade.getAgent(id));
    }

    /** #15–#18 Agent 生命周期动作。 */
    @PostMapping("/agents/{id}/{action:start|pause|resume|stop}")
    public Result<JsonNode> agentLifecycle(@PathVariable String id, @PathVariable String action) {
        return Result.ok(facade.agentLifecycle(id, action));
    }

    /** #19 Agent 健康。 */
    @GetMapping("/agents/{id}/health")
    public Result<JsonNode> agentHealth(@PathVariable String id) {
        return Result.ok(facade.agentHealth(id));
    }

    /** #20 Agent 可用技能（T04 待建）。 */
    @GetMapping("/agents/{id}/skills")
    public Result<JsonNode> listAgentSkills(@PathVariable String id) {
        return Result.ok(facade.listAgentSkills(id));
    }

    /** #21 保存 Agent 技能绑定（T04 待建）。 */
    @PutMapping("/agents/{id}/skills")
    public Result<JsonNode> saveAgentSkills(@PathVariable String id, @RequestBody JsonNode body) {
        return Result.ok(facade.saveAgentSkills(id, body));
    }

    /** #22 配置文件树（T04 待建）。 */
    @GetMapping("/agents/{id}/config-files")
    public Result<JsonNode> configFileTree(@PathVariable String id) {
        return Result.ok(facade.configFileTree(id));
    }

    /**
     * #23 读取配置文件内容。
     *
     * <p>T04 收口：真实下游把文件路径放在路径段里（`/config-files/{file_path:path}`），
     * BFF 侧同步改为 `{*file}` 捕获多段路径（含 `/`），不再用 `?path=` query
     * （那会错打到名为 `content` 的文件）。注意 Spring `{*file}` 捕获值自带前导 `/`，
     * 门面层会剥成下游要求的相对路径后再转发。
     */
    @GetMapping("/agents/{id}/config-files/{*file}")
    public Result<JsonNode> configFileContent(@PathVariable String id, @PathVariable("file") String file) {
        return Result.ok(facade.configFileContent(id, file));
    }

    /** #24 保存配置文件内容（路径语义同上，body 仅 `{content}`）。 */
    @PutMapping("/agents/{id}/config-files/{*file}")
    public Result<JsonNode> saveConfigFileContent(
            @PathVariable String id,
            @PathVariable("file") String file,
            @RequestBody JsonNode body) {
        return Result.ok(facade.saveConfigFileContent(id, file, body));
    }

    /** #25 读取调度配置（T04 待建）。 */
    @GetMapping("/agents/{id}/coordination")
    public Result<JsonNode> getCoordination(@PathVariable String id) {
        return Result.ok(facade.getCoordination(id));
    }

    /** #26 保存调度配置（T04 待建）。 */
    @PutMapping("/agents/{id}/coordination")
    public Result<JsonNode> saveCoordination(@PathVariable String id, @RequestBody JsonNode body) {
        return Result.ok(facade.saveCoordination(id, body));
    }

    // ---------------------------------------------------------------- 会话与对话 #27–#33

    /**
     * #27 会话列表（分页归一）。
     *
     * <p>查询参数逐个声明（snake_case 与前端一致），再组装成 {@link SessionQuery}：
     * 用 {@code @RequestParam Map} 拿不到类型化的 {@code Integer page}，归一逻辑就无处安放。
     */
    @GetMapping("/sessions")
    public Result<JsonNode> listSessions(
            @RequestParam(required = false) String agent_id,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer page_size) {
        SessionQuery query = new SessionQuery(agent_id, channel, keyword, from, to, page, page_size);
        return Result.ok(facade.listSessions(query));
    }

    /** #28 会话详情。 */
    @GetMapping("/sessions/{id}")
    public Result<JsonNode> getSession(@PathVariable String id) {
        return Result.ok(facade.getSession(id));
    }

    /** #29 会话消息。 */
    @GetMapping("/sessions/{id}/messages")
    public Result<JsonNode> sessionMessages(@PathVariable String id, @RequestParam Map<String, String> query) {
        return Result.ok(facade.sessionMessages(id, query));
    }

    /** #30 删除会话。 */
    @DeleteMapping("/sessions/{id}")
    public Result<JsonNode> deleteSession(@PathVariable String id) {
        return Result.ok(facade.deleteSession(id));
    }

    /** #31 批量删除会话（T04 待建）。 */
    @PostMapping("/sessions/batch-delete")
    public Result<JsonNode> batchDeleteSessions(@RequestBody JsonNode body) {
        return Result.ok(facade.batchDeleteSessions(body));
    }

    /** A-5 会话最近一轮各阶段耗时（Redis，TTL 24h；过期返回 null）。 */
    @GetMapping("/sessions/{id}/timing")
    public Result<JsonNode> getSessionTiming(@PathVariable String id) {
        return Result.ok(facade.getSessionTiming(id));
    }

    /** A-6 批量会话耗时（列表「耗时」列，pipeline 一次往返）。 */
    @PostMapping("/sessions/timing/batch")
    public Result<JsonNode> batchSessionTiming(@RequestBody JsonNode body) {
        return Result.ok(facade.batchSessionTiming(body));
    }

    // ---------------------------------------------------------------- 会话反馈 CF-01/CF-03/CF-05

    /**
     * CF-01 会话反馈列表。
     *
     * <p>分页 + 过滤条件逐个声明（snake_case 与前端一致），由门面统一装配参数表；
     * 默认按「吐槽且 comment 非空」优先排序（下游语义）。
     *
     * @param rating       反馈方向：up 点赞 / down 吐槽；缺省 = 不限
     * @param comment_only 仅看带说明的反馈；缺省 = 不限
     * @param agent_id     按 Agent 过滤
     * @param channel      按渠道过滤
     * @param from         起始时间（ISO-8601）
     * @param to           截止时间（ISO-8601）
     * @param keyword      关键词（评论 / 回答摘要）
     * @param status       处理状态：pending / handled / ignored；缺省 = 不限
     * @param page         页码，从 1 开始
     * @param page_size    每页条数
     */
    @GetMapping("/sessions/feedback")
    public Result<JsonNode> listFeedback(
            @RequestParam(required = false) String rating,
            @RequestParam(required = false) Boolean comment_only,
            @RequestParam(required = false) String agent_id,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer page_size) {
        return Result.ok(facade.listFeedback(
                rating, comment_only, agent_id, channel, from, to, keyword, status, page, page_size));
    }

    /**
     * CF-05 会话反馈统计。
     *
     * <p>基础计数 + 按 agent 维度 + 按日趋势；时间/Agent/渠道过滤由门面装配。
     */
    @GetMapping("/sessions/feedback/stats")
    public Result<JsonNode> feedbackStats(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String agent_id,
            @RequestParam(required = false) String channel) {
        return Result.ok(facade.feedbackStats(from, to, agent_id, channel));
    }

    /**
     * CF-03 标记单条反馈已处理/忽略。
     *
     * <p>body {@code {status: handled|ignored, note?}}；操作人从登录上下文头透传下游
     * （{@code X-User-Id}/{@code X-Username}），状态机 pending → handled/ignored 单向终态由下游裁定。
     */
    @PostMapping("/sessions/feedback/{feedbackId}/process")
    public Result<JsonNode> processFeedback(
            @PathVariable String feedbackId, @RequestBody JsonNode body) {
        return Result.ok(facade.processFeedback(feedbackId, body));
    }

    /**
     * CF-03 批量标记反馈已处理/忽略。
     *
     * <p>body {@code {ids[], status, note?}}，单次上限 200（下游裁定）；操作人透传语义同单条。
     */
    @PostMapping("/sessions/feedback/batch-process")
    public Result<JsonNode> batchProcessFeedback(@RequestBody JsonNode body) {
        return Result.ok(facade.batchProcessFeedback(body));
    }

    /** #32 新建对话会话（注意路径是 {@code /chat/sessions}，与列表 {@code /sessions} 不同）。 */
    @PostMapping("/chat/sessions")
    public Result<JsonNode> createChatSession(@RequestBody JsonNode body) {
        return Result.ok(facade.createChatSession(body));
    }

    /** #33 发送对话消息（走 chat 超时）。 */
    @PostMapping("/chat/sessions/{id}/messages")
    public Result<JsonNode> sendChatMessage(@PathVariable String id, @RequestBody JsonNode body) {
        return Result.ok(facade.sendChatMessage(id, body));
    }

    // ---------------------------------------------------------------- MCP #34–#42

    /** #34 MCP 服务器列表。 */
    @GetMapping("/mcp/servers")
    public Result<JsonNode> listMcpServers() {
        return Result.ok(facade.listMcpServers());
    }

    /** #35 MCP 健康。 */
    @GetMapping("/mcp/servers/health")
    public Result<JsonNode> mcpHealth() {
        return Result.ok(facade.mcpHealth());
    }

    /** #36 MCP 服务器详情。 */
    @GetMapping("/mcp/servers/{name}")
    public Result<JsonNode> getMcpServer(@PathVariable String name) {
        return Result.ok(facade.getMcpServer(name));
    }

    /** #37 MCP 工具列表。 */
    @GetMapping("/mcp/servers/{name}/tools")
    public Result<JsonNode> mcpTools(@PathVariable String name) {
        return Result.ok(facade.mcpTools(name));
    }

    /** #38 新增 MCP 服务器。 */
    @PostMapping("/mcp/servers")
    public Result<JsonNode> createMcpServer(@RequestBody JsonNode body) {
        return Result.ok(facade.createMcpServer(body));
    }

    /** #39–#41 MCP 连接态动作。 */
    @PostMapping("/mcp/servers/{name}/{action:connect|disconnect|discover}")
    public Result<JsonNode> mcpAction(@PathVariable String name, @PathVariable String action) {
        return Result.ok(facade.mcpAction(name, action));
    }

    /** #42 手动调用 MCP 工具（高危）。 */
    @PostMapping("/mcp/servers/{name}/call")
    public Result<JsonNode> callMcpTool(@PathVariable String name, @RequestBody JsonNode body) {
        return Result.ok(facade.callMcpTool(name, body));
    }

    // ---------------------------------------------------------------- Worker Catalog / 调度 #43–#47

    /** #43 读取 Worker Catalog（T04 待建）。 */
    @GetMapping("/catalog")
    public Result<JsonNode> workerCatalog() {
        return Result.ok(facade.workerCatalog());
    }

    /** #44 写回 Worker Catalog（T04 待建）。 */
    @PutMapping("/catalog")
    public Result<JsonNode> saveWorkerCatalog(@RequestBody JsonNode body) {
        return Result.ok(facade.saveWorkerCatalog(body));
    }

    /** #45 调度链路追踪（T04 待建）。 */
    @GetMapping("/dispatch/traces")
    public Result<JsonNode> dispatchTraces(@RequestParam Map<String, String> query) {
        return Result.ok(facade.dispatchTraces(query));
    }

    /** #46 路由日志。 */
    @GetMapping("/dispatch/route-logs")
    public Result<JsonNode> routeLogs(@RequestParam Map<String, String> query) {
        return Result.ok(facade.routeLogs(query));
    }

    /** #47 路由统计。 */
    @GetMapping("/dispatch/route-stats")
    public Result<JsonNode> routeStats(@RequestParam Map<String, String> query) {
        return Result.ok(facade.routeStats(query));
    }

    // ---------------------------------------------------------------- 监控与审批 #55–#58

    /** #55 监控总览（聚合 proxy / llm / admin 三路）。 */
    @GetMapping("/monitor/overview")
    public Result<JsonNode> monitorOverview() {
        return Result.ok(facade.monitorOverview());
    }

    /** #56 重置 failover。 */
    @PostMapping("/monitor/failover/reset")
    public Result<JsonNode> resetFailover(@RequestBody JsonNode body) {
        return Result.ok(facade.resetFailover(body));
    }

    /** #57 审批列表（T04 待建）。 */
    @GetMapping("/approvals")
    public Result<JsonNode> listApprovals(@RequestParam Map<String, String> query) {
        return Result.ok(facade.listApprovals(query));
    }

    /** #58 审批通过/驳回（T04 待建）。 */
    @PostMapping("/approvals/{id}/decision")
    public Result<JsonNode> decideApproval(@PathVariable String id, @RequestBody JsonNode body) {
        return Result.ok(facade.decideApproval(id, body));
    }
}
