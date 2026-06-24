package com.mis.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.http.HttpMethod;
import org.springframework.util.AntPathMatcher;

import java.util.ArrayList;
import java.util.List;

/**
 * Gateway 认证相关配置（前缀 {@code mis.security.gateway}）。
 * <p>
 * 白名单条目格式：
 * <ul>
 *   <li>{@code METHOD:/path} — 限定 HTTP 方法，如 {@code POST:/api/v1/auth/login}</li>
 *   <li>{@code /path} — 任意方法，如 {@code GET:/actuator/**}</li>
 * </ul>
 * 路径支持 Ant 风格（{@link AntPathMatcher}）。
 */
@ConfigurationProperties(prefix = "mis.security.gateway")
public class GatewaySecurityProperties {

    private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();

    private boolean enabled = true;

    /**
     * 白名单：无需 Bearer Token 的路径（仍可能由 mis-auth 自行校验登录参数）。
     */
    private List<String> whitelist = defaultWhitelist();

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public List<String> getWhitelist() {
        return whitelist;
    }

    public void setWhitelist(List<String> whitelist) {
        this.whitelist = whitelist;
    }

    public boolean isWhitelisted(HttpMethod method, String path) {
        for (String entry : whitelist) {
            if (matches(entry, method, path)) {
                return true;
            }
        }
        return false;
    }

    private static boolean matches(String entry, HttpMethod method, String path) {
        String entryMethod = null;
        String pattern = entry;
        int colon = entry.indexOf(':');
        if (colon > 0) {
            entryMethod = entry.substring(0, colon).trim();
            pattern = entry.substring(colon + 1).trim();
        }
        if (entryMethod != null && method != null && !entryMethod.equalsIgnoreCase(method.name())) {
            return false;
        }
        return PATH_MATCHER.match(pattern, path);
    }

    /** 与 {@code docs/architecture/03-security.md} §5.1 及 api-specification 对齐 */
    private static List<String> defaultWhitelist() {
        List<String> list = new ArrayList<>();
        list.add("POST:/api/v1/auth/login");
        list.add("POST:/api/v1/auth/refresh");
        list.add("GET:/api/v1/auth/captcha");
        list.add("GET:/actuator/**");
        list.add("GET:/v3/api-docs/**");
        return list;
    }
}
