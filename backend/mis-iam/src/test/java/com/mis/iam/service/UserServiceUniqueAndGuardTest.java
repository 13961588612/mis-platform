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
import com.mis.iam.dto.EmployeeBindingCheck;
import com.mis.iam.dto.UserCreateRequest;
import com.mis.iam.dto.UserUpdateRequest;
import com.mis.iam.support.RbacCacheSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * UserService 新增约束与守卫测试（D4 / D1 / Q1 邮箱贯通）：
 * <ul>
 *   <li>create：手机在「租户+APP」内唯一（USER_PHONE_EXISTS）、员工每 APP 唯一（EMPLOYEE_ALREADY_BOUND）、email 落库；</li>
 *   <li>update：改 APP 守卫（已分配角色禁改）、手机唯一（AndIdNot）、email 同步；</li>
 *   <li>page：searchV3 多 appId（空=不过滤，非空=IN）；</li>
 *   <li>checkEmployeeBinding：绑员工预检（含排除自身 id 变体）。</li>
 * </ul>
 * 纯 Mockito 全路径，无 Spring/DB 基座。
 */
@ExtendWith(MockitoExtension.class)
class UserServiceUniqueAndGuardTest {

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

    // A1) create 手机唯一（非空才校验）
    @Test
    void create_phoneTaken_throwsUserPhoneExists() {
        when(userRepository.existsByTenantIdAndAppIdAndUsername(anyLong(), anyLong(), anyString())).thenReturn(false);
        when(userRepository.existsByTenantIdAndAppIdAndPhone(anyLong(), anyLong(), anyString())).thenReturn(true);

        UserCreateRequest req = new UserCreateRequest(1L, 10L, null, "alice", "pw", "Alice", "13900000001",
                List.of(), List.of(), List.of(), "a@x.com");

        BusinessException ex = assertThrows(BusinessException.class, () -> userService.create(req));
        assertEquals(ResultCode.USER_PHONE_EXISTS.getCode(), ex.getCode());
        verify(userRepository, never()).save(any(SysUser.class));
    }

    // A2) create 手机为空不查唯一，走通 save
    @Test
    void create_phoneBlank_skipsPhoneUniquenessAndSaves() {
        when(userRepository.existsByTenantIdAndAppIdAndUsername(anyLong(), anyLong(), anyString())).thenReturn(false);
        when(passwordEncoder.encode(anyString())).thenReturn("enc");
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        UserCreateRequest req = new UserCreateRequest(1L, 10L, null, "bob", "pw", "Bob", null,
                List.of(), List.of(), List.of(), null);

        assertDoesNotThrow(() -> userService.create(req));
        verify(userRepository).save(any(SysUser.class));
        verify(userRepository, never()).existsByTenantIdAndAppIdAndPhone(anyLong(), anyLong(), anyString());
    }

    // A3) create 员工每 APP 唯一（D1）
    @Test
    void create_employeeBoundInApp_throwsEmployeeAlreadyBound() {
        when(userRepository.existsByTenantIdAndAppIdAndUsername(anyLong(), anyLong(), anyString())).thenReturn(false);
        doNothing().when(orgEmployeeClient).requireEmployee(anyLong(), anyLong());
        when(userRepository.existsByTenantIdAndAppIdAndEmployeeId(anyLong(), anyLong(), anyLong())).thenReturn(true);

        UserCreateRequest req = new UserCreateRequest(1L, 10L, 100L, "carol", "pw", "Carol", null,
                List.of(), List.of(), List.of(), null);

        BusinessException ex = assertThrows(BusinessException.class, () -> userService.create(req));
        assertEquals(ResultCode.EMPLOYEE_ALREADY_BOUND.getCode(), ex.getCode());
    }

    // A4) create email 落库（Q1 裁决）
    @Test
    void create_emailPersistedToSavedUser() {
        when(userRepository.existsByTenantIdAndAppIdAndUsername(anyLong(), anyLong(), anyString())).thenReturn(false);
        when(passwordEncoder.encode(anyString())).thenReturn("enc");
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        UserCreateRequest req = new UserCreateRequest(1L, 10L, null, "dave", "pw", "Dave", null,
                List.of(), List.of(), List.of(), "dave@x.com");

        userService.create(req);
        ArgumentCaptor<SysUser> cap = ArgumentCaptor.forClass(SysUser.class);
        verify(userRepository).save(cap.capture());
        assertEquals("dave@x.com", cap.getValue().getEmail());
    }

