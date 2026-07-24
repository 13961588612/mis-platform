package com.mis.adminbff.client;

import com.fasterxml.jackson.databind.ObjectMapper;
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

    /** X-Mis-* 头名（与平台 docs/identity-enrichment-task-list.md §4 约定一致）。 */
    private static final String HEADER_MIS_DEPTS = "X-Mis-Depts";
    private static final String HEADER_MIS_ORGS = "X-Mis-Orgs";
    private static final String HEADER_MIS_ROLES = "X-Mis-Roles";

    /** IAM 取数短 TTL 缓存（T4.4，降低 IAM 压力与请求延迟）。 */
    private static final long IAM_CACHE_TTL_MS = 60_000L;

    private final IamWebClient iamWebClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<Long, IamCacheEntry> iamCache = new ConcurrentHashMap<>();

    public AiPlatformClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            AiPlatformProperties properties,
            IamWebClient iamWebClient) {
        super(
                plainBuilder.baseUrl(properties.getBaseUrl()).build(),
                properties.getChatTimeoutMs());
        this.iamWebClient = iamWebClient;
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
        Consumer<HttpHeaders> headers = buildHeaders(authorization, traceId);
        return block(client().post()
                .uri("/api/v1/agents/{agentId}/chat", agentId)
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                .retrieve()
                .bodyToMono(CHAT_TYPE));
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
                        return Flux.just(ServerSentEvent.builder(String.class)
                                .event("error")
                                .data(objectMapper.writeValueAsString(err))
                                .build());
                    } catch (Exception e) {
                        return Flux.just(ServerSentEvent.builder(String.class)
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
        try {
            return client().get()
                    .uri("/health")
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                    .block(Duration.ofSeconds(3));
        } catch (Exception ex) {
            return null;
        }
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
     * 从安全上下文取 LoginUser → 调 MIS IAM 取 roles + deptId → 组装 X-Mis-Depts / X-Mis-Orgs / X-Mis-Roles。
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
                    return; // 无登录上下文则不注入
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
                // 降级：IAM 不可达 / 解析失败 → 省略 X-Mis-* 头，平台退化为旧行为（不阻断主流程）
            }
        };
    }

    /**
     * 取 MIS IAM 用户明细，带短 TTL 缓存（T4.4）。
     *
     * @param userId IAM 用户 id（= LoginUser.getUserId()，详见 R3）
     * @return IAM 用户视图；IAM 不可达时返回 {@code null}
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

    /** IAM 取数缓存条目（T4.4）：携带过期时间戳，TTL ≈ 60s。 */
    private record IamCacheEntry(IamUserVO user, long expireAt) {
        private boolean isAlive() {
            return System.currentTimeMillis() < expireAt;
        }
    }
}
