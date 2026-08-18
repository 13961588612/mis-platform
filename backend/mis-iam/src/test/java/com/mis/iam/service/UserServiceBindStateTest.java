package com.mis.iam.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iam.client.OrgEmployeeClient;
import com.mis.iam.config.IamProperties;
import com.mis.iam.domain.entity.SysUser;
import com.mis.iam.domain.repository.SysRolePermissionRepository;
import com.mis.iam.domain.repository.SysRoleRepository;
import com.mis.iam.domain.repository.SysUserDeptRepository;
import com.mis.iam.domain.repository.SysUserOrgRepository;
import com.mis.iam.domain.repository.SysUserRepository;
import com.mis.iam.domain.repository.SysUserRoleRepository;
import com.mis.iam.dto.UserCreateRequest;
import com.mis.iam.dto.UserUpdateRequest;
import com.mis.iam.dto.UserVO;
import com.mis.iam.support.RbacCacheSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 用户-员工绑定三态（绑定 / 换绑 / 解绑）逻辑测试。
 *
 * <p>说明：项目当前无 Spring/DB 集成测试基座（无 H2/testcontainers），按既有
 * {@code EmployeeServiceListFilterTest} 约定以 Mockito 装配协作者，覆盖 UserService 业务三态。
 * 强制绑定参数（user.force.employee.bind）的校验在 BFF UserAggregateService 中，见
 * {@code UserAggregateServiceBindStateTest}。
 */
@ExtendWith(MockitoExtension.class)
class UserServiceBindStateTest {

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

    @InjectMocks UserService userService;

    private SysUser existingUser(Long id, Long employeeId) {
        SysUser u = new SysUser();
        u.setId(id);
        u.setTenantId(1L);
        u.setAppId(10L);
        u.setUsername("u" + id);
        u.setEmployeeId(employeeId);
        u.setRealName("Name" + id);
        u.setPhone("1380000000" + id);
        u.setStatus(1);
        return u;
    }

    // ---------------------------------------------------------------- create
    @Test
    void create_withEmployee_bindsAndValidates() {
        when(userRepository.existsByTenantIdAndAppIdAndUsername(anyLong(), anyLong(), anyString())).thenReturn(false);
        doNothing().when(orgEmployeeClient).requireEmployee(anyLong(), anyLong());
        when(passwordEncoder.encode(anyString())).thenReturn("enc");
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        UserCreateRequest req = new UserCreateRequest(1L, 10L, 100L, "alice", "pw", "Alice", "139",
                List.of(), List.of(), List.of());
        UserVO vo = userService.create(req);

        assertNotNull(vo);
        verify(orgEmployeeClient).requireEmployee(1L, 100L);
        verify(userRepository).save(argThat(u -> u.getEmployeeId() != null && u.getEmployeeId().equals(100L)));
    }

    @Test
    void create_withoutEmployee_allowsNonEmployee() {
        when(userRepository.existsByTenantIdAndAppIdAndUsername(anyLong(), anyLong(), anyString())).thenReturn(false);
        when(passwordEncoder.encode(anyString())).thenReturn("enc");
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        UserCreateRequest req = new UserCreateRequest(1L, 10L, null, "bob", "pw", "Bob", "139",
                List.of(), List.of(), List.of());
        userService.create(req);

        verify(orgEmployeeClient, never()).requireEmployee(anyLong(), anyLong());
        verify(userRepository).save(argThat(u -> u.getEmployeeId() == null));
    }

    // ---------------------------------------------------------------- update 三态
    @Test
    void update_bindFromUnbound_setsEmployeeAndSyncsNamePhone() {
        SysUser u = existingUser(5L, null);
        when(userRepository.findById(5L)).thenReturn(Optional.of(u));
        doNothing().when(orgEmployeeClient).requireEmployee(anyLong(), anyLong());
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        userService.update(5L, new UserUpdateRequest("u5", null, 200L, "SyncedName", "137", null, null));

        assertEquals(200L, u.getEmployeeId());
        assertEquals("SyncedName", u.getRealName());
        assertEquals("137", u.getPhone());
        verify(orgEmployeeClient).requireEmployee(1L, 200L);
    }

    @Test
    void update_swapEmployee_revalidatesNewEmployee() {
        SysUser u = existingUser(6L, 100L);
        when(userRepository.findById(6L)).thenReturn(Optional.of(u));
        doNothing().when(orgEmployeeClient).requireEmployee(anyLong(), anyLong());
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        userService.update(6L, new UserUpdateRequest("u6", null, 300L, "X", "136", null, null));

        assertEquals(300L, u.getEmployeeId());
        verify(orgEmployeeClient).requireEmployee(1L, 300L);
        verify(orgEmployeeClient, never()).requireEmployee(1L, 100L);
    }

    @Test
    void update_unbind_clearsEmployeeKeepsNamePhone() {
        SysUser u = existingUser(7L, 100L);
        u.setRealName("KeepName");
        u.setPhone("135");
        when(userRepository.findById(7L)).thenReturn(Optional.of(u));
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        userService.update(7L, new UserUpdateRequest("u7", null, null, null, null, null, null));

        assertNull(u.getEmployeeId());
        assertEquals("KeepName", u.getRealName());
        assertEquals("135", u.getPhone());
        verify(orgEmployeeClient, never()).requireEmployee(anyLong(), anyLong());
    }

    @Test
    void update_boundUser_cannotEditNameOrPhone() {
        SysUser u = existingUser(8L, 100L);
        when(userRepository.findById(8L)).thenReturn(Optional.of(u));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> userService.update(8L, new UserUpdateRequest("u8", null, 100L, "Hack", "000", null, null)));

        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
        verify(userRepository, never()).save(any());
    }

    @Test
    void update_unboundUser_canEditNameAndPhone() {
        SysUser u = existingUser(9L, null);
        when(userRepository.findById(9L)).thenReturn(Optional.of(u));
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        userService.update(9L, new UserUpdateRequest("u9", null, null, "NewName", "134", null, null));

        assertEquals("NewName", u.getRealName());
        assertEquals("134", u.getPhone());
    }
}
