package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysOrg;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysDeptTypeRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.dto.DeptCreateRequest;
import com.mis.org.dto.DeptUpdateRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * V40 组织穿透守卫：已关联组织（linked_org_id 非空）的部门不可再创建子部门，
 * 也不可作为移动（relocate）的目标父部门 —— 防止绕过前端按钮隐藏的旁路写入。
 */
@ExtendWith(MockitoExtension.class)
class DeptServiceLinkedOrgGuardTest {

    @Mock
    private SysDeptRepository deptRepository;
    @Mock
    private SysDeptTypeRepository deptTypeRepository;
    @Mock
    private SysOrgRepository orgRepository;
    @Mock
    private SysEmployeeRepository employeeRepository;
    @Mock
    private SysPostRepository postRepository;

    private DeptService deptService;

    @BeforeEach
    void setUp() {
        deptService = new DeptService(deptRepository, deptTypeRepository, orgRepository, employeeRepository, postRepository);
    }

    private static SysDept dept(Long id, Long orgId, Long tenantId, Long linkedOrgId) {
        SysDept d = new SysDept();
        d.setId(id);
        d.setOrgId(orgId);
        d.setTenantId(tenantId);
        d.setLinkedOrgId(linkedOrgId);
        return d;
    }

    @Test
    void createRejectsWhenParentHasLinkedOrg() {
        Long tenantId = 1L;
        Long orgId = 10L;
        Long parentId = 20L;

        SysDept parent = dept(parentId, orgId, tenantId, 30L);
        when(orgRepository.findById(orgId)).thenReturn(Optional.of(new SysOrg()));
        when(deptRepository.findById(parentId)).thenReturn(Optional.of(parent));

        DeptCreateRequest request = new DeptCreateRequest(tenantId, orgId, parentId, "子部门", 3L, null, 0, null, 1002L, null);

        BusinessException ex = assertThrows(BusinessException.class, () -> deptService.create(request));
        assertTrue(ex.getMessage().contains("已关联组织的部门不可再创建子部门"));
        verify(deptRepository, never()).save(any());
    }

    @Test
    void updateRelocateRejectsWhenTargetParentHasLinkedOrg() {
        Long tenantId = 1L;
        Long orgId = 10L;
        Long deptId = 21L;
        Long newParentId = 22L;

        SysDept dept = dept(deptId, orgId, tenantId, null);
        dept.setIsRoot(0);
        dept.setCode("00010001");
        dept.setAncestors("0,20");
        dept.setParentId(20L);

        SysDept newParent = dept(newParentId, orgId, tenantId, 30L);

        when(deptRepository.findById(deptId)).thenReturn(Optional.of(dept));
        when(deptRepository.findById(newParentId)).thenReturn(Optional.of(newParent));

        DeptUpdateRequest request = new DeptUpdateRequest("更名", 3L, newParentId, 0, 1, null, null, null, null);

        BusinessException ex = assertThrows(BusinessException.class, () -> deptService.update(deptId, request));
        assertTrue(ex.getMessage().contains("不能将部门移动到已关联组织的部门下"));
        verify(deptRepository, never()).save(dept);
    }
}
