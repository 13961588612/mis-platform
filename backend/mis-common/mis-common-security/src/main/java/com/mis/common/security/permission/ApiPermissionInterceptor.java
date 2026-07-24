package com.mis.common.security.permission;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.common.security.permission.ApiPermissionRegistry.Match;
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

        LoginUser user = SecurityContextHolder.getOptional()
                .orElseThrow(() -> new BusinessException(ResultCode.UNAUTHORIZED));
        if (user.getUserId() == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }

        Match m = match.get();
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
