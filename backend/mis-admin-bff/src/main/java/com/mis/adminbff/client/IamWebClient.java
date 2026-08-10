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

    /**
     * 用户分页查询（{@code username} 为模糊匹配的自由文本）。
     *
     * <h2>为什么必须走 {@code uri(Function)}（DEF-02 修复点，别改回去）</h2>
     * 旧实现是 {@code UriComponentsBuilder...build(true).toUriString()} 再交给
     * {@code uri(String)}。{@code build(true)} 声明「这段字符串<b>已经</b>编码好了」，
     * 于是 {@code HierarchicalUriComponents.verify()} 会逐字符校验合法性，
     * 用户名里的「张」直接触发
     * {@code IllegalArgumentException: Invalid character '张' for QUERY_PARAM} → 接口 500。
     *
     * <p>但把 {@code build(true)} 简单改成 {@code build().encode()} 同样是错的：
     * 那样得到一段<b>已编码</b>字符串，{@code uri(String)} 背后的
     * {@code DefaultUriBuilderFactory}（默认 {@code TEMPLATE_AND_VALUES}）会把它
     * <b>再编码一次</b>，{@code %E5%BC%A0} 变成 {@code %25E5%25BC%25A0}，
     * 下游解码后拿到字面量乱码——这就是 DEF-01（KbWebClient 检索命中 0 行）的原样重演。
     *
     * <p>正确做法与 {@code KbWebClient.buildUri()} 一致：把 URI 的构造交给
     * WebClient 自己的 {@link org.springframework.web.util.UriBuilder}
     * （由携带 baseUrl 的 {@code DefaultUriBuilderFactory} 产出），
     * <b>编码只发生一次，且 baseUrl 的 scheme/host/port 不会丢</b>。
     * 不要「简化」成 {@code uri(URI)} 传相对路径：那条路不经过 uriBuilderFactory，
     * baseUrl 会被静默丢弃，服务发现也会一并失效。
     *
     * <p>{@code username} 以 {@code {username}} 变量占位、真值走
     * {@link org.springframework.web.util.UriBuilder#build(Map)} 展开：这样用户输入里的
     * {@code &}、{@code =} 会被整体编码而不劈开查询串，花括号也不会被误当成模板变量
     * （直接 {@code queryParam("username", "张{伟}")} 会在展开阶段抛
     * {@code IllegalArgumentException}）。
     */
    public PageResult<IamUserVO> pageUsers(
            Long tenantId, Long appId, Integer status, String username, Long deptId, int page, int size) {
        // 与旧实现的 filter(s -> !s.isBlank()) 语义一致：空白用户名视为「没传」
        String keyword = username != null && !username.isBlank() ? username : null;
        return block(client().get()
                .uri(uriBuilder -> {
                    uriBuilder.path("/internal/v1/users")
                            .queryParam("tenantId", tenantId)
                            .queryParam("appId", appId)
                            .queryParam("page", page)
                            .queryParam("size", size)
                            .queryParamIfPresent("status", java.util.Optional.ofNullable(status));
                    if (keyword != null) {
                        uriBuilder.queryParam("username", "{username}");
                    }
                    uriBuilder.queryParamIfPresent("deptId", java.util.Optional.ofNullable(deptId));
                    return keyword != null
                            ? uriBuilder.build(Map.of("username", keyword))
                            : uriBuilder.build();
                })
                .retrieve()
                .bodyToMono(USER_PAGE));
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
        return block(client().get()
                .uri(queryUri("/internal/v1/roles",
                        "tenantId", tenantId, "appId", appId, "page", page, "size", size))
                .retrieve()
                .bodyToMono(ROLE_PAGE));
    }

    public List<IamRoleVO> listEnabledRoles(Long tenantId, Long appId) {
        return block(client().get()
                .uri(queryUri("/internal/v1/roles/enabled",
                        "tenantId", tenantId, "appId", appId))
                .retrieve()
                .bodyToMono(ROLE_LIST));
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
        Map<String, Long> data = block(client().get()
                .uri(queryUri("/internal/v1/stats/users", "tenantId", tenantId, "appId", appId))
                .retrieve()
                .bodyToMono(COUNT));
        return data != null && data.get("count") != null ? data.get("count") : 0L;
    }

    public List<AppVO> listApps(Long tenantId, String kind) {
        List<AppVO> data = block(client().get()
                .uri(queryUri("/internal/v1/apps", "tenantId", tenantId, "kind", kind))
                .retrieve()
                .bodyToMono(APP_LIST));
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
