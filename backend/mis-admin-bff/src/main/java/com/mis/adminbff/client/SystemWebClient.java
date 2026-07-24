package com.mis.adminbff.client;

import com.mis.adminbff.client.model.ApiPermissionRuleDTO;
import com.mis.adminbff.client.model.MenuVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.common.core.result.Result;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Component
public class SystemWebClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<List<MenuVO>>> MENU_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<MenuVO>> MENU =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<String>>> STRING_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<ApiPermissionRuleDTO>>> API_RULE_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Void>> VOID =
            new ParameterizedTypeReference<>() {};

    public SystemWebClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            @Qualifier("loadBalancedWebClientBuilder") WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        super(buildClient(plainBuilder, loadBalancedBuilder, properties), properties.getAggregateTimeoutMs());
    }

    private static WebClient buildClient(
            WebClient.Builder plainBuilder,
            WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        WebClient.Builder builder = properties.isSystemDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        return builder.baseUrl(resolveBaseUrl(
                properties.isSystemDiscoveryEnabled(),
                properties.getSystemServiceId(),
                properties.getSystemBaseUrl())).build();
    }

    public List<MenuVO> tree(Long appId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/menus/tree")
                .queryParam("appId", appId)
                .build(true)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(MENU_LIST));
    }

    public List<MenuVO> router(Long appId, List<Long> menuIds) {
        String ids = menuIds == null || menuIds.isEmpty()
                ? ""
                : menuIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        UriComponentsBuilder builder = UriComponentsBuilder.fromPath("/internal/v1/menus/router")
                .queryParam("appId", appId);
        if (!ids.isEmpty()) {
            builder.queryParam("menuIds", ids);
        }
        return block(client().get().uri(builder.build(true).toUriString()).retrieve().bodyToMono(MENU_LIST));
    }

    public List<String> permissions(List<Long> menuIds) {
        if (menuIds == null || menuIds.isEmpty()) {
            return List.of();
        }
        String ids = menuIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        String uri = UriComponentsBuilder.fromPath("/internal/v1/menus/permissions")
                .queryParam("menuIds", ids)
                .build(true)
                .toUriString();
        List<String> data = block(client().get().uri(uri).retrieve().bodyToMono(STRING_LIST));
        return data != null ? data : List.of();
    }

    public List<ApiPermissionRuleDTO> apiPermissionRegistry() {
        List<ApiPermissionRuleDTO> data = block(client().get()
                .uri("/internal/v1/api-permissions/registry")
                .retrieve()
                .bodyToMono(API_RULE_LIST));
        return data != null ? data : List.of();
    }

    public MenuVO getMenu(Long id) {
        return block(client().get().uri("/internal/v1/menus/{id}", id).retrieve().bodyToMono(MENU));
    }

    public MenuVO createMenu(Map<String, Object> body) {
        return block(post(body, MENU, "/internal/v1/menus"));
    }

    public MenuVO updateMenu(Long id, Map<String, Object> body) {
        return block(put(body, MENU, "/internal/v1/menus/{id}", id));
    }

    public void deleteMenu(Long id) {
        blockVoid(delete("/internal/v1/menus/{id}", id));
    }

    public static Map<String, Object> menuCreateBody(
            Long tenantId,
            Long appId,
            Long parentId,
            String name,
            Integer type,
            String path,
            String component,
            String permission,
            String icon,
            Integer sort,
            Integer visible) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", tenantId);
        body.put("appId", appId);
        body.put("parentId", parentId);
        body.put("name", name);
        body.put("type", type);
        body.put("path", path);
        body.put("component", component);
        body.put("permission", permission);
        body.put("icon", icon);
        body.put("sort", sort);
        body.put("visible", visible);
        return body;
    }
}
