package com.mis.iam.service;

import com.mis.iam.client.OrgEmployeeClient;
import com.mis.iam.config.IamProperties;
import com.mis.iam.domain.entity.SysRole;
import com.mis.iam.domain.entity.SysUser;
import com.mis.iam.domain.repository.SysRolePermissionRepository;
import com.mis.iam.domain.repository.SysRoleRepository;
import com.mis.iam.domain.repository.SysUserDeptRepository;
import com.mis.iam.domain.repository.SysUserOrgRepository;
import com.mis.iam.domain.repository.SysUserRepository;
import com.mis.iam.domain.repository.SysUserRoleRepository;
import com.mis.iam.dto.UserRoleAssignRequest;
import com.mis.iam.dto.UserUpdateRequest;
import com.mis.iam.support.RbacCacheSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * 用户组织/部门/角色全量覆盖：delete 必须先 flush 再 save，避免同事务重插
 * 既有 (user_id, org_id / dept_id / role_id) 撞 uk_user_org / uk_user_dept / uk_user_role。
 *
 * <p>与 mis-org {@code EmployeeServicePostReplaceTest} 同款约定：项目无 Spring/DB 集成
 * 测试基座，用 InOrder 断言「delete → flush → insert」调用顺序，锁定修复机制。</p>
 */
@ExtendWith(MockitoExtension.class)
class UserServiceReplaceFlushTest {

    private static final Long USER_ID = 1787039297652L;
    private static final Long ORG_ID = 1786515974882L;
    private static final Long DEPT_ID = 1786521729236L;
    private static final Long ROLE_ID = 100L;

    @Mock SysUserRepository userRepository;
    @Mock SysRoleRepository roleRepository;
    @Mock SysUserRoleRepository userRoleRepository;
    @Mock SysRolePermissionRepository rolePermissionRepository;
    @Mock SysUserOrgRepository userOrgRepository;
    @Mock SysUserDeptRepository userDeptRepository;
    @Mock PasswordEncoder passwordEncoder;
    @Mock OrgEmployeeClient orgEmployeeClient;
    @Mock RbacCacheSupport rbacCacheSupport;
    @Mock IamProperties iamProperties;
    @Mock RoleService roleService;

    private UserService newService() {
        return new UserService(
                userRepository, roleRepository, userRoleRepository, rolePermissionRepository,
                userOrgRepository, userDeptRepository, passwordEncoder, orgEmployeeClient,
                rbacCacheSupport, iamProperties, roleService);
    }

    private SysUser boundUser() {
        SysUser u = new SysUser();
        u.setId(USER_ID);
        u.setTenantId(1L);
        u.setAppId(10L);
        u.setUsername("it-tester-001");
        u.setEmployeeId(1786958367312L);
        u.setRealName("测试");
        u.setPhone("13900000001");
        u.setStatus(1);
        u.setIsTenantAdmin(0);
        u.setPermVersion(1L);
        return u;
    }

    /**
     * 回归：update 重传既有 org/dept 时，replaceUserOrgs / replaceUserDepts 必须是
     * delete → flush → save。修复前 DELETE 在 flush 阶段晚于 INSERT 执行，
     * 重插同一 (user_id, org_id)/(user_id, dept_id) 会撞唯一索引 → 50000。
     */
    @Test
    void update_reassignExistingOrgDept_flushesDeleteBeforeReinsert() {
        SysUser user = boundUser();
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));
        lenient().when(roleRepository.findRolesByUserId(USER_ID)).thenReturn(List.of());
        lenient().when(userOrgRepository.findByUserId(USER_ID)).thenReturn(List.of());
        lenient().when(userDeptRepository.findByUserId(USER_ID)).thenReturn(List.of());

        UserUpdateRequest request = new UserUpdateRequest(
                "it-tester-001", null, 1786958367312L, null, null,
                List.of(ORG_ID), List.of(DEPT_ID), null, null);

        newService().update(USER_ID, request);

        InOrder orgOrder = inOrder(userOrgRepository);
        orgOrder.verify(userOrgRepository).deleteByUserId(USER_ID);
        orgOrder.verify(userOrgRepository).flush();
        orgOrder.verify(userOrgRepository).save(any());

        InOrder deptOrder = inOrder(userDeptRepository);
        deptOrder.verify(userDeptRepository).deleteByUserId(USER_ID);
        deptOrder.verify(userDeptRepository).flush();
        deptOrder.verify(userDeptRepository).save(any());
    }

    /**
     * 回归：assignRoles 重传既有角色时，replaceRoles 同样必须是 delete → flush → save，
     * 避免重插同一 (user_id, role_id) 撞 uk_user_role。
     */
    @Test
    void assignRoles_reassignExistingRole_flushesDeleteBeforeReinsert() {
        SysUser user = boundUser();
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));
        when(roleRepository.findById(ROLE_ID)).thenReturn(Optional.of(role(ROLE_ID)));

        newService().assignRoles(USER_ID, new UserRoleAssignRequest(List.of(ROLE_ID)));

        InOrder order = inOrder(userRoleRepository);
        order.verify(userRoleRepository).deleteByUserId(USER_ID);
        order.verify(userRoleRepository).flush();
        order.verify(userRoleRepository).save(any());
    }

    private static SysRole role(Long id) {
        SysRole r = new SysRole();
        r.setId(id);
        r.setTenantId(1L);
        r.setAppId(10L);
        r.setType(0);
        r.setStatus(1);
        return r;
    }
}
