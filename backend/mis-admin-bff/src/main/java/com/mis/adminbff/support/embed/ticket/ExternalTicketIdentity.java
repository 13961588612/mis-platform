package com.mis.adminbff.support.embed.ticket;

/**
 * 外部验票结果（映射前）：来自致远等 ticket-pull 适配器。
 *
 * @param externalUserId 稳定外部用户键（优先 loginName，否则 memberId）
 * @param loginName      登录名（可空）
 * @param memberId       外部人员 ID（可空）
 * @param phone          手机号明文（仅内存匹配，不写日志）
 * @param displayName    展示名（可空）
 */
public record ExternalTicketIdentity(
        String externalUserId,
        String loginName,
        String memberId,
        String phone,
        String displayName
) {
}
