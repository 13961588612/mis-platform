package com.mis.adminbff.support.embed;

/**
 * externalToken 解析后的 claims（P4：只信验签结果，不信任请求体冗余字段）。
 *
 * @param appId          宿主应用标识（= hostId，验签后用于一致性校验）
 * @param hostId         宿主标识（iss 兜底）
 * @param externalUserId 外部用户标识（必填）
 * @param phone          手机号（可选，仅作匹配键，R2）
 * @param expiresAt      exp（秒）
 */
public record ExternalTokenClaims(
        String appId,
        String hostId,
        String externalUserId,
        String phone,
        long expiresAt
) {
}
