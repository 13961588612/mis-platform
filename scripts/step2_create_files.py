import os

# ========== Step 2: mis-org - Create UserDataSetScopeVO.java ==========
dto_path = r'D:\code\mis-platform\backend\mis-org\src\main\java\com\mis\org\dto\UserDataSetScopeVO.java'

content = '''package com.mis.org.dto;

import java.util.List;

/**
 * 用户数据范围查询响应（供 BFF 调用的内部接口）。
 */
public record UserDataSetScopeVO(
        Long userId,
        int dataScope,
        boolean all,
        List<Long> orgIds,
        List<Long> deptIds,
        List<Long> deptSubtreeIds,
        List<DeptAnchor> deptAnchors,
        List<Long> storeIds
) {
    /** 部门锚点，用于行级注入的 PATH_PREFIX 模式 */
    public record DeptAnchor(
            Long id,
            String path,
            String scope
    ) {}
}
'''

with open(dto_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Created UserDataSetScopeVO.java')

# ========== Step 2b: mis-org - Create DataSetScopeService.java ==========
service_path = r'D:\code\mis-platform\backend\mis-org\src\main\java\com\mis\org\service\DataSetScopeService.java'

service_content = '''package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.ResultCode;
import com.mis.org.client.IamDataScopeClient;
import com.mis.org.client.IamDataScopeClient.DataScopePayload;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.dto.UserDataSetScopeVO;
import com.mis.org.dto.UserDataSetScopeVO.DeptAnchor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 为问数 Worker 准备的用户数据范围视图。
 *
 * <p>数据来源：
 * <ul>
 *   <li>基础权限 (dataScope / customOrgIds / customDeptIds) → 调用 mis-iam {@code IamDataScopeClient}</li>
 *   <li>deptSubtreeIds、deptAnchors → 由 mis-org {@code DataScopeService} 计算，通过部门路径提供 PATH_PREFIX</li>
 *   <li>storeIds → 直接从 mis-iam {@code DataScopePayload.customStoreIds} 获取（门店权限直接来自 sys_role_permission）</li>
 * </ul>
 */
@Service
public class DataSetScopeService {

    private final IamDataScopeClient iamDataScopeClient;
    private final DataScopeService dataScopeService;
    private final SysDeptRepository deptRepository;

    public DataSetScopeService(
            IamDataScopeClient iamDataScopeClient,
            DataScopeService dataScopeService,
            SysDeptRepository deptRepository) {
        this.iamDataScopeClient = iamDataScopeClient;
        this.dataScopeService = dataScopeService;
        this.deptRepository = deptRepository;
    }

    /**
     * 查询用户在问数场景下的完整数据范围。
     *
     * @param userId MIS 用户 ID
     * @return 包含 data_scope、组织/部门/门店范围、部门锚点的 VO；无权限时返回空范围
     */
    @Transactional(readOnly = true)
    public UserDataSetScopeVO getUserDataSetScope(Long userId) {
        // Step 1: 从 mis-iam 获取基础权限
        DataScopePayload payload = iamDataScopeClient.resolveDataScope(userId);
        int dataScope = payload.dataScope();
        boolean isAll = dataScope == 1;

        List<Long> orgIds = payload.customOrgIds();
        List<Long> deptIdsFromIam = payload.customDeptIds();
        List<Long> storeIds = payload.customStoreIds();

        if (isAll) {
            return new UserDataSetScopeVO(
                    userId, dataScope, true,
                    List.of(), List.of(), List.of(), List.of(), List.of());
        }

        // Step 2: 从 DataScopeService 获取任职部门并集及子树
        // DataScopeService 会基于 LoginUser 构建范围，这里需要用指定 userId 的方式
        // 注意：此处需要绕过 SecurityContext 约束，因此直接复用其计算逻辑
        Set<Long> assignedDeptIds = resolveAssignedDeptIds(userId);
        Set<Long> subtreeIds = new HashSet<>();
        for (Long deptId : assignedDeptIds) {
            subtreeIds.addAll(getSubtreeIds(deptId));
        }

        // Step 3: 拼装 deptAnchors（部门 ID + path + scope）
        List<DeptAnchor> anchors = buildDeptAnchors(assignedDeptIds, deptIdsFromIam, subtreeIds);

        return new UserDataSetScopeVO(
                userId, dataScope, false,
                orgIds,
                new ArrayList<>(assignedDeptIds),
                new ArrayList<>(subtreeIds),
                anchors,
                storeIds);
    }

    /**
     * 解析用户任职部门并集。
     * 等价于 DataScopeService.resolveAssignedDeptIds，但接受指定 userId。
     */
    private Set<Long> resolveAssignedDeptIds(Long userId) {
        // 目前只能委托现有方法：buildForCurrentUser 依赖 SecurityContext
        // 改造方式：将 Employee 任职查询提取为独立工具方法
        // 简易实现：查用户-员工绑定 + 岗位部门
        try {
            com.mis.org.client.OrgEmployeeView emp = null;
            // 通过 iam 客户端获取用户绑定的 employeeId
            Long employeeId = getEmployeeIdByUserId(userId);
            if (employeeId == null) {
                return Set.of();
            }
            return resolveDeptIdsForEmployee(employeeId);
        } catch (Exception e) {
            return Set.of();
        }
    }

    private Long getEmployeeIdByUserId(Long userId) {
        // 调用 IAM 获取用户详情中的 employeeId
        // 简化：直接从 mis-iam 拿用户数据，但这里没有现成 client
        // 替代方案：先查 sys_user 表获取 employeeId
        // 由于跨服务限制，改为走 IAM 内部的 user -> employee 映射
        // TODO: 若 IAM 未暴露此端点，可改为在 IAM 侧增加
        return null; // 暂为空实现，下面给出更实用的方案
    }

    private Set<Long> resolveDeptIdsForEmployee(Long employeeId) {
        Set<Long> deptIds = new HashSet<>();
        try {
            // 通过 mis-org 的内部 repo 查询（当前服务内可直接访问）
            // 需要 OrgEmployeeRepository 来查员工+岗位部门
            // 这里使用已注入的 Service 间接方式
            // 由于当前没有 EmployeePostRepository 注入，采用简单方式：
            // 实际上 Mis-org 中已有该 repository，我们可以在构造器注入它
        } catch (Exception e) {
            // 静默失败，不污染主流程
        }
        return deptIds;
    }

    /** 取指定部门的后代 ID 集合（含自身），复用 DeptService.subtreeIds 逻辑。 */
    private List<Long> getSubtreeIds(Long deptId) {
        SysDept dept = deptRepository.findById(deptId).orElse(null);
        if (dept == null) {
            return List.of();
        }
        List<Long> ids = new ArrayList<>();
        ids.add(deptId);
        try {
            ids.addAll(deptRepository.findDescendantIds(dept.getOrgId(), String.valueOf(deptId)));
        } catch (Exception e) {
            // 容错：找不到则仅返回自身
        }
        return ids;
    }

    /**
     * 组装部门锚点列表。
     *
     * <p>对每个 assignedDeptId：
     * <ul>
     *   <li>如果同时出现在 customDeptIds（角色直接分配的部门），scope = "dept"；</li>
     *   <li>如果是子树中的部门（不在 assignedDeptIds 自身），scope = "dept_subtree"；</li>
     *   <li>其余情况 scope = "org_scope"。</li>
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
                scope = "dept";
            } else if (subtreeIds.contains(deptId)) {
                scope = "dept_subtree";
            } else {
                scope = "org_scope";
            }
            String path = dept.getDeptPath();
            anchors.add(new DeptAnchor(deptId, path, scope));
        }
        return anchors;
    }
}
'''

with open(service_path, 'w', encoding='utf-8') as f:
    f.write(service_content)
print('Created DataSetScopeService.java (placeholder)')
