package com.mis.adminbff.controller;

import com.mis.adminbff.client.AiPlatformClient;
import com.mis.adminbff.config.AiPlatformProperties;
import com.mis.adminbff.dto.ai.AiChatRequest;
import com.mis.adminbff.dto.ai.AiChatResponse;
import com.mis.adminbff.dto.ai.AiExtractRequest;
import com.mis.adminbff.dto.ai.AiExtractResponse;
import com.mis.adminbff.dto.ai.AiFeaturesResponse;
import com.mis.adminbff.dto.ai.AiHealthResponse;
import com.mis.adminbff.dto.ai.AiPlatformChatData;
import com.mis.adminbff.dto.ai.AiRagRequest;
import com.mis.adminbff.dto.ai.AiRagResponse;
import com.mis.adminbff.dto.ai.AiSummaryRequest;
import com.mis.adminbff.dto.ai.AiSummaryResponse;
import com.mis.adminbff.dto.ai.SkillExecuteRequest;
import com.mis.adminbff.dto.ai.SkillExecuteResponse;
import com.mis.adminbff.service.AiCapabilityTranslator;
import com.mis.adminbff.service.AiFeatureConfigService;
import com.mis.adminbff.dto.ai.SkillApplyRequest;
import com.mis.adminbff.dto.ai.SkillApplyResponse;
import com.mis.adminbff.security.ReverseTrustContext;
import com.mis.adminbff.security.ReverseTrustInterceptor;
import com.mis.adminbff.service.skill.DocWriteRegistry;
import com.mis.adminbff.service.skill.DocWriteResult;
import com.mis.adminbff.service.skill.SkillExecutionEngine;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.ResultCode;
import jakarta.servlet.http.HttpServletRequest;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.BiFunction;

/**
 * AI 能力代理层（设计 §2.2）。
 *
 * <p>将前端 AI 能力请求（summary / extract / rag / chat）翻译为平台
 * {@code /api/v1/agents/{agentId}/chat} 调用，并透传 MIS RS256 JWT 与 X-Trace-Id。
 * 另暴露 {@code /health} 与 {@code /features} 供前端探测可用性。
 *
 * <p>鉴权：所有端点位于 {@code /api/v1/**}，由 {@link com.mis.common.security.permission.ApiPermissionInterceptor}
 * 统一拦截；写类端点需 {@code ai:*:use} 权限，探测类端点为 authOnly（仅登录）。
 */
@RestController
@RequestMapping("/api/v1/ai")
public class AiProxyController {

    /** AI 平台不可用时返回的业务码（非 5 位标准段，仅作降级语义标记）。 */
    private static final int AI_UNAVAILABLE = 503;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private final AiPlatformClient aiPlatformClient;
    private final AiCapabilityTranslator translator;
    private final AiFeatureConfigService featureConfig;
    private final AiPlatformProperties properties;
    private final SkillExecutionEngine skillExecutionEngine;
    private final DocWriteRegistry docWriteRegistry;

    public AiProxyController(
            AiPlatformClient aiPlatformClient,
            AiCapabilityTranslator translator,
            AiFeatureConfigService featureConfig,
            AiPlatformProperties properties,
            SkillExecutionEngine skillExecutionEngine,
            DocWriteRegistry docWriteRegistry) {
        this.aiPlatformClient = aiPlatformClient;
        this.translator = translator;
        this.featureConfig = featureConfig;
        this.properties = properties;
        this.skillExecutionEngine = skillExecutionEngine;
        this.docWriteRegistry = docWriteRegistry;
    }

    // ===== 写类能力端点 =====

    @PostMapping("/summary")
    public Result<AiSummaryResponse> summary(
            @RequestBody AiSummaryRequest req,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        Long employeeId = employeeId();
        return proxyCapability("summary", authorization, traceId, (auth, tid) -> {
            String content = translator.buildSummaryContent(req);
            Map<String, Object> body = translator.buildBody(content, "summary", req.getContext(), employeeId);
            AiPlatformChatData data = aiPlatformClient.chat(translator.agentIdFor("summary"), body, auth, tid);
            return translator.parseSummary(data);
        });
    }

