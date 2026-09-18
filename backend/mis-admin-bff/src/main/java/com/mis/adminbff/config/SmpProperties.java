package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 老 SMP 体系共享配置：鉴权头 + auth-service 令牌兑换。
 *
 * <p>多下游（bip-bank-receipt、后续其它 SMP 服务）共用一套兑换逻辑；
 * 契约见 {@code docs/integration/smp-auth-service-exchange.md}。
 * 须在 {@link BffConfiguration} 登记。
 */
@ConfigurationProperties(prefix = "mis.bff.smp")
public class SmpProperties {

    /** 调老 auth exchange 的超时（毫秒）。 */
    private long exchangeTimeoutMs = 5000;

    private Auth auth = new Auth();
    private TokenExchange tokenExchange = new TokenExchange();

    public long getExchangeTimeoutMs() {
        return exchangeTimeoutMs;
    }

    public void setExchangeTimeoutMs(long exchangeTimeoutMs) {
        this.exchangeTimeoutMs = exchangeTimeoutMs;
    }

    public Auth getAuth() {
        return auth;
    }

    public void setAuth(Auth auth) {
        this.auth = auth;
    }

    public TokenExchange getTokenExchange() {
        return tokenExchange;
    }

    public void setTokenExchange(TokenExchange tokenExchange) {
        this.tokenExchange = tokenExchange;
    }

    /** 下游请求头（默认与 smp-client 一致）。 */
    public static class Auth {
        private String headerName = "HC-SMP-Authorization";
        private String headerPrefix = "";

        public String getHeaderName() {
            return headerName;
        }

        public void setHeaderName(String headerName) {
            this.headerName = headerName;
        }

        public String getHeaderPrefix() {
            return headerPrefix;
        }

        public void setHeaderPrefix(String headerPrefix) {
            this.headerPrefix = headerPrefix;
        }

        /** 组装完整头值（前缀 + 裸 token）。 */
        public String headerValue(String bareToken) {
            String prefix = headerPrefix == null ? "" : headerPrefix;
            return prefix + (bareToken == null ? "" : bareToken);
        }
    }

    public static class TokenExchange {
        private boolean enabled = true;
        private String tokenUrl = "";
        private String clientId = "mis-admin-bff";
        private String clientSecret = "";
        /** 默认 audience；单次兑换可覆盖。 */
        private String audience = "";
        private String tokenJsonPath = "$.data.token";
        private boolean failClosed = true;
        private Cache cache = new Cache();

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getTokenUrl() {
            return tokenUrl;
        }

        public void setTokenUrl(String tokenUrl) {
            this.tokenUrl = tokenUrl;
        }

        public String getClientId() {
            return clientId;
        }

        public void setClientId(String clientId) {
            this.clientId = clientId;
        }

        public String getClientSecret() {
            return clientSecret;
        }

        public void setClientSecret(String clientSecret) {
            this.clientSecret = clientSecret;
        }

        public String getAudience() {
            return audience;
        }

        public void setAudience(String audience) {
            this.audience = audience;
        }

        public String getTokenJsonPath() {
            return tokenJsonPath;
        }

        public void setTokenJsonPath(String tokenJsonPath) {
            this.tokenJsonPath = tokenJsonPath;
        }

        public boolean isFailClosed() {
            return failClosed;
        }

        public void setFailClosed(boolean failClosed) {
            this.failClosed = failClosed;
        }

        public Cache getCache() {
            return cache;
        }

        public void setCache(Cache cache) {
            this.cache = cache;
        }
    }

    public static class Cache {
        private boolean enabled = true;
        /** 键形态：{prefix}{misUserId}:{audience} */
        private String keyPrefix = "bff:smp-token:user:";
        private long skewSeconds = 60;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getKeyPrefix() {
            return keyPrefix;
        }

        public void setKeyPrefix(String keyPrefix) {
            this.keyPrefix = keyPrefix;
        }

        public long getSkewSeconds() {
            return skewSeconds;
        }

        public void setSkewSeconds(long skewSeconds) {
            this.skewSeconds = skewSeconds;
        }
    }
}
