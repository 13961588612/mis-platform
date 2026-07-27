package com.mis.common.security.permission;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.common.security.permission.ApiPermissionRegistry.Match;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Optional;
import java.util.Set;
import java.util.function.Function;

/**
 * BFF PEP：method + path 查 Registry，比对当前用户 permissions（ADR-008 / ADR-010）。
 */
public class ApiPermissionInterceptor implements HandlerInterceptor {

    private final ApiPermissionRegistry registry;
    private final ApiPermissionProperties properties;
    private final Function<LoginUser, Set<String>> permissionLoader;

    public ApiPermissionInterceptor(
            ApiPermissionRegistry registry,
            ApiPermissionProperties properties,
            Function<LoginUser, Set<String>> permissionLoader) {
        this.registry = registry;
        this.properties = properties;
        this.permissionLoader = permissionLoader;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // SSE/Flux 异步写出时会二次进入拦截器；此时 GatewayContextFilter 不跑，LoginUser 已空，跳过即可
        // （REQUEST 阶段已鉴权通过）。
        if (request.getDispatcherType() == DispatcherType.ASYNC
                || request.getDispatcherType() == DispatcherType.ERROR) {
            return true;
        }
        if (!properties.isEnabled()) {
            return true;
        }
        String path = request.getRequestURI();
        if (isExempt(path)) {
            return true;
        }

        Optional<Match> match = registry.match(request.getMethod(), path);
        if (match.isEmpty()) {
            if (properties.isDenyUnmapped()) {
                throw new BusinessException(ResultCode.FORBIDDEN, "接口未授权映射");
            }
            return true;
        }

        // Q4：命中规则的接口若所属模块停用（module_status=0），无论 denyUnmapped 如何，一律 403 拒绝。
        Match m = match.get();
        if (m.moduleStatus() != null && m.moduleStatus() == 0) {
            throw new BusinessException(ResultCode.FORBIDDEN, "接口所属模块已停用");
        }

        LoginUser user = SecurityContextHolder.getOptional()
                .orElseThrow(() -> new BusinessException(ResultCode.UNAUTHORIZED));
        if (user.getUserId() == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }

        if (m.authOnly()) {
            return true;
        }

        Set<String> userPerms = permissionLoader.apply(user);
        if (userPerms == null) {
            userPerms = Set.of();
        }
        user.setPermissions(userPerms);

        for (String required : m.permissions()) {
            if (StringUtils.hasText(required) && userPerms.contains(required)) {
                return true;
            }
        }
        throw new BusinessException(ResultCode.FORBIDDEN);
    }

    private static boolean isExempt(String path) {
        return path.startsWith("/actuator")
                || path.startsWith("/error");
    }
}
