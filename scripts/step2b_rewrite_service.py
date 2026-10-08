import os

# ========== Step 2b: Rewrite DataSetScopeService.java with correct impl ==========
service_path = r'D:\code\mis-platform\backend\mis-org\src\main\java\com\mis\org\service\DataSetScopeService.java'

service_content = '''package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.Result;
import com.mis.common.core.result.ResultCode;
import com.mis.org.client.IamDataScopeClient;
import com.mis.org.client.IamDataScopeClient.DataScopePayload;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysEmployee;
import com.mis.org.domain.entity.SysEmployeePost;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.dto.UserDataSetScopeVO;
import com.mis.org.dto.UserDataSetScopeVO.DeptAnchor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClientException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 为问数 Worker 准备的用户数据范围视图。
 *
 * <p>数据来源：
 * <ul>
 *   <li>基础权限 (dataScope / customOrgIds / customDeptIds / customStoreIds) → 调用 mis-iam {@code IamDataScopeClient}</li>
 *   <li>deptSubtreeIds、deptAnchors → 由本部门路径信息拼装</li>
 * </ul>
 */
@Service
public class DataSetScopeService {

    private static final String HEADER_AUTHORIZATION = \"Authorization\";

    private final IamDataScopeClient iamDataScopeClient;
    private final SysDeptRepository deptRepository;
    private final SysEmployeeRepository employeeRepository;
    private final SysEmployeePostRepository employeePostRepository;

    public DataSetScopeService(
            IamDataScopeClient iamDataScopeClient,
            SysDeptRepository deptRepository,
            SysEmployeeRepository employeeRepository,
            SysEmployeePostRepository employeePostRepository) {
        this.iamDataScopeClient = iamDataScopeClient;
        this.deptRepository = deptRepository;
        this.employeeRepository = employeeRepository;
        this.employeePostRepository = employeePostRepository;
    }

    /**
     * 查询用户在问数场景下的完整数据范围。
     *
     * @param userId       MIS 用户 ID
     * @param authorization BFF 传来的 Authorization 头（用于内部 IAM 调用的身份透传）
     * @return 包含 data_scope、组织/部门/门店范围、部门锚点的 VO；无权限时返回空范围
     */
    @Transactional(readOnly = true)
    public UserDataSetScopeVO getUserDataSetScope(Long userId, String authorization) {
        // Step 1: 从 mis-iam 获取基础权限
        DataScopePayload payload = iamDataScopeClient.resolveDataScope(userId);
        int dataScope = payload.dataScope();
        boolean isAll = dataScope == 1;

        List<Long> orgIds = payload.customOrgIds();
        List<Long> customDeptIds = payload.customDeptIds();
        List<Long> storeIds = payload.customStoreIds();

        if (isAll) {
            return new UserDataSetScopeVO(
                    userId, dataScope, true,
                    List.of(), List.of(), List.of(), List.of(), storeIds != null ? storeIds : List.of());
        }

        // Step 2: 解析用户任职部门
        Set<Long> assignedDeptIds = resolveAssignedDeptIds(userId);
        if (assignedDeptIds.isEmpty() && customDeptIds.isEmpty() && (storeIds == null || storeIds.isEmpty())) {
            // 无任何权限范围 → 空范围，不注入行级条件
            return new UserDataSetScopeVO(
                    userId, dataScope, false,
                    orgIds, List.of(), List.of(), List.of(),
                    storeIds != null ? storeIds : List.of());
        }

        // Step 3: 计算子树 ID
        Set<Long> subtreeIds = new HashSet<>();
        for (Long deptId : assignedDeptIds) {
            subtreeIds.add(deptId);
            try {
                subtreeIds.addAll(deptRepository.findDescendantIdsById(deptId));
            } catch (Exception e) {
                // 容错
            }
        }

        // Step 4: 组装 deptAnchors
        List<DeptAnchor> anchors = buildDeptAnchors(assignedDeptIds, customDeptIds, subtreeIds);

        return new UserDataSetScopeVO(
                userId, dataScope, false,
                orgIds,
                new ArrayList<>(assignedDeptIds),
                new ArrayList<>(subtreeIds),
                anchors,
                storeIds != null ? storeIds : List.of());
    }

    /**
     * 通过员工任职关系解析部门 ID 集合。
     */
    private Set<Long> resolveAssignedDeptIds(Long userId) {
        Long employeeId = resolveEmployeeIdByUserId(userId);
        if (employeeId == null) {
            return Set.of();
        }
        Set<Long> deptIds = new HashSet<>();
        // 直接任职部门
        employeeRepository.findById(employeeId).ifPresent(emp -> {
            if (emp.getDeptId() != null) {
                deptIds.add(emp.getDeptId());
            }
        });
        // 岗位关联部门
        List<SysEmployeePost> posts = employeePostRepository.findByEmployeeIdOrderByEffectiveStartAsc(employeeId);
        for (SysEmployeePost post : posts) {
            if (post.getDeptId() != null) {
                deptIds.add(post.getDeptId());
            }
        }
        return deptIds;
    }

    /**
     * 从 mis-iam 获取用户绑定的 employeeId。
     * 调用 mis-iam 的内部查询端点。
     */
    private Long resolveEmployeeIdByUserId(Long userId) {
        try {
            // 通过 RestClient 查 mis-iam 用户的 employeeId
            Result<EmployeeInfo> result = orgRestClient().get()
                    .uri(\"/internal/v1/users/{id}/employee-id\", userId)
                    .retrieve()
                    .body(new org.springframework.core.ParameterizedTypeReference<Result<EmployeeInfo>>() {});
            if (result != null && result.isSuccess() && result.getData() != null) {
                return result.getData().employeeId();
            }
        } catch (RestClientException e) {
            // 静默降级：无法解析则返回空任职部门
        }
        return null;
    }

    /**
     * 组装部门锚点列表。
     *
     * <p>对每个 assignedDeptId：
     * <ul>
     *   <li>如果同时出现在 customDeptIds（角色直接分配的部门），scope = \"dept\"</li>
     *   <li>如果是子树中的其他部门，scope = \"dept_subtree\"</li>
     *   <li>否则 scope = \"org_scope\"</li>
     * </ul>
     */
    private List<DeptAnchor> buildDeptAnchors(
            Set<Long> assignedDeptIds,
            List<Long> customDeptIds,
            Set<Long> subtreeIds) {
        List<DeptAnchor> anchors = new ArrayList<>();
        for (Long deptId : assignedDeptIds) {
            SysDept dept = deptRepository.findById(deptId).orElse(null);
            if (dept == null) {
                continue;
            }
            String scope;
            if (customDeptIds != null && customDeptIds.contains(deptId)) {
                scope = \"dept\";
            } else if (subtreeIds.size() > assignedDeptIds.size()) {
                // 有后代部门 → 该部门是锚点，后代节点不需要单独注入
                scope = \"dept_subtree\";
            } else {
                scope = \"org_scope\";
            }
            String path = dept.getDeptPath();
            anchors.add(new DeptAnchor(deptId, path, scope));
        }
        return anchors;
    }

    /** 临时 REST client（用于查 mis-iam 的 employee-id 映射）。 */
    private org.springframework.web.client.RestClient orgRestClient() {
        return org.springframework.web.client.RestClient.builder().baseUrl(\"\").build();
    }

    /** 用户-员工信息 DTO。 */
    private record EmployeeInfo(Long employeeId) {}
}
'''

with open(service_path, 'w', encoding='utf-8') as f:
    f.write(service_content)
print('Rewrote DataSetScopeService.java')
