package com.mis.auth.client;

import com.mis.auth.config.AuthProperties;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriBuilder;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * 调用 mis-iam 查询登录用户（ADR-007：领域服务用 RestClient）。
 */
@Component
public class IamUserClient {

    private static final Logger log = LoggerFactory.getLogger(IamUserClient.class);

    private final RestClient restClient;

    public IamUserClient(
            @Qualifier("plainRestClientBuilder") RestClient.Builder plainRestClientBuilder,
            RestClient.Builder loadBalancedRestClientBuilder,
            AuthProperties authProperties) {
        RestClient.Builder builder = authProperties.isIamDiscoveryEnabled()
                ? loadBalancedRestClientBuilder
                : plainRestClientBuilder;
        this.restClient = builder.baseUrl(resolveBaseUrl(authProperties)).build();
    }

    /**
     * 按用户名查登录用户（C-1 修复点，别改回 {@code build(true) + uri(String)}）。
     *
     * <h2>为什么不能再拼字符串</h2>
     * 旧实现走 {@code UriComponentsBuilder...build(true).toUriString()}。
     * {@code build(true)} 的语义是「这段字符串<b>已经</b>百分号编码」，于是
     * {@code HierarchicalUriComponents.verify()} 会逐字符校验，中文用户名里的「张」
     * 直接触发 {@code IllegalArgumentException: Invalid character '张' for QUERY_PARAM}，
     * 登录接口 500。
     *
     * <p>而换成 {@code build().encode().toUriString()} 再喂给 {@code uri(String)} 同样错：
     * {@code RestClient} 的 {@code uri(String)} 背后是 {@code DefaultUriBuilderFactory}
     * （默认 {@code TEMPLATE_AND_VALUES}），会把已编码串<b>再编码一次</b>，
     * {@code %E5%BC%A0} → {@code %25E5%25BC%25A0}，下游解码后是乱码 —— 即 DEF-01 的重演。
     *
     * <p>这里改为把 URI 构造交给 {@code RestClient} 自己的
     * {@link UriBuilder}（{@code DefaultRestClient} 用构造时的
     * {@code uriBuilderFactory.builder()} 调用本函数，该 factory 携带 baseUrl）：
     * <b>编码只发生一次，且 baseUrl 的 scheme/host/port 完整保留</b>，
     * {@code @LoadBalanced} 依赖的服务名 host 也不会丢。
     *
     * <p>{@code username} 用 {@code {username}} 变量占位、真值走
     * {@link UriBuilder#build(Map)} 展开，这样值里的 {@code &}/{@code =} 会被整体编码
     * 而不劈开查询串，用户名里的花括号也不会被误解析成模板变量。
     */
    public AuthUserPayload findByUsername(Long tenantId, Long appId, String username) {
        Map<String, Object> uriVariables = username != null
                ? Map.of("username", username)
                : Map.of();
        return getAuthUser(uriBuilder -> uriBuilder.path("/internal/v1/users/by-username")
                        .queryParam("tenantId", tenantId)
                        .queryParam("appId", appId)
                        // username 为 null 时保持旧行为：只带 key、不带值
                        .queryParam("username", username != null ? "{username}" : null)
                        .build(uriVariables),
                "/internal/v1/users/by-username");
    }

    public AuthUserPayload findById(Long userId) {
        return getAuthUser(uriBuilder -> uriBuilder.path("/internal/v1/users/{id}/auth").build(userId),
                "/internal/v1/users/{id}/auth");
    }

    /** 触发 IAM 聚合 permissions 并写入 Redis（ADR-009）。 */
    public void loadAndCachePermissions(Long userId) {
        try {
            Result<Object> result = restClient.get()
                    .uri("/internal/v1/permissions/{userId}", userId)
                    .retrieve()
                    .body(new ParameterizedTypeReference<Result<Object>>() {});
            if (result == null || !result.isSuccess()) {
                log.warn("加载用户 permissions 失败: userId={}, code={}",
                        userId, result != null ? result.getCode() : null);
            }
        } catch (RestClientException ex) {
            // 登录主流程不因权限缓存失败而中断；BFF 可 miss 回源
            log.warn("调用 mis-iam 写 permissions 失败: userId={}", userId, ex);
        }
    }

    public void changePassword(Long userId, String newPassword) {
        try {
            Result<Void> result = restClient.put()
                    .uri("/internal/v1/users/{id}/password", userId)
                    .body(java.util.Map.of("newPassword", newPassword))
                    .retrieve()
                    .body(new ParameterizedTypeReference<Result<Void>>() {});
            if (result == null || !result.isSuccess()) {
                throw new BusinessException(
                        result != null ? result.getCode() : ResultCode.INTERNAL_ERROR.getCode(),
                        result != null ? result.getMessage() : "修改密码失败");
            }
        } catch (BusinessException ex) {
            throw ex;
        } catch (RestClientException ex) {
            log.warn("调用 mis-iam 修改密码失败: userId={}", userId, ex);
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "无法修改密码，请确认 mis-iam 已启动");
        }
    }

    /**
     * 统一的「查用户」调用。
     *
     * @param uriFunction 作用在 RestClient 自身 {@link UriBuilder}（携带 baseUrl）上的 URI 构造函数，
     *                    保证查询串只编码一次；不要退化成预编码字符串（见 {@link #findByUsername}）
     * @param pathHint    仅用于失败日志的路径模板；刻意不打印真实 URI，
     *                    既避免把用户名等 PII 写进日志，也不依赖 uriFunction 的求值
     */
    private AuthUserPayload getAuthUser(Function<UriBuilder, URI> uriFunction, String pathHint) {
        try {
            Result<AuthUserPayload> result = restClient.get()
                    .uri(uriFunction)
                    .retrieve()
                    .body(new ParameterizedTypeReference<Result<AuthUserPayload>>() {});
            if (result == null || !result.isSuccess() || result.getData() == null) {
                if (result != null && result.getCode() == ResultCode.NOT_FOUND.getCode()) {
                    return null;
                }
                throw new BusinessException(
                        result != null ? result.getCode() : ResultCode.INTERNAL_ERROR.getCode(),
                        result != null ? result.getMessage() : "mis-iam 无响应");
            }
            return result.getData();
        } catch (BusinessException ex) {
            throw ex;
        } catch (RestClientException ex) {
            log.warn("调用 mis-iam 查询用户失败: path={}", pathHint, ex);
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "无法查询用户，请确认 mis-iam 已启动");
        }
    }

    private static String resolveBaseUrl(AuthProperties properties) {
        if (properties.isIamDiscoveryEnabled()) {
            return "http://" + properties.getIamServiceId();
        }
        return properties.getIamBaseUrl();
    }

    /** 对齐 mis-iam AuthUserVO JSON。 */
    public record AuthUserPayload(
            String id,
            String tenantId,
            String appId,
            String employeeId,
            String username,
            String passwordHash,
            Integer status,
            Integer isTenantAdmin,
            Integer mustChangePassword,
            Long permVersion,
            List<String> roleCodes,
            String realName,
            String deptId
    ) {
        public long userId() {
            return Long.parseLong(id);
        }

        public long tenantIdLong() {
            return Long.parseLong(tenantId);
        }

        public long employeeIdLong() {
            return Long.parseLong(employeeId);
        }

        public boolean mustChangePasswordFlag() {
            return mustChangePassword != null && mustChangePassword == 1;
        }

        public boolean isActive() {
            return status != null && status == 1;
        }
    }
}
