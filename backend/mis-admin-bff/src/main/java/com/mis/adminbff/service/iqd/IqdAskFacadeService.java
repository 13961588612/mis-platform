package com.mis.adminbff.service.iqd;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.client.AiPlatformClient;
import com.mis.adminbff.config.IqdProperties;
import com.mis.adminbff.dto.iqd.IqdAskRequest;
import com.mis.adminbff.dto.iqd.IqdAskResponse;
import com.mis.adminbff.dto.iqd.IqdScopeResolutionPayload;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 问数 Ask 门面（BFF 转发 Worker 编排链 + view 裁定 + 双闸门）。
 *
 * <p>职责：
 * <ol>
 *   <li><b>功能码闸门</b>：{@code ai:chat:use}（V69 绑定 ask 端点；兜底判权 40300）</li>
 *   <li><b>view 裁定</b>：持有 {@code iqd:trace:view} → {@code admin}（含 SQL），否则 {@code user}（剥 SQL 键）</li>
 *   <li><b>转发</b>：调用 ai-platform 的 mis-iqd Agent（Worker 侧完整编排链：
 *       scope_check → get_context → dry_plan → lineage_check → dry_run → run_sql → citations → project）</li>
 * </ol>
 *
 * <p>SSE 走 {@code AiPlatformClient.chatStream}（1:1 透传 plan_step / delta / citations /
 * result / error / done 帧，§7.3）；异常由客户端 {@code onErrorResume} 补 error 帧收尾。
 */
@Service
public class IqdAskFacadeService {

    private static final Logger log = LoggerFactory.getLogger(IqdAskFacadeService.class);

    /**
     * Worker 端 mis-iqd Agent 的默认 agentId（可经 mis.iqd.agent-id 覆盖）。
     *
     * <p>公开常量：feedback-enhance 设计 §7.1 待确认项 —— 若联调发现路由会话的
     * {@code agent_id} 非 mis-iqd，BFF 透传评价时需显式注入该值（与设计同源），
     * 故从私有提升为公共；当前评价透传层零加工，不注入。
     */
    public static final String DEFAULT_AGENT_ID = "mis-iqd";

    private final AiPlatformClient aiPlatformClient;
    private final IqdProperties properties;
    private final UserPermissionLoader userPermissionLoader;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    public IqdAskFacadeService(
            AiPlatformClient aiPlatformClient,
            IqdProperties properties,
            UserPermissionLoader userPermissionLoader) {
        this.aiPlatformClient = aiPlatformClient;
        this.properties = properties;
        this.userPermissionLoader = userPermissionLoader;
    }

    /**
     * 非流式问数（POST /api/v1/iqd/ask）。
     *
     * @param req          问数请求
     * @param authorization BFF 收到的原始 MIS JWT
     * @param traceId      链路追踪 id
     * @return Worker 返回的 AskResponse（已按 view 投影）
     */
    public IqdAskResponse ask(IqdAskRequest req, String authorization, String traceId) {
        requireAskPermission();
        String view = resolveView();
        Map<String, Object> body = buildBody(req, view);
        var data = aiPlatformClient.chat(
                agentId(), body, authorization, traceId, properties.getAskTimeoutMs());
        return parseResponse(data);
    }

    /**
     * 流式问数（POST /api/v1/iqd/ask-stream）。
     *
     * <p>门禁未过时以单帧 SSE {@code error} 收尾（前端此时已在监听事件流，
     * 突然返回 JSON 错误体会被当成协议异常，报错信息丢失）。
     *
     * @param req          问数请求
     * @param authorization BFF 收到的原始 MIS JWT
     * @param traceId      链路追踪 id
     * @return SSE 事件流（data 为原始 JSON 字符串，1:1 透传 Worker 帧）
     */
    public Flux<ServerSentEvent<String>> askStream(IqdAskRequest req, String authorization, String traceId) {
        if (!requireAskPermissionQuiet()) {
            return sseErrorFlux("无问数使用权限（ai:chat:use）");
        }
        String view = resolveView();
        Map<String, Object> body = buildBody(req, view);
        return aiPlatformClient.chatStream(agentId(), body, authorization, traceId);
    }

    /**
     * view 裁定：持有 {@code iqd:trace:view} → admin，否则 user。
     *
     * <p>admin 视图保留顶层 {@code sql} / {@code sql_dialect} 与 {@code plan[].sql}；
     * user 视图由 Worker 投影剥键（ResponseProjector._strip_sql），BFF 不二次加工。
     */
    public String resolveView() {
        LoginUser user = RequestContext.requireLoginUser();
        if (user.getUserId() == null) {
            return "user";
        }
        Set<String> permissions = userPermissionLoader.load(user);
        if (permissions != null && permissions.contains(properties.getAdminViewPermission())) {
            return "admin";
        }
        return "user";
    }

