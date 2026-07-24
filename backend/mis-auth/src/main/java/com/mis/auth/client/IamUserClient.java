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
import org.springframework.web.util.UriComponentsBuilder;

import java.util.List;

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

    public AuthUserPayload findByUsername(Long tenantId, Long appId, String username) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/users/by-username")
                .queryParam("tenantId", tenantId)
                .queryParam("appId", appId)
                .queryParam("username", username)
                .build(true)
                .toUriString();
        return getAuthUser(uri);
    }

    public AuthUserPayload findById(Long userId) {
        return getAuthUser("/internal/v1/users/" + userId + "/auth");
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

    private AuthUserPayload getAuthUser(String uri) {
        try {
            Result<AuthUserPayload> result = restClient.get()
                    .uri(uri)
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
            log.warn("调用 mis-iam 查询用户失败: uri={}", uri, ex);
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
