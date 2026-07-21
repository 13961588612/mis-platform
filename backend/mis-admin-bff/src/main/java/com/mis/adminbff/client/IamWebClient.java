package com.mis.adminbff.client;

import com.mis.adminbff.client.model.AppVO;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.client.model.RoleDataScopeVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class IamWebClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<PageResult<IamUserVO>>> USER_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<IamUserVO>> USER =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PageResult<IamRoleVO>>> ROLE_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<IamRoleVO>>> ROLE_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<IamRoleVO>> ROLE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Void>> VOID =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<Long>>> LONG_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<UserPermissionsDTO>> USER_PERMISSIONS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<RoleDataScopeVO>> ROLE_DATA_SCOPE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Map<String, Long>>> COUNT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<AppVO>>> APP_LIST =
            new ParameterizedTypeReference<>() {};

    public IamWebClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            @Qualifier("loadBalancedWebClientBuilder") WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        super(buildClient(plainBuilder, loadBalancedBuilder, properties), properties.getAggregateTimeoutMs());
    }

    private static WebClient buildClient(
            WebClient.Builder plainBuilder,
            WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        WebClient.Builder builder = properties.isIamDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        return builder.baseUrl(resolveBaseUrl(
                properties.isIamDiscoveryEnabled(),
                properties.getIamServiceId(),
                properties.getIamBaseUrl())).build();
    }

    public PageResult<IamUserVO> pageUsers(Long tenantId, Long appId, Integer status, String username, int page, int size) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/users")
                .queryParam("tenantId", tenantId)
                .queryParam("appId", appId)
                .queryParam("page", page)
                .queryParam("size", size)
                .queryParamIfPresent("status", java.util.Optional.ofNullable(status))
                .queryParamIfPresent("username", java.util.Optional.ofNullable(username).filter(s -> !s.isBlank()))
                .build(true)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(USER_PAGE));
    }

    public IamUserVO getUser(Long id) {
        return block(client().get().uri("/internal/v1/users/{id}", id).retrieve().bodyToMono(USER));
    }

    public IamUserVO createUser(Map<String, Object> body) {
        return block(post(body, USER, "/internal/v1/users"));
    }

    public IamUserVO updateUser(Long id, Map<String, Object> body) {
        return block(put(body, USER, "/internal/v1/users/{id}", id));
    }

    public IamUserVO updateStatus(Long id, Integer status, Long operatorUserId) {
        return block(put(Map.of("status", status), USER, operatorHeaders(operatorUserId),
                "/internal/v1/users/{id}/status", id));
    }

    public void resetPassword(Long id) {
        blockVoid(put(Map.of(), VOID, "/internal/v1/users/{id}/reset-password", id));
    }

    public void deleteUser(Long id, Long operatorUserId) {
        blockVoid(delete(operatorHeaders(operatorUserId), "/internal/v1/users/{id}", id));
    }

    public void assignRoles(Long id, List<Long> roleIds) {
        blockVoid(put(Map.of("roleIds", roleIds), VOID, "/internal/v1/users/{id}/roles", id));
    }

    public PageResult<IamRoleVO> pageRoles(Long tenantId, Long appId, int page, int size) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/roles")
                .queryParam("tenantId", tenantId)
                .queryParam("appId", appId)
                .queryParam("page", page)
                .queryParam("size", size)
                .build(true)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(ROLE_PAGE));
    }

    public List<IamRoleVO> listEnabledRoles(Long tenantId, Long appId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/roles/enabled")
                .queryParam("tenantId", tenantId)
                .queryParam("appId", appId)
                .build(true)
                .toUriString();
        return block(client().get().uri(uri).retrieve().bodyToMono(ROLE_LIST));
    }

    public IamRoleVO getRole(Long id) {
        return block(client().get().uri("/internal/v1/roles/{id}", id).retrieve().bodyToMono(ROLE));
    }

    public IamRoleVO createRole(Map<String, Object> body) {
        return block(post(body, ROLE, "/internal/v1/roles"));
    }

    public IamRoleVO updateRole(Long id, Map<String, Object> body) {
        return block(put(body, ROLE, "/internal/v1/roles/{id}", id));
    }

    public void deleteRole(Long id) {
        blockVoid(delete("/internal/v1/roles/{id}", id));
    }

    public List<Long> listRoleMenus(Long roleId) {
        List<Long> data = block(client().get()
                .uri("/internal/v1/roles/{id}/menus", roleId)
                .retrieve()
                .bodyToMono(LONG_LIST));
        return data != null ? data : List.of();
    }

    public void assignRoleMenus(Long roleId, List<Long> menuIds) {
        blockVoid(put(Map.of("menuIds", menuIds != null ? menuIds : List.of()), VOID,
                "/internal/v1/roles/{id}/menus", roleId));
    }

    public RoleDataScopeVO getRoleDataScope(Long roleId) {
        return block(client().get()
                .uri("/internal/v1/roles/{id}/data-scope", roleId)
                .retrieve()
                .bodyToMono(ROLE_DATA_SCOPE));
    }

    public RoleDataScopeVO assignRoleDataScope(Long roleId, Integer dataScope, List<Long> orgIds, List<Long> deptIds) {
        Map<String, Object> body = new HashMap<>();
        body.put("dataScope", dataScope);
        body.put("orgIds", orgIds != null ? orgIds : List.of());
        body.put("deptIds", deptIds != null ? deptIds : List.of());
        return block(put(body, ROLE_DATA_SCOPE, "/internal/v1/roles/{id}/data-scope", roleId));
    }

    public long userCount(Long tenantId, Long appId) {
        String uri = UriComponentsBuilder.fromPath("/internal/v1/stats/users")
                .queryParam("tenantId", tenantId)
                .queryParam("appId", appId)
                .build(true)
                .toUriString();
        Map<String, Long> data = block(client().get().uri(uri).retrieve().bodyToMono(COUNT));
        return data != null && data.get("count") != null ? data.get("count") : 0L;
    }

    public List<AppVO> listApps(Long tenantId, String kind) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromPath("/internal/v1/apps")
                .queryParam("tenantId", tenantId);
        if (kind != null && !kind.isBlank()) {
            builder.queryParam("kind", kind);
        }
        List<AppVO> data = block(client().get().uri(builder.build(true).toUriString()).retrieve().bodyToMono(APP_LIST));
        return data != null ? data : List.of();
    }

    public List<Long> listUserMenuIds(Long userId) {
        List<Long> data = block(client().get()
                .uri("/internal/v1/users/{id}/menu-ids", userId)
                .retrieve()
                .bodyToMono(LONG_LIST));
        return data != null ? data : List.of();
    }

    /** 回源加载并写入 Redis permissions。 */
    public List<String> loadPermissions(Long userId) {
        UserPermissionsDTO data = block(client().get()
                .uri("/internal/v1/permissions/{userId}", userId)
                .retrieve()
                .bodyToMono(USER_PERMISSIONS));
        return data != null && data.permissions() != null ? data.permissions() : List.of();
    }

    public record UserPermissionsDTO(List<String> permissions, Long permVersion) {
    }

    public static Map<String, Object> userCreateBody(
            Long tenantId, Long appId, Long employeeId, String username, String password, List<Long> roleIds) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", tenantId);
        body.put("appId", appId);
        body.put("employeeId", employeeId);
        body.put("username", username);
        body.put("password", password);
        body.put("roleIds", roleIds);
        return body;
    }
}
