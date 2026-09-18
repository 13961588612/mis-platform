package com.mis.adminbff.dto.finance;

/**
 * 老 auth 回查用的当前用户瘦资料（含手机号）。
 *
 * <p>契约：{@code docs/integration/mis-legacy-auth-me.md}。
 */
public record LegacyAuthMeVO(
        String userId,
        String tenantId,
        String appId,
        String username,
        String realName,
        String phone,
        Integer status
) {}
