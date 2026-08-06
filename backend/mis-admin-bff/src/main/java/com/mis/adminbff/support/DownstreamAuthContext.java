package com.mis.adminbff.support;

/**
 * 请求级持有器：保存 BFF 收到的原始 MIS JWT（Authorization 头），
 * 供下游调用（agent-ops → ai-platform）透传，使平台能走 RS256 分支验签。
 *
 * <p>使用 ThreadLocal 承载，由 {@code MisJwtCaptureFilter} 在请求入口写入、
 * finally 中清除，避免线程池复用导致 token 串号。仅限 mis-admin-bff 内部使用，
 * 不改动共享的 mis-common-security（LoginUser / GatewayContextFilter 保持不动）。
 *
 * <p>背景：ai-platform 的 {@code get_current_user}（src/api/deps.py）要求
 * {@code Authorization: Bearer <token>}，而既有 {@code loginContextHeaders()}
 * 只透传 X-User-Id / X-Tenant-Id 等上下文头、不含 JWT，导致 agent-ops 控制台
 * 全部下游请求 401。此处把原始 JWT 暂存，由 {@code AgentOpsTransport} 在下游
 * 请求里补上 Authorization 头。
 */
public final class DownstreamAuthContext {

    private static final ThreadLocal<String> TOKEN = new ThreadLocal<>();

    private DownstreamAuthContext() {
    }

    /** 写入原始 Authorization 头值（含 "Bearer " 前缀）；空值视为清除。 */
    public static void setToken(String token) {
        if (token == null || token.isBlank()) {
            TOKEN.remove();
        } else {
            TOKEN.set(token);
        }
    }

    /** 读取原始 Authorization 头值；未设置时返回 {@code null}。 */
    public static String getToken() {
        return TOKEN.get();
    }

    /** 请求结束时清除，防止线程池复用串号。 */
    public static void clear() {
        TOKEN.remove();
    }
}
