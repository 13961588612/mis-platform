package com.mis.adminbff.support;

import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;

import java.util.Optional;

/**
 * 任务流身份解析（网关身份透传过渡期）。
 *
 * <p>优先取网关写入的 {@link LoginUser} 上下文（tenantId/userId），
 * 未登录或本地联调时回退到调用方显式传入的查询参数；仍为空则回退默认租户 1。
 *
 * <p>这样前端无需再手工传 tenantId/userId，接口后续可逐步移除这些参数。
 */
public final class TaskflowIdentity {

    private static final Long DEFAULT_TENANT = 1L;

    private TaskflowIdentity() {
    }

    public static Long tenantId(Long fallback) {
        return SecurityContextHolder.getOptional().map(LoginUser::getTenantId)
                .orElseGet(() -> fallback != null ? fallback : DEFAULT_TENANT);
    }

    public static Long userId(Long fallback) {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId)
                .orElse(fallback);
    }

    public static Long operatorId(Long fallback) {
        Optional<LoginUser> u = SecurityContextHolder.getOptional();
        return u.map(LoginUser::getUserId).orElse(fallback);
    }
}
