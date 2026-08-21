package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * D12 嵌入身份兑换端点配置（{@code mis.embed}）。
 *
 * <p>宿主共享密钥（client_secret）由部署侧环境变量注入（不入库明文，
 * 与 {@code agent_external_host.client_secret_hash} 配对校验），形如：
 * <pre>
 * mis:
 *   embed:
 *     client-secrets:
 *       crm-web: ${MIS_EMBED_HOST_CRM_WEB_CLIENT_SECRET:}
 *     salt: ${MIS_EMBED_PHONE_HASH_SALT:}
 * </pre>
 *
 * <p><b>为什么 secret 走配置而非 DB</b>：R1 要求用宿主共享密钥验签
 * externalToken（HS256）。HMAC 验签必须持有密钥明文，而
 * {@code agent_external_host.client_secret_hash} 只存哈希（泄露面最小）。
 * 故验签密钥取自本配置，哈希列用于「配置与注册一致性」交叉校验
 * （sha256(secret) != client_secret_hash ⇒ 拒绝，fail-closed）。
 */
@ConfigurationProperties(prefix = "mis.embed")
public class EmbedIdentityProperties {

    /** 宿主共享密钥（hostId → client_secret 明文，用于 externalToken HS256 验签）。 */
    private Map<String, String> clientSecrets = new LinkedHashMap<>();

    /** phone_hash = sha256(phone + salt) 的 salt（R5 脱敏存储；空 = 不加盐）。 */
    private String salt = "";

    /** 手机号匹配开关（host 级，默认 true；03 §5.2 phone_match_enabled 默认 true）。 */
    private boolean phoneMatchEnabled = true;

    /** 兑换限流：同一 hostId 每分钟最大请求数（R6 防撞库），默认 60。 */
    private int rateLimitPerMinute = 60;

    public Map<String, String> getClientSecrets() {
        return clientSecrets;
    }

    public void setClientSecrets(Map<String, String> clientSecrets) {
        this.clientSecrets = clientSecrets != null ? clientSecrets : new LinkedHashMap<>();
    }

    public String getSalt() {
        return salt;
    }

    public void setSalt(String salt) {
        this.salt = salt != null ? salt : "";
    }

    public boolean isPhoneMatchEnabled() {
        return phoneMatchEnabled;
    }

    public void setPhoneMatchEnabled(boolean phoneMatchEnabled) {
        this.phoneMatchEnabled = phoneMatchEnabled;
    }

    public int getRateLimitPerMinute() {
        return rateLimitPerMinute;
    }

    public void setRateLimitPerMinute(int rateLimitPerMinute) {
        this.rateLimitPerMinute = rateLimitPerMinute;
    }
}
