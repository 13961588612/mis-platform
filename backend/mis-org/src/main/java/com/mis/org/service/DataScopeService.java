package com.mis.org.service;

import com.mis.common.jpa.datascope.DataScopeSpecification;
import com.mis.common.jpa.datascope.DataScopeSpecification.DataScopeContext;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.org.client.IamDataScopeClient;
import com.mis.org.config.OrgProperties;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysEmployee;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 构建 {@link DataScopeContext}：角色范围（mis-iam）+ 任职部门并集（ADR-014）。
 */
@Service
public class DataScopeService {

    private final IamDataScopeClient iamDataScopeClient;
    private final SysEmployeeRepository employeeRepository;
    private final SysEmployeePostRepository employeePostRepository;
    private final SysDeptRepository deptRepository;
    private final DeptService deptService;
    private final OrgProperties orgProperties;

    public DataScopeService(
            IamDataScopeClient iamDataScopeClient,
            SysEmployeeRepository employeeRepository,
            SysEmployeePostRepository employeePostRepository,
            SysDeptRepository deptRepository,
            DeptService deptService,
            OrgProperties orgProperties) {
        this.iamDataScopeClient = iamDataScopeClient;
        this.employeeRepository = employeeRepository;
        this.employeePostRepository = employeePostRepository;
        this.deptRepository = deptRepository;
        this.deptService = deptService;
        this.orgProperties = orgProperties;
    }

    /**
     * 无登录上下文且允许匿名跳过 → ALL；否则按当前用户构建。
     */
    @Transactional(readOnly = true)
    public DataScopeContext buildForCurrentUser() {
        Optional<LoginUser> optional = SecurityContextHolder.getOptional();
        if (optional.isEmpty() || optional.get().getUserId() == null) {
            if (orgProperties.isDataScopeSkipWhenAnonymous()) {
                return allContext(null);
            }
            return denyAllContext(null);
        }
        return buildForUser(optional.get());
    }

    @Transactional(readOnly = true)
    public DataScopeContext buildForUser(LoginUser loginUser) {
        Long userId = loginUser.getUserId();
        IamDataScopeClient.DataScopePayload payload = iamDataScopeClient.resolveDataScope(userId);
        int dataScope = payload.dataScope();
        if (dataScope == DataScopeSpecification.SCOPE_ALL) {
            return allContext(userId);
        }

        Long employeeId = loginUser.getEmployeeId();
        Set<Long> assignedDeptIds = resolveAssignedDeptIds(employeeId);
        Set<Long> assignedOrgIds = resolveOrgIds(assignedDeptIds);
        Set<Long> subtreeIds = new HashSet<>();
        for (Long deptId : assignedDeptIds) {
            subtreeIds.addAll(deptService.subtreeIds(deptId));
        }
        Set<Long> deptIdsInOrgs = resolveDeptIdsInOrgs(assignedOrgIds);

        Set<Long> customOrgIds = new HashSet<>(payload.customOrgIds());
        Set<Long> customDeptIds = new HashSet<>(payload.customDeptIds());
        Set<Long> deptIdsForCustomOrgs = dataScope == DataScopeSpecification.SCOPE_CUSTOM
                ? resolveDeptIdsInOrgs(customOrgIds)
                : Set.of();

        return new DataScopeContext(
                userId,
                dataScope,
                assignedDeptIds,
                assignedOrgIds,
                subtreeIds,
                deptIdsInOrgs,
                customDeptIds,
                customOrgIds,
                deptIdsForCustomOrgs);
    }

    private Set<Long> resolveAssignedDeptIds(Long employeeId) {
        Set<Long> deptIds = new HashSet<>();
        if (employeeId == null) {
            return deptIds;
        }
        deptIds.addAll(employeePostRepository.findActivePostDeptIds(employeeId));
        employeeRepository.findById(employeeId).map(SysEmployee::getDeptId).ifPresent(deptIds::add);
        return deptIds;
    }

    private Set<Long> resolveOrgIds(Collection<Long> deptIds) {
        Set<Long> orgIds = new HashSet<>();
        for (Long deptId : deptIds) {
            deptRepository.findById(deptId).map(SysDept::getOrgId).ifPresent(orgIds::add);
        }
        return orgIds;
    }

    private Set<Long> resolveDeptIdsInOrgs(Collection<Long> orgIds) {
        Set<Long> deptIds = new HashSet<>();
        for (Long orgId : orgIds) {
            deptRepository.findByOrgId(orgId).stream().map(SysDept::getId).forEach(deptIds::add);
        }
        return deptIds;
    }

    private static DataScopeContext allContext(Long userId) {
        return new DataScopeContext(
                userId, DataScopeSpecification.SCOPE_ALL,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
    }

    private static DataScopeContext denyAllContext(Long userId) {
        return new DataScopeContext(
                userId, DataScopeSpecification.SCOPE_DEPT,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
    }
}
