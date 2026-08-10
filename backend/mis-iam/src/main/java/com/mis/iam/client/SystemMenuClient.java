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

import java.util.List;
import java.util.Map;
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

    /**
     * 解析菜单权限码（C-1/DEF 同源修复，别改回 {@code build(true) + uri(String)}）。
     *
     * <p>旧实现 {@code UriComponentsBuilder...build(true).toUriString()} 产出「已声明编码」
     * 的字符串再交给 {@code RestClient.uri(String)}，其背后
     * {@code DefaultUriBuilderFactory}（{@code TEMPLATE_AND_VALUES}）会再编码一次；
     * {@code menuIds} 虽是纯数字串「巧合安全」，但这套写法对任何含保留字符/非 ASCII
     * 的参数都是定时炸弹（DEF-01/DEF-02 原样重演）。这里改为把 URI 构造交给
     * {@code RestClient} 自己的 {@code UriBuilder}（携带 baseUrl）：编码只发生一次、
     * baseUrl 不丢；{@code menuIds} 以 {@code {menuIds}} 占位 + {@code build(Map)} 展开，
     * 值里的 {@code &} / {@code =} 会被整体编码而不劈开查询串。
     *
     * @param menuIds 菜单 id 列表（非空，调用方已判）
     * @return 权限码列表
     */
    public List<String> permissionCodes(List<Long> menuIds) {
        if (menuIds == null || menuIds.isEmpty()) {
            return List.of();
        }
        String ids = menuIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        try {
            Result<List<String>> result = restClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/internal/v1/menus/permissions")
                            .queryParam("menuIds", "{menuIds}")
                            .build(Map.of("menuIds", ids)))
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
