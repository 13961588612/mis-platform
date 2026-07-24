package com.mis.org.client;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.org.config.OrgProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.List;

@Component
public class IamDataScopeClient {

    private static final Logger log = LoggerFactory.getLogger(IamDataScopeClient.class);

    private final RestClient restClient;

    public IamDataScopeClient(
            @Qualifier("plainRestClientBuilder") RestClient.Builder plainBuilder,
            RestClient.Builder loadBalancedBuilder,
            OrgProperties properties) {
        RestClient.Builder builder = properties.isIamDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        String baseUrl = properties.isIamDiscoveryEnabled()
                ? "http://" + properties.getIamServiceId()
                : properties.getIamBaseUrl();
        this.restClient = builder.baseUrl(baseUrl).build();
    }

    public DataScopePayload resolveDataScope(Long userId) {
        try {
            Result<DataScopePayload> result = restClient.get()
                    .uri("/internal/v1/users/{id}/data-scope", userId)
                    .retrieve()
                    .body(new ParameterizedTypeReference<Result<DataScopePayload>>() {});
            if (result == null || !result.isSuccess() || result.getData() == null) {
                throw new BusinessException(ResultCode.INTERNAL_ERROR, "无法解析用户数据权限");
            }
            return result.getData();
        } catch (BusinessException ex) {
            throw ex;
        } catch (RestClientException ex) {
            log.warn("调用 mis-iam 解析 data-scope 失败: userId={}", userId, ex);
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "无法解析用户数据权限，请确认 mis-iam 已启动");
        }
    }

    /** @return 有效 data_scope；调用失败时抛业务异常 */
    public int resolveMaxDataScope(Long userId) {
        return resolveDataScope(userId).dataScope();
    }

    public record DataScopePayload(
            int dataScope,
            List<Long> customOrgIds,
            List<Long> customDeptIds
    ) {
        public DataScopePayload {
            customOrgIds = customOrgIds != null ? customOrgIds : List.of();
            customDeptIds = customDeptIds != null ? customDeptIds : List.of();
        }
    }
}
