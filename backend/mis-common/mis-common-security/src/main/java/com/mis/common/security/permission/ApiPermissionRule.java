package com.mis.common.security.permission;

/**
 * API 鉴权规则：method + pathPattern → permission（或仅登录）。
 */
public record ApiPermissionRule(
        String httpMethod,
        String pathPattern,
        String permission,
        boolean authOnly
) {
}
