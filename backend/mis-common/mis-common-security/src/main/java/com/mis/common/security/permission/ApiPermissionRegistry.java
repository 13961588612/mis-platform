package com.mis.common.security.permission;

import org.springframework.util.AntPathMatcher;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 内存 API 权限映射（method + path → permission / authOnly）。
 */
public class ApiPermissionRegistry {

    private final AntPathMatcher pathMatcher = new AntPathMatcher();
    private final AtomicReference<List<ApiPermissionRule>> rules =
            new AtomicReference<>(List.of());

    public void replaceAll(Collection<ApiPermissionRule> next) {
        List<ApiPermissionRule> copy = next == null
                ? List.of()
                : List.copyOf(new ArrayList<>(next));
        rules.set(copy);
    }

    public int size() {
        return rules.get().size();
    }

    /**
     * 匹配结果：未命中 → empty；authOnly → permissions 空且 authOnly=true；
     * 否则 permissions 为命中规则要求的权限并集（任一即可）。
     */
    public Optional<Match> match(String httpMethod, String requestPath) {
        if (!StringUtils.hasText(httpMethod) || !StringUtils.hasText(requestPath)) {
            return Optional.empty();
        }
        String method = httpMethod.trim().toUpperCase(Locale.ROOT);
        String path = normalizePath(requestPath);
        Set<String> permissions = new LinkedHashSet<>();
        boolean authOnly = false;
        boolean hit = false;
        for (ApiPermissionRule rule : rules.get()) {
            if (rule.httpMethod() == null || rule.pathPattern() == null) {
                continue;
            }
            if (!method.equalsIgnoreCase(rule.httpMethod().trim())) {
                continue;
            }
            if (!pathMatcher.match(rule.pathPattern(), path)) {
                continue;
            }
            hit = true;
            if (rule.authOnly() || !StringUtils.hasText(rule.permission())) {
                authOnly = true;
            } else {
                permissions.add(rule.permission().trim());
            }
        }
        if (!hit) {
            return Optional.empty();
        }
        // 同时命中「仅登录」与「需权限」时，以权限为准
        if (!permissions.isEmpty()) {
            return Optional.of(new Match(false, Set.copyOf(permissions)));
        }
        return Optional.of(new Match(authOnly, Set.of()));
    }

    private static String normalizePath(String requestPath) {
        String path = requestPath.trim();
        int q = path.indexOf('?');
        if (q >= 0) {
            path = path.substring(0, q);
        }
        if (path.length() > 1 && path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }
        return path;
    }

    public record Match(boolean authOnly, Set<String> permissions) {
    }
}