    // A5) update 改 APP 守卫：已分配角色禁止，未分配允许
    @Test
    void update_appChangeBlockedWhenRoleAssigned() {
        SysUser u = existingUser(5L, null);
        when(userRepository.findById(5L)).thenReturn(Optional.of(u));
        when(userRoleRepository.existsByUserId(5L)).thenReturn(true);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> userService.update(5L, new UserUpdateRequest("u5", null, null, null, null,
                        null, null, 20L, null)));

        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
        verify(userRepository, never()).save(any(SysUser.class));
    }

    @Test
    void update_appChangeAllowedWhenNoRole() {
        SysUser u = existingUser(5L, null);
        when(userRepository.findById(5L)).thenReturn(Optional.of(u));
        when(userRoleRepository.existsByUserId(5L)).thenReturn(false);
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        userService.update(5L, new UserUpdateRequest("u5", null, null, null, null,
                null, null, 20L, null));

        ArgumentCaptor<SysUser> cap = ArgumentCaptor.forClass(SysUser.class);
        verify(userRepository).save(cap.capture());
        assertEquals(20L, cap.getValue().getAppId());
    }

    // A6) update 手机唯一用 AndIdNot
    @Test
    void update_phoneUnchanged_noConflict_ok() {
        SysUser u = existingUser(5L, null); // 现有手机 13800000005
        when(userRepository.findById(5L)).thenReturn(Optional.of(u));
        // 修复后按自身 id 排除仍不应冲突（当前实现未调用，lenient 避免不必要的 stub 报错）
        lenient().when(userRepository.existsByTenantIdAndAppIdAndPhoneAndIdNot(
                anyLong(), anyLong(), anyString(), anyLong())).thenReturn(false);
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        assertDoesNotThrow(() -> userService.update(5L,
                new UserUpdateRequest("u5", null, null, null, "13800000005", null, null, null, null)));
        verify(userRepository).save(any(SysUser.class));
    }

    @Test
    void update_phoneOccupiedByOtherUser_throwsUserPhoneExists() {
        SysUser u = existingUser(5L, null); // 现有手机 13800000005
        when(userRepository.findById(5L)).thenReturn(Optional.of(u));
        // 该手机被「另一用户」占用（排除自身 id=5 后仍存在）
        lenient().when(userRepository.existsByTenantIdAndAppIdAndPhoneAndIdNot(1L, 10L, "13800000999", 5L))
                .thenReturn(true);

        BusinessException ex = assertThrows(BusinessException.class, () -> userService.update(5L,
                new UserUpdateRequest("u5", null, null, null, "13800000999", null, null, null, null)));

        assertEquals(ResultCode.USER_PHONE_EXISTS.getCode(), ex.getCode());
    }

    // A7) update email 同步（Q1 裁决）
    @Test
    void update_emailSyncedToSavedUser() {
        SysUser u = existingUser(5L, null);
        when(userRepository.findById(5L)).thenReturn(Optional.of(u));
        when(userRepository.save(any(SysUser.class))).thenAnswer(inv -> inv.getArgument(0));

        userService.update(5L, new UserUpdateRequest("u5", null, null, null, null,
                null, null, null, "new@x.com"));

        ArgumentCaptor<SysUser> cap = ArgumentCaptor.forClass(SysUser.class);
        verify(userRepository).save(cap.capture());
        assertEquals("new@x.com", cap.getValue().getEmail());
    }

    // A8) page/searchV3 多 appId（D2）
    @Test
    void page_emptyAppIds_noAppFilter() {
        when(userRepository.searchV3(any(), any(), anyBoolean(), any(), any(), any(), any(), any(), anyBoolean(), any()))
                .thenReturn(Page.empty());

        userService.page(1L, null, null, "", "", "", null, null, 1, 10);

        ArgumentCaptor<Collection<Long>> appIdsCap = ArgumentCaptor.forClass(Collection.class);
        ArgumentCaptor<Boolean> hasAppFilterCap = ArgumentCaptor.forClass(Boolean.class);
        verify(userRepository).searchV3(eq(1L), appIdsCap.capture(), hasAppFilterCap.capture(),
                any(), any(), any(), any(), any(), anyBoolean(), any());
        assertFalse(hasAppFilterCap.getValue());
    }

    @Test
    void page_withAppIds_appliesInFilter() {
        when(userRepository.searchV3(any(), any(), anyBoolean(), any(), any(), any(), any(), any(), anyBoolean(), any()))
                .thenReturn(Page.empty());

        userService.page(1L, List.of(10L, 20L), null, "", "", "", null, null, 1, 10);

        ArgumentCaptor<Collection<Long>> appIdsCap = ArgumentCaptor.forClass(Collection.class);
        ArgumentCaptor<Boolean> hasAppFilterCap = ArgumentCaptor.forClass(Boolean.class);
        verify(userRepository).searchV3(eq(1L), appIdsCap.capture(), hasAppFilterCap.capture(),
                any(), any(), any(), any(), any(), anyBoolean(), any());
        assertTrue(hasAppFilterCap.getValue());
        assertTrue(appIdsCap.getValue().containsAll(List.of(10L, 20L)));
    }

    // A9) checkEmployeeBinding（D1 预检）
    @Test
    void checkEmployeeBinding_bound_returnsTrue() {
        when(userRepository.existsByTenantIdAndAppIdAndEmployeeId(1L, 10L, 100L)).thenReturn(true);
        EmployeeBindingCheck check = userService.checkEmployeeBinding(1L, 10L, 100L, null);
        assertTrue(check.exists());
    }

    @Test
    void checkEmployeeBinding_unbound_returnsFalse() {
        when(userRepository.existsByTenantIdAndAppIdAndEmployeeId(1L, 10L, 200L)).thenReturn(false);
        EmployeeBindingCheck check = userService.checkEmployeeBinding(1L, 10L, 200L, null);
        assertFalse(check.exists());
    }

    @Test
    void checkEmployeeBinding_excludingSelf_bound_returnsTrue() {
        when(userRepository.existsByTenantIdAndAppIdAndEmployeeIdAndIdNot(1L, 10L, 100L, 5L)).thenReturn(true);
        EmployeeBindingCheck check = userService.checkEmployeeBinding(1L, 10L, 100L, 5L);
        assertTrue(check.exists());
    }

    @Test
    void checkEmployeeBinding_nullEmployeeId_returnsFalseWithoutQuery() {
        EmployeeBindingCheck check = userService.checkEmployeeBinding(1L, 10L, null, null);
        assertFalse(check.exists());
        verify(userRepository, never()).existsByTenantIdAndAppIdAndEmployeeId(anyLong(), anyLong(), anyLong());
    }
}
