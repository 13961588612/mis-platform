package com.mis.adminbff.client;

import com.mis.adminbff.client.model.ApiPermissionRuleDTO;
import com.mis.adminbff.client.model.MenuVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.adminbff.dto.ApiVO;
import com.mis.adminbff.dto.ModuleApiBindingVO;
import com.mis.adminbff.dto.ModuleVO;
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
    private static final ParameterizedTypeReference<Result<List<Map<String, Object>>>> MAP_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Map<String, Object>>> MAP =
            new ParameterizedTypeReference<>() {};

    private static final ParameterizedTypeReference<Result<List<ModuleVO>>> MODULE_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<ModuleVO>> MODULE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<ApiVO>>> API_TREE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<ApiVO>> API =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<ModuleApiBindingVO>>> BINDING_LIST =
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
        return block(client().get()
                .uri(queryUri("/internal/v1/menus/tree", "appId", appId))
                .retrieve()
                .bodyToMono(MENU_LIST));
    }

    public List<MenuVO> router(Long appId, List<Long> menuIds) {
        String ids = menuIds == null || menuIds.isEmpty()
                ? ""
                : menuIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        return block(client().get()
                .uri(queryUri("/internal/v1/menus/router", "appId", appId, "menuIds", ids))
                .retrieve()
                .bodyToMono(MENU_LIST));
    }

    public List<String> permissions(List<Long> menuIds) {
        if (menuIds == null || menuIds.isEmpty()) {
            return List.of();
        }
        String ids = menuIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        List<String> data = block(client().get()
                .uri(queryUri("/internal/v1/menus/permissions", "menuIds", ids))
                .retrieve()
                .bodyToMono(STRING_LIST));
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

    // -----------------------------------------------------------------------
    // 模块（sys_module）透传
    // -----------------------------------------------------------------------
    public List<ModuleVO> listModules() {
        return block(client().get().uri("/internal/v1/modules").retrieve().bodyToMono(MODULE_LIST));
    }

    public ModuleVO getModule(Long id) {
        return block(client().get().uri("/internal/v1/modules/{id}", id).retrieve().bodyToMono(MODULE));
    }

    public ModuleVO createModule(Map<String, Object> body) {
        return block(post(body, MODULE, "/internal/v1/modules"));
    }

    public ModuleVO updateModule(Long id, Map<String, Object> body) {
        return block(put(body, MODULE, "/internal/v1/modules/{id}", id));
    }

    public void deleteModule(Long id) {
        blockVoid(delete("/internal/v1/modules/{id}", id));
    }

    public List<ApiVO> moduleApiTree(Long moduleId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/modules/{moduleId}/apis")
                .buildAndExpand(moduleId).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(API_TREE));
    }

    public List<ModuleApiBindingVO> moduleBindings(Long moduleId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/modules/{moduleId}/bindings")
                .buildAndExpand(moduleId).toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(BINDING_LIST));
    }

    // -----------------------------------------------------------------------
    // 模块下接口（sys_api）透传
    // -----------------------------------------------------------------------
    public ApiVO createApi(Map<String, Object> body) {
        return block(post(body, API, "/internal/v1/apis"));
    }

    public ApiVO updateApi(Long id, Map<String, Object> body) {
        return block(put(body, API, "/internal/v1/apis/{id}", id));
    }

    public void deleteApi(Long id) {
        blockVoid(delete("/internal/v1/apis/{id}", id));
    }

    public List<Map<String, Object>> listDictTypes(Long tenantId) {
        return block(client().get()
                .uri(queryUri("/internal/v1/dicts/types", "tenantId", tenantId))
                .retrieve()
                .bodyToMono(MAP_LIST));
    }

    public Map<String, Object> createDictType(Map<String, Object> body) {
        return block(post(body, MAP, "/internal/v1/dicts/types"));
    }

    public Map<String, Object> updateDictType(Long id, Map<String, Object> body) {
        return block(put(body, MAP, "/internal/v1/dicts/types/{id}", id));
    }

    public void deleteDictType(Long id) {
        blockVoid(delete("/internal/v1/dicts/types/{id}", id));
    }

    public List<Map<String, Object>> listDictItems(Long typeId) {
        return block(client().get()
                .uri(queryUri("/internal/v1/dicts/items", "typeId", typeId))
                .retrieve()
                .bodyToMono(MAP_LIST));
    }

    public Map<String, Object> createDictItem(Map<String, Object> body) {
        return block(post(body, MAP, "/internal/v1/dicts/items"));
    }

    public Map<String, Object> updateDictItem(Long id, Map<String, Object> body) {
        return block(put(body, MAP, "/internal/v1/dicts/items/{id}", id));
    }

    public void deleteDictItem(Long id) {
        blockVoid(delete("/internal/v1/dicts/items/{id}", id));
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
