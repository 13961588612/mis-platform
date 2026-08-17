package com.mis.adminbff.client;

import com.mis.adminbff.client.model.DeptPierceVO;
import com.mis.adminbff.client.model.DeptStaffingVO;
import com.mis.adminbff.client.model.DeptTypeTreeNodeVO;
import com.mis.adminbff.client.model.DeptTypeVO;
import com.mis.adminbff.client.model.DeptVO;
import com.mis.adminbff.client.model.EmployeeVO;
import com.mis.adminbff.client.model.OrgVO;
import com.mis.adminbff.client.model.PostTypeTreeNodeVO;
import com.mis.adminbff.client.model.PostTypeVO;
import com.mis.adminbff.client.model.PostVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.common.core.result.Result;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Component
public class OrgWebClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<List<OrgVO>>> ORG_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<OrgVO>> ORG =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Map<Long, String>>> NAME_MAP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<DeptVO>>> DEPT_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<DeptPierceVO>>> DEPT_PIERCE_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<DeptVO>> DEPT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PostTypeVO>> POST_TYPE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<EmployeeVO>>> EMP_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<EmployeeVO>> EMP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<PostVO>>> POST_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PostVO>> POST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<PostTypeVO>>> POST_TYPE_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<PostTypeTreeNodeVO>>> POST_TYPE_TREE_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<DeptTypeVO>>> DEPT_TYPE_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<DeptTypeTreeNodeVO>>> DEPT_TYPE_TREE_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<DeptTypeVO>> DEPT_TYPE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Void>> VOID =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Map<String, Long>>> COUNT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<DeptStaffingVO>> DEPT_STAFFING =
            new ParameterizedTypeReference<>() {};

    public OrgWebClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            @Qualifier("loadBalancedWebClientBuilder") WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        super(buildClient(plainBuilder, loadBalancedBuilder, properties), properties.getAggregateTimeoutMs());
    }

    private static WebClient buildClient(
            WebClient.Builder plainBuilder,
            WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        WebClient.Builder builder = properties.isOrgDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        return builder.baseUrl(resolveBaseUrl(
                properties.isOrgDiscoveryEnabled(),
                properties.getOrgServiceId(),
                properties.getOrgBaseUrl())).build();
    }

    public List<OrgVO> listOrgs(Long tenantId) {
        return block(client().get()
                .uri(queryUri("/internal/v1/orgs", "tenantId", tenantId))
                .retrieve()
                .bodyToMono(ORG_LIST));
    }

    public long orgCount(Long tenantId) {
        Map<String, Long> data = block(client().get()
                .uri(queryUri("/internal/v1/stats/orgs", "tenantId", tenantId))
                .retrieve()
                .bodyToMono(COUNT));
        return data != null && data.get("count") != null ? data.get("count") : 0L;
    }

    public Map<Long, String> orgNames(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        String idsParam = ids.stream().map(String::valueOf).collect(Collectors.joining(","));
        Map<Long, String> data = block(client().get()
                .uri(queryUri("/internal/v1/orgs/names", "ids", idsParam))
                .retrieve()
                .bodyToMono(NAME_MAP));
        return data != null ? data : Map.of();
    }

    public OrgVO getOrg(Long id) {
        return block(client().get().uri("/internal/v1/orgs/{id}", id).retrieve().bodyToMono(ORG));
    }

    public OrgVO createOrg(Map<String, Object> body) {
        return block(post(body, ORG, "/internal/v1/orgs"));
    }

    public OrgVO updateOrg(Long id, Map<String, Object> body) {
        return block(put(body, ORG, "/internal/v1/orgs/{id}", id));
    }

    public void deleteOrg(Long id) {
        blockVoid(delete("/internal/v1/orgs/{id}", id));
    }

    public List<DeptVO> deptTree(Long orgId) {
        return block(client().get()
                .uri(queryUri("/internal/v1/depts/tree", "orgId", orgId))
                .retrieve()
                .bodyToMono(DEPT_LIST));
    }

    /** V40 组织穿透：只读 forest（懒加载，每层一次请求）。 */
    public List<DeptPierceVO> deptPierce(Long orgId) {
        return block(client().get()
                .uri(queryUri("/internal/v1/depts/pierce", "orgId", orgId))
                .retrieve()
                .bodyToMono(DEPT_PIERCE_LIST));
    }

    public DeptVO getDept(Long id) {
        return block(client().get().uri("/internal/v1/depts/{id}", id).retrieve().bodyToMono(DEPT));
    }

    public Mono<Result<DeptVO>> getDeptMono(Long id) {
        return client().get().uri("/internal/v1/depts/{id}", id).retrieve().bodyToMono(DEPT);
    }

    public DeptVO createDept(Map<String, Object> body) {
        return block(post(body, DEPT, "/internal/v1/depts"));
    }

    public DeptVO updateDept(Long id, Map<String, Object> body) {
        return block(put(body, DEPT, "/internal/v1/depts/{id}", id));
    }

    public void deleteDept(Long id) {
        blockVoid(delete("/internal/v1/depts/{id}", id));
    }

    public List<EmployeeVO> listEmployeesByDept(Long tenantId, Long deptId) {
        return block(client().get()
                .uri(queryUri("/internal/v1/employees", "tenantId", tenantId, "deptId", deptId))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(EMP_LIST));
    }

    /** 员工全量列表（含禁用；realName 模糊；deptId/deptIds/orgIds/status 可选）。 */
    public List<EmployeeVO> listAllEmployees(Long tenantId, String realName, Long deptId, Integer status,
                                             List<Long> deptIds, List<Long> orgIds) {
        String deptIdsParam = (deptIds == null || deptIds.isEmpty()) ? null : deptIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        String orgIdsParam = (orgIds == null || orgIds.isEmpty()) ? null : orgIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        return block(client().get()
                .uri(queryUri("/internal/v1/employees/all",
                        "tenantId", tenantId, "realName", realName, "deptId", deptId,
                        "deptIds", deptIdsParam, "orgIds", orgIdsParam, "status", status))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(EMP_LIST));
    }

    // -----------------------------------------------------------------------
    // 岗位（mis-org /internal/v1/posts* + /internal/v1/post-types）
    // -----------------------------------------------------------------------
    public List<PostVO> listPosts(Long tenantId, Long deptId, List<Long> deptIds, Long postTypeId, Integer status, List<Long> orgIds) {
        String deptIdsParam = (deptIds == null || deptIds.isEmpty()) ? null : deptIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        String orgIdsParam = (orgIds == null || orgIds.isEmpty()) ? null : orgIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        return block(client().get()
                .uri(queryUri("/internal/v1/posts",
                        "tenantId", tenantId, "deptId", deptId, "deptIds", deptIdsParam, "orgIds", orgIdsParam, "postTypeId", postTypeId, "status", status))
                .retrieve()
                .bodyToMono(POST_LIST));
    }

    /** 部门岗位编制：透传内部 mis-org /internal/v1/depts/{id}/staffing（tenantId 注入）。 */
    public DeptStaffingVO getDeptStaffing(Long id, Long tenantId) {
        return block(client().get()
                .uri(queryUri("/internal/v1/depts/" + id + "/staffing", "tenantId", tenantId))
                .retrieve()
                .bodyToMono(DEPT_STAFFING));
    }

    public PostVO getPost(Long id) {
        return block(client().get().uri("/internal/v1/posts/{id}", id).retrieve().bodyToMono(POST));
    }

    public PostVO createPost(Map<String, Object> body) {
        return block(post(body, POST, "/internal/v1/posts"));
    }

    public PostVO updatePost(Long id, Map<String, Object> body) {
        return block(put(body, POST, "/internal/v1/posts/{id}", id));
    }

    public void deletePost(Long id) {
        blockVoid(delete("/internal/v1/posts/{id}", id));
    }

    /** V40 岗位类型列表：status 可选（null=全量含禁用，1=仅启用）。 */
    public List<PostTypeVO> listPostTypes(Long tenantId, Integer status) {
        return block(client().get()
                .uri(queryUri("/internal/v1/post-types", "tenantId", tenantId, "status", status))
                .retrieve()
                .bodyToMono(POST_TYPE_LIST));
    }

    /** V47 岗位类型树：按 parent_id 递归组装（顶层 parentId=0）；status 可选。 */
    public List<PostTypeTreeNodeVO> listPostTypeTree(Long tenantId, Integer status) {
        return block(client().get()
                .uri(queryUri("/internal/v1/post-types/tree", "tenantId", tenantId, "status", status))
                .retrieve()
                .bodyToMono(POST_TYPE_TREE_LIST));
    }

    /** V40 新增岗位类型。 */
    public PostTypeVO createPostType(Map<String, Object> body) {
        return block(post(body, POST_TYPE, "/internal/v1/post-types"));
    }

    /** V40 编辑岗位类型。 */
    public PostTypeVO updatePostType(Long id, Map<String, Object> body) {
        return block(put(body, POST_TYPE, "/internal/v1/post-types/{id}", id));
    }

    /** V40 删除岗位类型（被引用硬拦截）。 */
    public void deletePostType(Long id) {
        blockVoid(delete("/internal/v1/post-types/{id}", id));
    }

    // -----------------------------------------------------------------------
    // 部门类型（V54，mis-org /internal/v1/dept-types*）
    // -----------------------------------------------------------------------
    /** V54 部门类型列表：status 可选（null=全量含禁用，1=仅启用）。 */
    public List<DeptTypeVO> listDeptTypes(Long tenantId, Integer status) {
        return block(client().get()
                .uri(queryUri("/internal/v1/dept-types", "tenantId", tenantId, "status", status))
                .retrieve()
                .bodyToMono(DEPT_TYPE_LIST));
    }

    /** V54 部门类型树：按 parent_id 递归组装（顶层 parentId=0）；status 可选。 */
    public List<DeptTypeTreeNodeVO> listDeptTypeTree(Long tenantId, Integer status) {
        return block(client().get()
                .uri(queryUri("/internal/v1/dept-types/tree", "tenantId", tenantId, "status", status))
                .retrieve()
                .bodyToMono(DEPT_TYPE_TREE_LIST));
    }

    /** V54 新增部门类型。 */
    public DeptTypeVO createDeptType(Map<String, Object> body) {
        return block(post(body, DEPT_TYPE, "/internal/v1/dept-types"));
    }

    /** V54 编辑部门类型。 */
    public DeptTypeVO updateDeptType(Long id, Map<String, Object> body) {
        return block(put(body, DEPT_TYPE, "/internal/v1/dept-types/{id}", id));
    }

    /** V54 删除部门类型（被引用硬拦截）。 */
    public void deleteDeptType(Long id) {
        blockVoid(delete("/internal/v1/dept-types/{id}", id));
    }

    public Map<Long, String> employeeNames(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        String idsParam = ids.stream().map(String::valueOf).collect(Collectors.joining(","));
        Map<Long, String> data = block(client().get()
                .uri(queryUri("/internal/v1/employees/names", "ids", idsParam))
                .retrieve()
                .bodyToMono(NAME_MAP));
        return data != null ? data : Map.of();
    }

    public EmployeeVO getEmployee(Long id) {
        return block(client().get().uri("/internal/v1/employees/{id}", id).retrieve().bodyToMono(EMP));
    }

    public Mono<Result<EmployeeVO>> getEmployeeMono(Long id) {
        return client().get().uri("/internal/v1/employees/{id}", id).retrieve().bodyToMono(EMP);
    }

    public EmployeeVO createEmployee(Map<String, Object> body) {
        return block(post(body, EMP, "/internal/v1/employees"));
    }

    public EmployeeVO updateEmployee(Long id, Map<String, Object> body) {
        return block(put(body, EMP, "/internal/v1/employees/{id}", id));
    }

    public void deleteEmployee(Long id) {
        blockVoid(delete("/internal/v1/employees/{id}", id));
    }

    public static Map<String, Object> employeeCreateBody(
            Long tenantId, Long deptId, String employeeNo, String realName, String email, String phone) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", tenantId);
        body.put("deptId", deptId);
        body.put("employeeNo", employeeNo);
        body.put("realName", realName);
        body.put("email", email);
        body.put("phone", phone);
        return body;
    }
}