    @PostMapping("/extract")
    public Result<AiExtractResponse> extract(
            @RequestBody AiExtractRequest req,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        Long employeeId = employeeId();
        return proxyCapability("extract", authorization, traceId, (auth, tid) -> {
            String content = translator.buildExtractContent(req);
            Map<String, Object> body = translator.buildBody(content, "extract", req.getContext(), employeeId);
            AiPlatformChatData data = aiPlatformClient.chat(translator.agentIdFor("extract"), body, auth, tid);
            return translator.parseExtract(data);
        });
    }

    @PostMapping("/rag")
    public Result<AiRagResponse> rag(
            @RequestBody AiRagRequest req,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        Long employeeId = employeeId();
        return proxyCapability("rag", authorization, traceId, (auth, tid) -> {
            String content = translator.buildRagContent(req);
            Map<String, Object> body = translator.buildBody(content, "rag", req.getContext(), employeeId);
            AiPlatformChatData data = aiPlatformClient.chat(translator.agentIdFor("rag"), body, auth, tid);
            return translator.parseRag(data);
        });
    }

    /**
     * 流式返回 {@link Flux}（勿包进 ResponseEntity.body）：Spring MVC 才能走 ReactiveTypeHandler 写 SSE。
     * 非流式仍返回 {@link Result} JSON。
     */
    @PostMapping(value = "/chat/completions", produces = {MediaType.APPLICATION_JSON_VALUE, MediaType.TEXT_EVENT_STREAM_VALUE})
    public Object chatCompletions(
            @RequestBody AiChatRequest req,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        Long employeeId = employeeId();
        // T-stream：stream=true 且 sseEnabled 总开关开启 → SSE 透传分支（1:1 转发平台 delta|done|error）
        if (Boolean.TRUE.equals(req.getStream()) && properties.isSseEnabled()) {
            if (!featureConfig.platformAvailable() || !featureConfig.isCapabilityEnabled("chat")) {
                // 门禁未过：以单帧 error 结束流，语义与前端 onError 对齐（非 SSE 误判）
                return sseErrorFlux("AI 平台暂不可用或未启用 chat");
            }
            String content = translator.buildChatContent(req);
            Map<String, Object> body = translator.buildBody(content, "chat", req.getContext(), employeeId);
            return aiPlatformClient.chatStream(
                    translator.agentIdFor("chat"), body, authorization, traceId);
        }
        // 非流式：原缓冲返回（兼容旧客户端 / sseEnabled=false 降级）
        // 显式 application/json，避免客户端 Accept:text/event-stream 时 Result 无法写出 → 500
        Result<AiChatResponse> result = proxyCapability("chat", authorization, traceId, (auth, tid) -> {
            String content = translator.buildChatContent(req);
            Map<String, Object> body = translator.buildBody(content, "chat", req.getContext(), employeeId);
            AiPlatformChatData data = aiPlatformClient.chat(translator.agentIdFor("chat"), body, auth, tid);
            return translator.parseChat(data);
        });
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(result);
    }

    // ===== 探测类端点（authOnly） =====

    @GetMapping("/health")
    public Result<AiHealthResponse> health() {
        return Result.ok(featureConfig.getHealth());
    }

    @GetMapping("/features")
    public Result<AiFeaturesResponse> features() {
        return Result.ok(featureConfig.getFeatures());
    }

    // ===== 内部工具 =====

    /**
     * 统一的可用性门禁 + 异常收口：
     * <ol>
     *   <li>平台不可用 → 503</li>
     *   <li>能力未启用 → 503</li>
     *   <li>下游调用异常（BusinessException）→ 透传 code/message</li>
     * </ol>
     */
    private <T> Result<T> proxyCapability(
            String capability,
            String authorization,
            String traceId,
            BiFunction<String, String, T> action) {
        if (!featureConfig.platformAvailable()) {
            return Result.fail(AI_UNAVAILABLE, "AI 平台暂不可用");
        }
        if (!featureConfig.isCapabilityEnabled(capability)) {
            return Result.fail(AI_UNAVAILABLE, "AI 能力未启用: " + capability);
        }
        try {
            return Result.ok(action.apply(authorization, traceId));
        } catch (BusinessException ex) {
            return Result.fail(ex.getCode(), ex.getMessage());
        }
    }

