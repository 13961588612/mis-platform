package com.mis.iam.client;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.iam.config.IamProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.List;
import java.util.stream.Collectors;

@Component
public class SystemMenuClient {

    private static final Logger log = LoggerFactory.getLogger(SystemMenuClient.class);

    private final RestClient restClient;

    public SystemMenuClient(
            @Qualifier("plainRestClientBuilder") RestClient.Builder plainBuilder,
            RestClient.Builder loadBalancedBuilder,
            IamProperties properties) {
        RestClient.Builder builder = properties.isSystemDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        String baseUrl = properties.isSystemDiscoveryEnabled()
                ? "http://" + properties.getSystemServiceId()
                : properties.getSystemBaseUrl();
        this.restClient = builder.baseUrl(baseUrl).build();
    }

    public List<String> permissionCodes(List<Long> menuIds) {
        if (menuIds == null || menuIds.isEmpty()) {
            return List.of();
        }
        String ids = menuIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        String uri = UriComponentsBuilder.fromPath("/internal/v1/menus/permissions")
                .queryParam("menuIds", ids)
                .build(true)
                .toUriString();
        try {
            Result<List<String>> result = restClient.get()
                    .uri(uri)
                    .retrieve()
                    .body(new ParameterizedTypeReference<Result<List<String>>>() {});
            if (result == null || !result.isSuccess()) {
                throw new BusinessException(ResultCode.INTERNAL_ERROR, "无法解析菜单权限码");
            }
            return result.getData() != null ? result.getData() : List.of();
        } catch (BusinessException ex) {
            throw ex;
        } catch (RestClientException ex) {
            log.warn("调用 mis-system 解析 permission 失败", ex);
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "无法解析菜单权限，请确认 mis-system 已启动");
        }
    }
}
