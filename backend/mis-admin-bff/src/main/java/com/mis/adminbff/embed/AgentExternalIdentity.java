package com.mis.adminbff.embed;

/**
 * {@code agent_external_identity} 表行（D12 外部用户 → MIS 用户 显式映射）。
 *
 * <p>映射 02-task-breakdown §5.2 建表 SQL；{@code phoneHash} 为匹配键（非唯一），
 * 允许一手机号多行（用户拍板：不清理历史数据，歧义由兑换端 fail-closed 兜底）。
 */
public record AgentExternalIdentity(
        String hostId,
        String externalUserId,
        String externalUsername,
        Long misUserId,
        String phoneHash,
        String status
) {
    /** 映射是否有效 */
    public boolean isActive() {
        return misUserId != null && "active".equalsIgnoreCase(status);
    }
}
