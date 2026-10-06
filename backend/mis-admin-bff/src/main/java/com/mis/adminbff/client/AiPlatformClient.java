package com.mis.adminbff.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.mis.adminbff.client.model.UserDataSetScopeVO;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.config.AiPlatformProperties;
import com.mis.adminbff.dto.ai.AiPlatformChatData;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * AI 平台（ai-platform Agent Core）适配层客户端。
 *
 * <p>继承 {@link AbstractDownstreamClient}，复用其 WebClient 与身份头注入机制，
 * 封装对平台受 MIS RS256 保护的端点的调用：
 * <ul>
 *   <li>{@code POST /api/v1/agents/{agentId}/chat}（非流式）</li>
 *   <li>{@code GET  /health}（健康探测）</li>
 * </ul>
 *
 * <p>调用时透传：
 * <ul>
 *   <li>{@code Authorization}：BFF 收到的原始 MIS JWT（平台据此走 RS256 分支）</li>
 *   <li>{@code X-Trace-Id}：由 mis-gateway 注入，原样透传给平台以关联全链路</li>
 *   <li>X-User-Id / X-Tenant-Id / X-App-Id / X-Employee-Id / X-Username：
 *       复用 {@link #loginContextHeaders()} 从 SecurityContextHolder 注入</li>
 *   <li>X-Mis-Depts / X-Mis-Orgs / X-Mis-Roles（T4，身份 enrichment）：
 *       调 MIS IAM 取 roles + deptId 后注入，供平台还原多部门 / 多组织 / 多角色上下文</li>
 * </ul>
 */
@Component
public class AiPlatformClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<AiPlatformChatData>> CHAT_TYPE =
            new ParameterizedTypeReference<>() {};

    /** 通用 Map 结果类型（translate / trial 等返回 {@code Map<String,Object>} 的端点）。 */
    private static final ParameterizedTypeReference<Result<Map<String, Object>>> MAP_RESULT_TYPE =
            new ParameterizedTypeReference<>() {};

    /** 方案 A 多连接：MCP 进程列表结果类型（/iqd/mcp/list 返回 {@code list[dict]}）。 */
    private static final ParameterizedTypeReference<Result<List<Map<String, Object>>>> MCP_LIST_TYPE =
            new ParameterizedTypeReference<>() {};

    /** X-Mis-* 头名（与平台 docs/identity-enrichment-task-list.md §4 约定一致）。 */
    private static final String HEADER_MIS_DEPTS = "X-Mis-Depts";
    private static final String HEADER_MIS_ORGS = "X-Mis-Orgs";
    private static final String HEADER_MIS_ROLES = "X-Mis-Roles";

    private static final String HEADER_MIS_DEPT_SCOPE = "X-Mis-Dept-Scope";
    private static final String HEADER_MIS_STORES = "X-Mis-Stores";
    private static final String HEADER_MIS_DATA_SCOPE = "X-Mis-Data-Scope";

    /** IAM 取数短 TTL 缓存（T4.4，降低 IAM 压力与请求延迟）。 */
    private static final long IAM_CACHE_TTL_MS = 60_000L;

    private final IamWebClient iamWebClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<Long, IamCacheEntry> iamCache = new ConcurrentHashMap<>();
    private final OrgWebClient orgWebClient;
    private final Map<Long, OrgCacheEntry> orgCache = new ConcurrentHashMap<>();
    /**
     * 自愈 / MDL 整库重建超时：须 ≥ Worker {@code build_timeout_seconds}(默认 120s)。
     * 默认 chat 60s 会在 build 未完成时先断，前端看到「构建失败」。
     */
    private static final Duration SELF_HEAL_TIMEOUT = Duration.ofMillis(180_000);

    public AiPlatformClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            AiPlatformProperties properties,
            IamWebClient iamWebClient,
            OrgWebClient orgWebClient) {
        super(
                plainBuilder.baseUrl(properties.getBaseUrl()).build(),
                properties.getChatTimeoutMs());
        this.iamWebClient = iamWebClient;
        this.orgWebClient = orgWebClient;
    }

    /**
     * 调用平台 Agent 非流式对话端点。
     *
     * @param agentId     目标 agent（mis-copilot / mis-summary / mis-extract / mis-rag）
     * @param body        平台请求体（content / role / metadata）
     * @param authorization BFF 收到的原始 MIS JWT（Bearer ...），透传给平台
     * @param traceId     全链路追踪 ID（X-Trace-Id），透传给平台
     * @return 平台响应中的 data 部分（含 response / sessionId）
     */
    public AiPlatformChatData chat(
            String agentId,
            Map<String, Object> body,
            String authorization,
            String traceId) {
        return chat(agentId, body, authorization, traceId, null);
    }

    /**
     * 同 {@link #chat(String, Map, String, String)}，可覆盖超时（问数编排链默认需 180s）。
     *
     * @param overrideTimeoutMs 覆盖超时毫秒；{@code null} 或 ≤0 时用 {@code chat-timeout-ms}
     */
    public AiPlatformChatData chat(
            String agentId,
            Map<String, Object> body,
            String authorization,
            String traceId,
            Long overrideTimeoutMs) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        Duration timeout = (overrideTimeoutMs != null && overrideTimeoutMs > 0)
                ? Duration.ofMillis(overrideTimeoutMs)
                : null;
        return block(client().post()
                .uri("/api/v1/agents/{agentId}/chat", agentId)
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(CHAT_TYPE), timeout);
    }

    /**
     * 调用平台 Agent SSE 流式对话端点，透传 {@code delta | done | error} 事件（T-stream）。
     *
     * <p>平台返回标准 {@code event:/data:} 帧，WebClient {@link ServerSentEvent} 解码器直接解析；
     * BFF 在控制器层按 1:1 原样转发（事件名 + data 不变）。任何异常（含平台 401/5xx）
     * 经 {@code .onErrorResume} 捕获并补发一帧 {@code error{message}} 后结束流。
     *
     * @param agentId      目标 agent（mis-copilot / mis-rag ...）
     * @param body         平台请求体（content / role / metadata）
     * @param authorization BFF 收到的原始 MIS JWT（Bearer ...），透传给平台
     * @param traceId      全链路追踪 ID（X-Trace-Id），透传给平台
     * @return 平台 SSE 事件流（{@code ServerSentEvent<String>}，data 为原始 JSON 字符串）
     */
    public Flux<ServerSentEvent<String>> chatStream(
            String agentId,
            Map<String, Object> body,
            String authorization,
            String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        return client().post()
                .uri("/api/v1/agents/{agentId}/chat/stream", agentId)
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(body)
                .retrieve()
                .bodyToFlux(new ParameterizedTypeReference<ServerSentEvent<String>>() {})
                .onErrorResume(ex -> {
                    String message = ex.getMessage() == null ? "AI 流式调用失败" : ex.getMessage();
                    Map<String, String> err = new LinkedHashMap<>();
                    err.put("message", message);
                    try {
                        return Flux.just(ServerSentEvent.<String>builder()
                                .event("error")
                                .data(objectMapper.writeValueAsString(err))
                                .build());
                    } catch (Exception e) {
                        return Flux.just(ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"message\":\"AI 流式调用失败\"}")
                                .build());
                    }
                });
    }

    /**
     * 探测平台存活（平台根 {@code /health}，无统一包络）。
     *
     * @return 平台 health 响应；异常或不可达时返回 {@code null}
     */
    public Map<String, Object> healthProbe() {
        return client().get()
                .uri("/health")
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                .block(Duration.ofSeconds(3));
    }

    /**
     * 样本对方言转化（v1.10 / §4.2.3）：调平台 Worker {@code /iqd/sql-pairs/translate}。
     *
     * <p>平台用 sqlglot 把源方言（Oracle/MySQL/PostgreSQL/ClickHouse）翻到 WrenAI 方言，
     * 返回 {@code {wren_sql, warnings}}。前端不直连 WrenAI（对齐 NFR-1 红线）。
     *
     * @param body         请求体 {@code {db_type, native_sql}}
     * @param authorization BFF 收到的原始 MIS JWT（透传给平台）
     * @param traceId      全链路追踪 ID（X-Trace-Id，透传给平台）
     * @return 平台响应 data：{@code {wren_sql, warnings}}
     */
    public Map<String, Object> translateSqlPair(
            Map<String, Object> body,
            String authorization,
            String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        return block(client().post()
                .uri("/api/v1/iqd/sql-pairs/translate")
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 样本对试运行（v1.10 / §4.2.3）：调平台 Worker {@code /iqd/sql-pairs/trial}。
     *
     * <p>平台经 MCP {@code run_sql} 在 WrenAI 引擎侧执行转化后的 {@code wren_sql}，
     * 返回 {@code {columns, rows, error, duration_ms}}。
     *
     * @param body         请求体 {@code {wren_sql}}
     * @param authorization BFF 收到的原始 MIS JWT（透传给平台）
     * @param traceId      全链路追踪 ID（X-Trace-Id，透传给平台）
     * @return 平台响应 data：{@code {columns, rows, error, duration_ms}}
     */
    public Map<String, Object> trialSqlPair(
            Map<String, Object> body,
            String authorization,
            String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        return block(client().post()
                .uri("/api/v1/iqd/sql-pairs/trial")
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 触发增强同步（闭环补全 P0-2/P0-3）：调平台 Worker {@code /api/v1/iqd/enhance/sync}。
     *
     * <p>默认 wait=false（接受即返回，平台经 SyncCoordinator 合并窗口异步执行
     * context build + memory index + 回填）。wait=true 用于手动/重试的阻塞场景。
     *
     * @param connectionId 问数连接 id
     * @param wait         是否阻塞至完成
     * @param authorization BFF 收到的原始 MIS JWT（透传给平台 RS256 校验）
     * @param traceId      全链路追踪 ID（X-Trace-Id，透传给平台）
     * @return 平台响应 data（SyncResult：build/index 状态 + mdl_hash + 回填计数）
     */
    public Map<String, Object> syncEnhancements(
            Long connectionId, Boolean wait, String scope, String authorization, String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("connection_id", connectionId);
        body.put("wait", wait == null ? Boolean.FALSE : wait);
        body.put("scope", scope == null || scope.isBlank() ? "materials" : scope);
        return block(client().post()
                .uri("/api/v1/iqd/enhance/sync")
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 触发对账清扫（二期 S3 / 周期或手动）：调平台 Worker {@code /api/v1/iqd/enhance/reconcile}。
     *
     * <p>平台比对 WrenAI 当前 mdl_hash 与 built_mdl_hash，漂移则置 stale_drift 并重按
     * model 范围重建（使平台基线重新收敛为权威）。BFF 定时清扫任务（无用户上下文）调用本方法，
     * 透传头留空（平台侧按服务身份 / 内部放行处理）。
     *
     * @param connectionId 问数连接 id
     * @return 平台响应 data（{@code {triggered}} 等）
     */
    public Map<String, Object> reconcile(Long connectionId) {
        Consumer<HttpHeaders> headers = buildHeaders(null, null);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("connection_id", connectionId);
        body.put("wait", Boolean.FALSE);
        body.put("scope", "model");
        return block(client().post()
                .uri("/api/v1/iqd/enhance/reconcile")
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 触发运维自愈动作（需 iqd:selfheal:exec）：调平台 Worker
     * {@code /api/v1/iqd/self-heal/{action}}。
     *
     * <p>action ∈ {force-rebuild, re-index, validate}；默认 wait=true（阻塞至完整
     * SyncResult 返回），与编辑写回的 best-effort（wait=false）区分。body
     * {@code {connection_id, wait:true}}。
     *
     * @param action       自愈动作（force-rebuild / re-index / validate）
     * @param connectionId 问数连接 id
     * @param authorization BFF 收到的原始 MIS JWT（透传给平台 RS256 校验）
     * @param traceId      全链路追踪 ID（X-Trace-Id，透传给平台）
     * @return 平台响应 data（SyncResult：build/index 状态 + mdl_hash + 回填计数）
     */
    public Map<String, Object> selfHeal(
            String action, Long connectionId, String authorization, String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("connection_id", connectionId);
        body.put("wait", Boolean.TRUE);
        return block(client().post()
                .uri("/api/v1/iqd/self-heal/{action}", action)
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE), SELF_HEAL_TIMEOUT);
    }

    /** 运维自愈-强制重建（action=force-rebuild）。 */
    public Map<String, Object> selfHealForceRebuild(Long connectionId, String authorization, String traceId) {
        return selfHeal("force-rebuild", connectionId, authorization, traceId);
    }

    /** 运维自愈-重新索引（action=re-index）。 */
    public Map<String, Object> selfHealReindex(Long connectionId, String authorization, String traceId) {
        return selfHeal("re-index", connectionId, authorization, traceId);
    }

    /** 运维自愈-模型校验（action=validate）。 */
    public Map<String, Object> selfHealValidate(Long connectionId, String authorization, String traceId) {
        return selfHeal("validate", connectionId, authorization, traceId);
    }

    /**
     * 方案 A 多连接：触发某连接 WrenAI MCP 进程管理动作（需 iqd:mcp:manage）。
     *
     * <p>action ∈ {start, stop, restart}；调平台 Worker {@code /api/v1/iqd/mcp/{action}}。
     * 平台执行就绪门禁（mdl.json 已编译）+ 凭证 env 注入（D6）+ 进程启停/重启，
     * body {@code {connection_id, wait, retain_dir}}。
     *
     * @param action       管理动作（start / stop / restart）
     * @param connectionId 问数连接 id
     * @param wait         是否阻塞至完成（保留参数，启动为异步；默认 true 兼容语义）
     * @param retainDir    stop 时是否保留 project 目录（默认 true，7 天到期清理）
     * @param authorization BFF 收到的原始 MIS JWT（透传平台 RS256 校验）
     * @param traceId      全链路追踪 ID（X-Trace-Id，透传给平台）
     * @return 平台响应 data（{connection_id, mcp_status, host, port}）
     */
    public Map<String, Object> mcpManage(
            String action, Long connectionId, Boolean wait, Boolean retainDir,
            String authorization, String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("connection_id", connectionId);
        body.put("wait", wait == null ? Boolean.TRUE : wait);
        body.put("retain_dir", retainDir == null ? Boolean.TRUE : retainDir);
        return block(client().post()
                .uri("/api/v1/iqd/mcp/{action}", action)
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /** 方案 A 多连接：MCP 启动（action=start）。 */
    public Map<String, Object> mcpStart(
            Long connectionId, Boolean wait, Boolean retainDir,
            String authorization, String traceId) {
        return mcpManage("start", connectionId, wait, retainDir, authorization, traceId);
    }

    /** 方案 A 多连接：MCP 停止（action=stop）。 */
    public Map<String, Object> mcpStop(
            Long connectionId, Boolean wait, Boolean retainDir,
            String authorization, String traceId) {
        return mcpManage("stop", connectionId, wait, retainDir, authorization, traceId);
    }

    /** 方案 A 多连接：MCP 重启（action=restart）。 */
    public Map<String, Object> mcpRestart(
            Long connectionId, Boolean wait, Boolean retainDir,
            String authorization, String traceId) {
        return mcpManage("restart", connectionId, wait, retainDir, authorization, traceId);
    }

    /**
     * 取连接级 MCP 进程状态（需 iqd:mcp:manage）：调平台 Worker
     * {@code /api/v1/iqd/mcp/status?connection_id=}。
     *
     * @param connectionId 问数连接 id
     * @return 平台响应 data（单连接状态 dict）
     */
    public Map<String, Object> mcpStatus(Long connectionId, String authorization, String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/mcp/status")
                        .queryParam("connection_id", connectionId)
                        .build())
                .headers(headers)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 列出全部连接 MCP 进程状态（需 iqd:mcp:manage）：调平台 Worker
     * {@code /api/v1/iqd/mcp/list}。
     *
     * @return 平台响应 data（list[dict]）
     */
    public List<Map<String, Object>> mcpList(String authorization, String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        return block(client().get()
                .uri("/api/v1/iqd/mcp/list")
                .headers(headers)
                .retrieve()
                .bodyToMono(MCP_LIST_TYPE));
    }

    /**
     * 方案 A 跨机器落地 v0.2：启用/创建连接项目（用户自助「启用/创建项目」按钮）。
     *
     * <p>调平台 Worker {@code /api/v1/iqd/mcp/ensure}。平台据 {@code WREN_AGENT_ENDPOINT}
     * 是否配置分流：远程模式经 WrenMcpAgentClient.ensure 推凭证 + 拉起 wren 机进程，
     * 本地模式退回既有 Plan A 子进程模型。body {@code {connection_id}}。
     *
     * @param connectionId 问数连接 id
     * @param authorization BFF 收到的原始 MIS JWT（透传平台 RS256 校验）
     * @param traceId      全链路追踪 ID
     * @return 平台响应 data（{connection_id, mcp_status, mcp_host, agent_handle, remote}）
     */
    public Map<String, Object> mcpEnsure(Long connectionId, String authorization, String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("connection_id", connectionId);
        return block(client().post()
                .uri("/api/v1/iqd/mcp/ensure")
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 行级谓词预览（需 iqd:scope:view）：调平台 Worker
     * {@code POST /api/v1/iqd/scope/preview}。
     *
     * <p>与问数 {@code simulate_role_code} 同源：身份头由 BFF enrichment 注入
     * （X-Mis-Roles/Depts/Orgs），可选 role_code 覆写为模拟角色；
     * draft_rules/samples 供编辑态草稿预览（谓词形态仍由引擎生成）。
     *
     * @param body          请求体（connection_id/role_code/item_key/draft_rules/samples/headers）
     * @param authorization BFF 收到的原始 MIS JWT
     * @param traceId       全链路追踪 ID
     * @return 平台响应 data（{items, degraded:false, note, subject, connection_id}）
     */
    public Map<String, Object> previewIqdRowScope(
            Map<String, Object> body, String authorization, String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        return block(client().post()
                .uri("/api/v1/iqd/scope/preview")
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    // ================================================================ 路线 A：问数连接凭证保险库

    /**
     * 写入 / 更新问数连接业务库凭据（路线 A）。调平台 Worker
     * {@code POST /api/v1/iqd/credentials}。
     *
     * @param body          凭据体 {@code {secret_ref, db_type, host, port, user, password, database}}
     * @param authorization BFF 收到的原始 MIS JWT（透传平台 RS256 校验）
     * @param traceId       全链路追踪 ID
     * @return 平台响应 data（{@code {secret_ref, has_credential, id}}）
     */
    public Map<String, Object> storeIqdCredential(
            Map<String, Object> body, String authorization, String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        return block(client().post()
                .uri("/api/v1/iqd/credentials")
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 删除问数连接业务库凭据（软删除）。调平台 Worker
     * {@code DELETE /api/v1/iqd/credentials/{secret_ref}}。
     */
    public Map<String, Object> deleteIqdCredential(
            String secretRef, String authorization, String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        return block(client().delete()
                .uri("/api/v1/iqd/credentials/{ref}", secretRef)
                .headers(headers)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 数据库连接配置连通性测试（Tab①）。调平台 Worker
     * {@code POST /api/v1/iqd/db-profiles/test}（直连业务库只读探测）。
     *
     * @param body          {@code {db_type, host, port, user, password, database}}
     * @param authorization BFF 收到的原始 MIS JWT（透传平台 RS256 校验）
     * @param traceId       全链路追踪 ID
     * @return 平台响应 data：{@code {ok, latency_ms, message, schemas}}
     */
    public Map<String, Object> testIqdDbProfile(
            Map<String, Object> body, String authorization, String traceId) {
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        return block(client().post()
                .uri("/api/v1/iqd/db-profiles/test")
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /** 组合转发头：复用基类 loginContextHeaders() + Authorization + X-Trace-Id + MIS 身份 enrichment 头。 */
    private Consumer<HttpHeaders> buildHeaders(String authorization, String traceId) {
        return headers -> {
            loginContextHeaders().accept(headers);
            if (authorization != null && !authorization.isBlank()) {
                headers.set(SecurityConstants.AUTHORIZATION_HEADER, authorization);
            }
            if (traceId != null && !traceId.isBlank()) {
                headers.set(SecurityConstants.HEADER_TRACE_ID, traceId);
            }
            buildMisEnrichmentHeaders().accept(headers);   // T4：注入 X-Mis-*
        };
    }

    /**
    /**
     * 从安全上下文取 LoginUser -> 调 MIS IAM 取 roles + deptId -> 组装 X-Mis-Depts / X-Mis-Orgs / X-Mis-Roles。
     *
     * <p>取值约定（docs/identity-enrichment-task-list.md §4）：
     * <ul>
     *   <li>X-Mis-Depts：[{@code {"id": deptId}}]（本阶段单部门，见 R1）</li>
     *   <li>X-Mis-Orgs：[{@code {"id": tenantId}}]（主租户，见决策#3）</li>
     *   <li>X-Mis-Roles：[{@code {"id": roleId, "code": roleCode}}]（以 code 为主键）</li>
     * </ul>
     *
     * <p>IAM 调用异常 / 空结果时<b>降级</b>（不加头），不阻断主流程；平台将退化为阶段1/2 行为。
     */
    private Consumer<HttpHeaders> buildMisEnrichmentHeaders() {
        return headers -> {
            try {
                LoginUser user = SecurityContextHolder.getOptional().orElse(null);
                if (user == null || user.getUserId() == null) {
                    return;
                }

                IamUserVO iamUser = lookupIamUser(user.getUserId());
                if (iamUser == null) {
                    return;
                }

                // X-Mis-Depts：本阶段单部门（R1）
                List<Map<String, String>> depts = new ArrayList<>();
                if (iamUser.deptId() != null && !iamUser.deptId().isBlank()) {
                    depts.add(Map.of("id", iamUser.deptId()));
                }

                // X-Mis-Orgs：主租户（决策#3，单 tenant + 多 dept）
                List<Map<String, String>> orgs = new ArrayList<>();
                if (user.getTenantId() != null) {
                    orgs.add(Map.of("id", String.valueOf(user.getTenantId())));
                }

                // X-Mis-Roles：以 code 为主键（与 JWT roles / 平台 PermissionEngine 命名空间一致）
                List<Map<String, String>> roles = new ArrayList<>();
                if (iamUser.roles() != null) {
                    for (IamRoleVO r : iamUser.roles()) {
                        if (r == null) {
                            continue;
                        }
                        String code = r.code();
                        if (code == null) {
                            code = r.id();
                        }
                        if (code != null && !code.isBlank()) {
                            String id = r.id() != null ? r.id() : code;
                            roles.add(Map.of("id", id, "code", code));
                        }
                    }
                }

                if (!depts.isEmpty()) {
                    headers.set(HEADER_MIS_DEPTS, objectMapper.writeValueAsString(depts));
                }
                if (!orgs.isEmpty()) {
                    headers.set(HEADER_MIS_ORGS, objectMapper.writeValueAsString(orgs));
                }
                if (!roles.isEmpty()) {
                    headers.set(HEADER_MIS_ROLES, objectMapper.writeValueAsString(roles));
                }
            } catch (Exception ignored) {
                // IAM unavailable -> degrade (skip base headers), do not block.
            }

            // --- IQD row-scope header injection ---
            try {
                LoginUser iqdcUser = SecurityContextHolder.getOptional().orElse(null);
                if (iqdcUser != null && iqdcUser.getUserId() != null) {
                    injectDataRowScopeHeaders(headers, iqdcUser.getUserId());
                }
            } catch (Exception ignored) {
                // mis-org unreachable -> skip scope headers; Worker fail-closed.
            }
        };
    }

    /**
     * 从 mis-org 查询用户数据范围并注入问数 Worker 范围控制头。
     */
    private void injectDataRowScopeHeaders(HttpHeaders headers, Long userId) {
        UserDataSetScopeVO scope = lookupOrgDataScope(userId);
        if (scope == null) return;

        // ALL 显式放行
        if (Boolean.TRUE.equals(scope.all())) {
            headers.set(HEADER_MIS_DATA_SCOPE, "all");
            return;
        }

        // deptAnchors -> PATH_PREFIX range header
        List<UserDataSetScopeVO.DeptAnchor> anchors = scope.deptAnchors();
        if (anchors != null && !anchors.isEmpty()) {
            List<Map<String, Object>> anchorJsonList = new ArrayList<>();
            for (UserDataSetScopeVO.DeptAnchor a : anchors) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", String.valueOf(a.id()));
                if (a.path() != null && !a.path().isEmpty()) m.put("path", a.path());
                if (a.scope() != null && !a.scope().isEmpty()) m.put("scope", a.scope());
                anchorJsonList.add(m);
            }
            try {
                headers.set(HEADER_MIS_DEPT_SCOPE, objectMapper.writeValueAsString(anchorJsonList));
            } catch (JsonProcessingException e) {
                // ignore serialization error
            }
        }

        // storeIds -> ENUM range header
        List<Long> storeIds = scope.storeIds();
        if (storeIds != null && !storeIds.isEmpty()) {
            List<String> storeCodes = new ArrayList<>(storeIds.size());
            for (Long sid : storeIds) storeCodes.add(String.valueOf(sid));
            try {
                headers.set(HEADER_MIS_STORES, objectMapper.writeValueAsString(storeCodes));
            } catch (JsonProcessingException e) {
                // ignore serialization error
            }
        }
    }

    /**
     * ? MIS IAM ?????? TTL ???T4.4??
     *
     * @param userId IAM ?? id?= LoginUser.getUserId()?? R3?
     * @return IAM ?????IAM ?????? {@code null}
     */
    private IamUserVO lookupIamUser(Long userId) {
        IamCacheEntry entry = iamCache.get(userId);
        if (entry != null && entry.isAlive()) {
            return entry.user();
        }
        IamUserVO user = iamWebClient.getUser(userId);
        if (user != null) {
            iamCache.put(userId, new IamCacheEntry(user, System.currentTimeMillis() + IAM_CACHE_TTL_MS));
        }
        return user;
    }

    /** IAM ???????T4.4?????????TTL ? 60s?? */
    private record IamCacheEntry(IamUserVO user, long expireAt) {
        private boolean isAlive() {
            return System.currentTimeMillis() < expireAt;
        }
    }

    /** Cache lookup for mis-org data scope view (~60s TTL). Returns null on failure. */
    private UserDataSetScopeVO lookupOrgDataScope(Long userId) {
        OrgCacheEntry entry = orgCache.get(userId);
        if (entry != null && entry.isAlive()) return entry.scope();
        try {
            UserDataSetScopeVO scope = orgWebClient.getUserDataSetScope(userId);
            if (scope != null) {
                orgCache.put(userId, new OrgCacheEntry(scope, System.currentTimeMillis() + IAM_CACHE_TTL_MS));
            }
            return scope;
        } catch (Exception e) {
            return null;
        }
    }

    private record OrgCacheEntry(UserDataSetScopeVO scope, long expireAt) {
        boolean isAlive() { return System.currentTimeMillis() < expireAt; }
    }
}