    private Long employeeId() {
        LoginUser user = RequestContext.requireLoginUser();
        return user.getEmployeeId();
    }

    private Long currentUserId() {
        LoginUser user = RequestContext.requireLoginUser();
        return user.getUserId();
    }

    /**
     * 执行 Skill 智能填充。
     *
     * <p>身份解析（决策3 / Q3）：优先使用 {@link ReverseTrustInterceptor} 经反向信任校验出的委托身份
     * （ai-platform 反向调用场景）；否则回退网关登录用户（mis-admin-web 前端场景）。
     * FormFill 引擎本身零改动。
     *
     * @param request Skill 执行请求（含 skillId、userInput、pageContext）
     * @param httpRequest 容器请求，用于读取反向信任上下文属性
     * @return 执行结果（success / hitl_required / manual_required / error）
     */
    @PostMapping("/skill/execute")
    public Result<SkillExecuteResponse> skillExecute(
            @RequestBody SkillExecuteRequest request,
            HttpServletRequest httpRequest) {
        ResolvedIdentity identity = resolveIdentity(httpRequest);

        SkillExecuteResponse response = skillExecutionEngine.execute(
                request.getSkillId(),
                request.getUserInput(),
                request.getPageContext(),
                identity.userId(),
                identity.tenantId()
        );

        return Result.ok(response);
    }

    /**
     * 单据回填（设计 §4.4 / T04，决策5）。
     *
     * <p>反向信任已在 {@link ReverseTrustInterceptor} 校验；委托身份已写入 SecurityContextHolder，
     * 供 {@code DocWriteHandler} 透传下游操作人。返回结构镜像 skillExecute，包裹于 Result 信封内，
     * ai-platform 侧经 {@code .data} 解包（与 execute 一致）。
     *
     * @param request 回填请求 {skillId, docType, docId, values}
     * @return 回填结果 {status, docId, message}
     */
    @PostMapping("/skill/apply")
    public Result<SkillApplyResponse> applySkillFill(@RequestBody SkillApplyRequest request) {
        if (request.getDocType() == null || request.getDocType().isBlank()) {
            return Result.fail(ResultCode.VALIDATION_ERROR.getCode(), "docType 不能为空");
        }
        DocWriteResult result = docWriteRegistry.apply(
                request.getSkillId(), request.getDocType(), request.getDocId(), request.getValues());
        SkillApplyResponse response = new SkillApplyResponse();
        response.setStatus(result.getStatus());
        response.setDocId(result.getDocId());
        response.setMessage(result.getMessage());
        return Result.ok(response);
    }

    /** 构造一帧 SSE {@code error{message}}（门禁/降级场景）；直接返回 Flux 供 MVC 流式写出。 */
    private Flux<ServerSentEvent<String>> sseErrorFlux(String message) {
        Map<String, String> err = new LinkedHashMap<>();
        err.put("message", message);
        String data;
        try {
            data = objectMapper.writeValueAsString(err);
        } catch (Exception e) {
            data = "{\"message\":\"" + message + "\"}";
        }
        return Flux.just(ServerSentEvent.<String>builder().event("error").data(data).build());
    }

    /**
     * 解析执行/写回身份：优先用反向信任注入的身份（ai-platform 反向调用），
     * 否则回退网关登录用户（mis-admin-web 前端调用）。
     */
    private ResolvedIdentity resolveIdentity(HttpServletRequest request) {
        Object attr = request.getAttribute(ReverseTrustInterceptor.ATTRIBUTE_NAME);
        if (attr instanceof ReverseTrustContext ctx) {
            return new ResolvedIdentity(ctx.userId(), ctx.tenantId());
        }
        LoginUser user = RequestContext.requireLoginUser();
        return new ResolvedIdentity(user.getUserId(), user.getTenantId());
    }

    /** 执行身份（userId / tenantId）。 */
    private record ResolvedIdentity(Long userId, Long tenantId) {
    }
}
