package com.mis.common.security.permission;

/**
 * API 鉴权规则：method + pathPattern → permission（或仅登录）。
 * <p>{@code moduleStatus} 取自 sys_module.status：0=停用。Q4 方案下，命中规则的接口若所属模块停用，
 * 拦截器直接返回 403（即便 denyUnmapped=false 也不会被放行）。</p>
 */
public record ApiPermissionRule(
        String httpMethod,
        String pathPattern,
        String permission,
        boolean authOnly,
        Integer moduleStatus
) {
}
