package com.mis.adminbff.service;

import com.mis.adminbff.client.OrgWebClient;
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
import com.mis.adminbff.dto.DeptCreateRequest;
import com.mis.adminbff.dto.DeptTypeCreateRequest;
import com.mis.adminbff.dto.DeptTypeUpdateRequest;
import com.mis.adminbff.dto.DeptUpdateRequest;
import com.mis.adminbff.dto.EmployeeCreateRequest;
import com.mis.adminbff.dto.EmployeeUpdateRequest;
import com.mis.adminbff.dto.OrgCreateRequest;
import com.mis.adminbff.dto.OrgUpdateRequest;
import com.mis.adminbff.dto.PostCreateRequest;
import com.mis.adminbff.dto.PostTypeCreateRequest;
import com.mis.adminbff.dto.PostTypeUpdateRequest;
import com.mis.adminbff.dto.PostUpdateRequest;
import com.mis.adminbff.support.RequestContext;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class OrgFacadeService {

    private final OrgWebClient orgWebClient;

    public OrgFacadeService(OrgWebClient orgWebClient) {
        this.orgWebClient = orgWebClient;
    }

    public List<OrgVO> listOrgs() {
        return orgWebClient.listOrgs(RequestContext.requireTenantId());
    }

    public OrgVO getOrg(Long id) {
        return orgWebClient.getOrg(id);
    }

    public OrgVO createOrg(OrgCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", RequestContext.requireTenantId());
        body.put("code", request.code());
        body.put("name", request.name());
        body.put("parentId", request.parentId());
        body.put("sort", request.sort());
        body.put("remark", request.remark());
        body.put("categoryId", request.categoryId());
        return orgWebClient.createOrg(body);
    }

    public OrgVO updateOrg(Long id, OrgUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", request.name());
        body.put("parentId", request.parentId());
        body.put("sort", request.sort());
        body.put("status", request.status());
        body.put("remark", request.remark());
        return orgWebClient.updateOrg(id, body);
    }

    public void deleteOrg(Long id) {
        orgWebClient.deleteOrg(id);
    }

    public List<DeptVO> deptTree(Long orgId) {
        return orgWebClient.deptTree(orgId);
    }

    /** V40 组织穿透：只读 forest（懒加载）。 */
    public List<DeptPierceVO> deptPierce(Long orgId) {
        return orgWebClient.deptPierce(orgId);
    }

    public DeptVO getDept(Long id) {
        return orgWebClient.getDept(id);
    }

    public DeptVO createDept(DeptCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", RequestContext.requireTenantId());
        body.put("orgId", request.orgId());
        body.put("parentId", request.parentId());
        body.put("name", request.name());
        body.put("categoryId", request.categoryId());
        body.put("linkedOrgId", request.linkedOrgId());
        body.put("sort", request.sort());
        body.put("leaderEmployeeId", request.leaderEmployeeId());
        // V54 新增：部门类型 + 编制数
        body.put("deptTypeId", request.deptTypeId());
        body.put("establishmentCount", request.establishmentCount());
        return orgWebClient.createDept(body);
    }

    public DeptVO updateDept(Long id, DeptUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", request.name());
        body.put("categoryId", request.categoryId());
        body.put("parentId", request.parentId());
        body.put("sort", request.sort());
        body.put("status", request.status());
        body.put("leaderEmployeeId", request.leaderEmployeeId());
        // V40 更新语义：PUT 总是下发 linkedOrgId（null=清空）
        body.put("linkedOrgId", request.linkedOrgId());
        // V54 新增：部门类型 + 编制数（NULL=不修改，下游忽略）
        body.put("deptTypeId", request.deptTypeId());
        body.put("establishmentCount", request.establishmentCount());
        return orgWebClient.updateDept(id, body);
    }

    public void deleteDept(Long id) {
        orgWebClient.deleteDept(id);
    }

    public List<EmployeeVO> listEmployees(Long deptId) {
        return orgWebClient.listEmployeesByDept(RequestContext.requireTenantId(), deptId);
    }

    /** 员工全量列表（含禁用；realName/deptId/deptIds/orgIds/status 可选）。 */
    public List<EmployeeVO> listAllEmployees(String realName, Long deptId, Integer status, List<Long> deptIds, List<Long> orgIds) {
        return orgWebClient.listAllEmployees(RequestContext.requireTenantId(), realName, deptId, status, deptIds, orgIds);
    }

    public EmployeeVO getEmployee(Long id) {
        return orgWebClient.getEmployee(id);
    }

    public EmployeeVO createEmployee(EmployeeCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", RequestContext.requireTenantId());
        body.put("deptId", request.deptId());
        body.put("deptIds", request.deptIds());
        body.put("employeeNo", request.employeeNo());
        body.put("realName", request.realName());
        body.put("email", request.email());
        body.put("phone", request.phone());
        body.put("gender", request.gender());
        body.put("title", request.title());
        body.put("hireDate", request.hireDate());
        if (request.posts() != null) {
            body.put("posts", request.posts().stream()
                    .map(p -> {
                        Map<String, Object> post = new HashMap<>();
                        post.put("postId", p.postId());
                        post.put("isPrimary", p.isPrimary());
                        post.put("startDate", p.startDate());
                        return post;
                    })
                    .toList());
        }
        return orgWebClient.createEmployee(body);
    }

    public EmployeeVO updateEmployee(Long id, EmployeeUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("realName", request.realName());
        body.put("email", request.email());
        body.put("phone", request.phone());
        body.put("gender", request.gender());
        body.put("title", request.title());
        body.put("deptId", request.deptId());
        body.put("deptIds", request.deptIds());
        body.put("hireDate", request.hireDate());
        body.put("status", request.status());
        if (request.posts() != null) {
            body.put("posts", request.posts().stream()
                    .map(p -> {
                        Map<String, Object> post = new HashMap<>();
                        post.put("postId", p.postId());
                        post.put("isPrimary", p.isPrimary());
                        post.put("startDate", p.startDate());
                        return post;
                    })
                    .toList());
        }
        return orgWebClient.updateEmployee(id, body);
    }

    public void deleteEmployee(Long id) {
        orgWebClient.deleteEmployee(id);
    }

    // -----------------------------------------------------------------------
    // 岗位
    // -----------------------------------------------------------------------
    public List<PostVO> listPosts(Long deptId, List<Long> deptIds, List<Long> orgIds, Long postTypeId, Integer status) {
        return orgWebClient.listPosts(RequestContext.requireTenantId(), deptId, deptIds, postTypeId, status, orgIds);
    }

    /** 部门岗位编制：透传内部 mis-org /internal/v1/depts/{id}/staffing；tenantId 由 BFF 注入。 */
    public DeptStaffingVO getDeptStaffing(Long id) {
        return orgWebClient.getDeptStaffing(id, RequestContext.requireTenantId());
    }

    public PostVO getPost(Long id) {
        return orgWebClient.getPost(id);
    }

    public PostVO createPost(PostCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", RequestContext.requireTenantId());
        body.put("deptId", request.deptId());
        body.put("postTypeId", request.postTypeId());
        body.put("code", request.code());
        body.put("name", request.name());
        body.put("sort", request.sort());
        body.put("status", request.status());
        body.put("quota", request.quota());
        return orgWebClient.createPost(body);
    }

    public PostVO updatePost(Long id, PostUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("deptId", request.deptId());
        body.put("postTypeId", request.postTypeId());
        body.put("code", request.code());
        body.put("name", request.name());
        body.put("sort", request.sort());
        body.put("status", request.status());
        body.put("quota", request.quota());
        return orgWebClient.updatePost(id, body);
    }

    public void deletePost(Long id) {
        orgWebClient.deletePost(id);
    }

    /** V40 岗位类型全量（含禁用）+ referenceCount；status=1 仅启用。 */
    public List<PostTypeVO> listPostTypes(Integer status) {
        return orgWebClient.listPostTypes(RequestContext.requireTenantId(), status);
    }

    /** V47 岗位类型树：按 parent_id 递归组装。 */
    public List<PostTypeTreeNodeVO> listPostTypeTree(Integer status) {
        return orgWebClient.listPostTypeTree(RequestContext.requireTenantId(), status);
    }

    /** V40 新增岗位类型。 */
    public PostTypeVO createPostType(PostTypeCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", RequestContext.requireTenantId());
        body.put("code", request.code());
        body.put("name", request.name());
        body.put("sort", request.sort());
        body.put("status", request.status());
        body.put("parentId", request.parentId() != null ? request.parentId() : 0);
        body.put("isLeaf", request.isLeaf() != null ? request.isLeaf() : 1);
        return orgWebClient.createPostType(body);
    }

    /** V40 编辑岗位类型（code 不可编辑）。 */
    public PostTypeVO updatePostType(Long id, PostTypeUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", request.name());
        body.put("sort", request.sort());
        body.put("status", request.status());
        if (request.parentId() != null) {
            body.put("parentId", request.parentId());
        }
        if (request.isLeaf() != null) {
            body.put("isLeaf", request.isLeaf());
        }
        return orgWebClient.updatePostType(id, body);
    }

    /** V40 删除岗位类型（被引用硬拦截）。 */
    public void deletePostType(Long id) {
        orgWebClient.deletePostType(id);
    }

    // -----------------------------------------------------------------------
    // 部门类型（V54，透传内部 mis-org /internal/v1/dept-types*）
    // -----------------------------------------------------------------------
    /** V54 部门类型全量（含禁用）+ referenceCount；status=1 仅启用。 */
    public List<DeptTypeVO> listDeptTypes(Integer status) {
        return orgWebClient.listDeptTypes(RequestContext.requireTenantId(), status);
    }

    /** V54 部门类型树：按 parent_id 递归组装。 */
    public List<DeptTypeTreeNodeVO> listDeptTypeTree(Integer status) {
        return orgWebClient.listDeptTypeTree(RequestContext.requireTenantId(), status);
    }

    /** V54 新增部门类型。 */
    public DeptTypeVO createDeptType(DeptTypeCreateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", RequestContext.requireTenantId());
        body.put("code", request.code());
        body.put("name", request.name());
        body.put("sort", request.sort());
        body.put("status", request.status());
        body.put("parentId", request.parentId() != null ? request.parentId() : 0);
        body.put("isLeaf", request.isLeaf() != null ? request.isLeaf() : 1);
        return orgWebClient.createDeptType(body);
    }

    /** V54 编辑部门类型（code 不可编辑）。 */
    public DeptTypeVO updateDeptType(Long id, DeptTypeUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", request.name());
        body.put("sort", request.sort());
        body.put("status", request.status());
        if (request.parentId() != null) {
            body.put("parentId", request.parentId());
        }
        if (request.isLeaf() != null) {
            body.put("isLeaf", request.isLeaf());
        }
        return orgWebClient.updateDeptType(id, body);
    }

    /** V54 删除部门类型（被引用硬拦截）。 */
    public void deleteDeptType(Long id) {
        orgWebClient.deleteDeptType(id);
    }
}
