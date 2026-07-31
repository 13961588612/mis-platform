package com.mis.adminbff.security;

/**
 * 反向信任解析出的调用方身份（设计 §3 决策3 / Q3）。
 *
 * <p>由 {@link ReverseTrustInterceptor} 在 {@code preHandle} 中计算并写入请求属性，
 * 供 {@code AiProxyController} 注入 {@code SkillExecutionEngine.execute(...)} 的执行上下文。
 *
 * @param userId        委托用户主键（来自 MIS JWT 的 sub，或 X-User-Id 头降级）
 * @param tenantId      委托租户（来自 MIS JWT 的 tenantId，或 X-Tenant-Id 头降级）
 * @param username      委托用户名（可选）
 * @param channel       调用通道（wecom-bot | h5 | wecom-h5，来自 X-Channel）
 * @param fromUpstreamJwt 身份是否来自验签通过的 X-Mis-Upstream-Jwt（false 为 X-User-Id 降级）
 * @param sourceIp      调用来源 IP（用于审计）
 */
public record ReverseTrustContext(
        Long userId,
        Long tenantId,
        String username,
        String channel,
        boolean fromUpstreamJwt,
        String sourceIp) {
}