    /** 兜底判权（注册表未生效空窗期），失败抛 40300。 */
    public void requireAskPermission() {
        LoginUser user = RequestContext.requireLoginUser();
        if (user.getUserId() == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        Set<String> permissions = userPermissionLoader.load(user);
        if (permissions == null) {
            throw new BusinessException(ResultCode.FORBIDDEN);
        }
        // 与 sys_menu_api 并集一致：ai:chat:use（正式问数）或 iqd:test:use（测试台）任一即可
        String askPermission = properties.getAskPermission();
        if (permissions.contains(askPermission) || permissions.contains("iqd:test:use")) {
            return;
        }
        throw new BusinessException(ResultCode.FORBIDDEN);
    }

    /** 静默判权：失败返回 false（供 SSE 分支以 error 帧收尾，避免抛异常打断流）。 */
    private boolean requireAskPermissionQuiet() {
        try {
            requireAskPermission();
            return true;
        } catch (BusinessException ex) {
            return false;
        }
    }

    /** 组装 Worker chat 请求体（content + role + metadata；metadata 携带 iqd 结构化字段）。 */
    private Map<String, Object> buildBody(IqdAskRequest req, String view) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("source", "mis-bff");
        metadata.put("capability", "iqd");
        metadata.put("iqd", buildIqdMetadata(req, view));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("content", req.getQuestion());
        body.put("role", "user");
        body.put("metadata", metadata);
        return body;
    }

    /** 构造 iqd 结构化 metadata（snake_case，Worker orchestrator 读取）。 */
    private Map<String, Object> buildIqdMetadata(IqdAskRequest req, String view) {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("question", req.getQuestion());
        meta.put("view", view);
        if (req.getSessionId() != null && !req.getSessionId().isBlank()) {
            meta.put("session_id", req.getSessionId());
        }
        if (req.getThreadId() != null && !req.getThreadId().isBlank()) {
            meta.put("thread_id", req.getThreadId());
        }
        if (req.getConnectionId() != null) {
            meta.put("connection_id", req.getConnectionId());
        }
        if (req.getSimulateRoleCode() != null && !req.getSimulateRoleCode().isBlank()) {
            meta.put("simulate_role_code", req.getSimulateRoleCode());
        }
        if (req.getScopeHint() != null && !req.getScopeHint().isEmpty()) {
            meta.put("scope_hint", req.getScopeHint());
        }
        return meta;
    }

    /** Worker agentId（可配；默认 mis-iqd）。 */
    private String agentId() {
        String id = properties.getAgentId();
        return id == null || id.isBlank() ? DEFAULT_AGENT_ID : id;
    }

    /** 解析 Worker 返回的 AskResponse（data.response 为 JSON 字符串）。 */
    private IqdAskResponse parseResponse(com.mis.adminbff.dto.ai.AiPlatformChatData data) {
        IqdAskResponse resp = new IqdAskResponse();
        resp.setThreadId(data.getSessionId());
        // 失败帧也给空 scope，避免前端读 scope.decision 白屏
        resp.setScope(emptyScope());
        resp.setPlan(Collections.emptyList());
        resp.setCitations(Collections.emptyList());
        resp.setMaskedColumns(Collections.emptyList());
        String raw = data.getResponse();
        if (raw == null || raw.isBlank()) {
            resp.setStatus("error");
            resp.setErrorCode("45299");
            resp.setErrorMessage("Worker 返回空响应");
            return resp;
        }
        try {
            IqdAskResponse parsed = objectMapper.readValue(stripJsonFences(raw), IqdAskResponse.class);
            if (parsed.getScope() == null) {
                parsed.setScope(emptyScope());
            }
            if (parsed.getPlan() == null) {
                parsed.setPlan(Collections.emptyList());
            }
            if (parsed.getCitations() == null) {
                parsed.setCitations(Collections.emptyList());
            }
            if (parsed.getMaskedColumns() == null) {
                parsed.setMaskedColumns(Collections.emptyList());
            }
            return parsed;
        } catch (Exception ex) {
            log.warn("Failed to parse iqd ask response, raw={}", raw, ex);
            resp.setStatus("error");
            resp.setErrorCode("45299");
            resp.setErrorMessage("Worker 响应解析失败: " + ex.getMessage());
            return resp;
        }
    }

    private static IqdScopeResolutionPayload emptyScope() {
        return new IqdScopeResolutionPayload(null, Collections.emptyList(), Collections.emptyList(), null, null);
    }

    /** 清理 LLM 输出可能裹挟的 markdown 代码围栏。 */
    private static String stripJsonFences(String raw) {
        String s = raw.strip();
        int start = s.indexOf("```");
        if (start >= 0) {
            int firstNewline = s.indexOf('\n', start);
            int lastFence = s.lastIndexOf("```");
            if (firstNewline >= 0 && lastFence > firstNewline) {
                s = s.substring(firstNewline + 1, lastFence).strip();
            }
        }
        return s.isEmpty() ? "{}" : s;
    }

    /** 构造一帧 SSE error（门禁/降级场景）。 */
    private Flux<ServerSentEvent<String>> sseErrorFlux(String message) {
        Map<String, String> err = new LinkedHashMap<>();
        err.put("message", message);
        String data;
        try {
            data = objectMapper.writeValueAsString(err);
        } catch (Exception ex) {
            data = "{\"message\":\"" + message + "\"}";
        }
        return Flux.just(ServerSentEvent.<String>builder().event("error").data(data).build());
    }
}
