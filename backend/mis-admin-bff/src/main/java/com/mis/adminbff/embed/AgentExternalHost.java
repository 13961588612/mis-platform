package com.mis.adminbff.embed;

/**
 * {@code agent_external_host} 表行（D12 宿主注册表）。
 *
 * <p>映射 02-task-breakdown §5.2 建表 SQL；{@code tenantId} 为本实现的
 * 平台化扩展列：手机号匹配需按租户限定查询范围（mis-iam 分页端点
 * {@code tenantId} 为必填），未配置则跳过手机号匹配直接走影子账号。
 */
public record AgentExternalHost(
        String hostId,
        String hostName,
        String clientId,
        String clientSecretHash,
        String shadowMisUserId,
        String status,
        Long tenantId,
        String allowedOrigins
) {
    /** 注册是否有效（active 且 hostId 非空） */
    public boolean isActive() {
        return hostId != null && !hostId.isBlank() && "active".equalsIgnoreCase(status);
    }
}
