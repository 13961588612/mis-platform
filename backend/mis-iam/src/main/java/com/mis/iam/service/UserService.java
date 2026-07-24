package com.mis.iam.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iam.client.OrgEmployeeClient;
import com.mis.iam.config.IamProperties;
import com.mis.iam.domain.entity.SysRole;
import com.mis.iam.domain.entity.SysRolePermission;
import com.mis.iam.domain.entity.SysUser;
import com.mis.iam.domain.entity.SysUserRole;
import com.mis.iam.domain.repository.SysRolePermissionRepository;
import com.mis.iam.domain.repository.SysRoleRepository;
import com.mis.iam.domain.repository.SysUserRepository;
import com.mis.iam.domain.repository.SysUserRoleRepository;
import com.mis.iam.dto.AuthUserVO;
import com.mis.iam.dto.DataScopeVO;
import com.mis.iam.dto.RoleVO;
import com.mis.iam.dto.UserCreateRequest;
import com.mis.iam.dto.UserResetPasswordRequest;
import com.mis.iam.dto.UserRoleAssignRequest;
import com.mis.iam.dto.UserUpdateRequest;
import com.mis.iam.dto.UserVO;
import com.mis.iam.support.IdGenerator;
import com.mis.iam.support.RbacCacheSupport;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.List;

@Service
public class UserService {

    private static final int TYPE_BUILTIN = 1;

    private final SysUserRepository userRepository;
    private final SysRoleRepository roleRepository;
    private final SysUserRoleRepository userRoleRepository;
    private final SysRolePermissionRepository rolePermissionRepository;
    private final PasswordEncoder passwordEncoder;
    private final OrgEmployeeClient orgEmployeeClient;
    private final RbacCacheSupport rbacCacheSupport;
    private final IamProperties iamProperties;
    private final RoleService roleService;

    public UserService(SysUserRepository userRepository,
                       SysRoleRepository roleRepository,
                       SysUserRoleRepository userRoleRepository,
                       SysRolePermissionRepository rolePermissionRepository,
                       PasswordEncoder passwordEncoder,
                       OrgEmployeeClient orgEmployeeClient,
                       RbacCacheSupport rbacCacheSupport,
                       IamProperties iamProperties,
                       RoleService roleService) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.userRoleRepository = userRoleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.passwordEncoder = passwordEncoder;
        this.orgEmployeeClient = orgEmployeeClient;
        this.rbacCacheSupport = rbacCacheSupport;
        this.iamProperties = iamProperties;
        this.roleService = roleService;
    }

    @Transactional(readOnly = true)
    public Page<UserVO> page(Long tenantId, Long appId, Integer status, String username, int page, int size) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(size, 1), 100);
        String usernameFilter = StringUtils.hasText(username) ? username.trim() : null;
        Page<SysUser> result = userRepository.search(
                tenantId, appId, status, usernameFilter,
                PageRequest.of(safePage - 1, safeSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        return result.map(this::toVo);
    }

    @Transactional(readOnly = true)
    public UserVO getById(Long id) {
        return toVo(requireUser(id));
    }

    @Transactional(readOnly = true)
    public AuthUserVO getAuthUser(Long tenantId, Long appId, String username) {
        SysUser user = userRepository.findByTenantIdAndAppIdAndUsername(tenantId, appId, username)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "用户不存在"));
        return toAuthVo(user);
    }

    @Transactional(readOnly = true)
    public AuthUserVO getAuthUserById(Long id) {
        return toAuthVo(requireUser(id));
    }

    /**
     * 多角色 data_scope 取最宽松（ALL=1 最小数字最宽）。
     * 无角色时按 SELF 收敛。CUSTOM 时附带 org/dept 并集。
     */
    @Transactional(readOnly = true)
    public DataScopeVO resolveDataScope(Long userId) {
        requireUser(userId);
        List<SysRole> roles = roleRepository.findRolesByUserId(userId);
        if (roles.isEmpty()) {
            return new DataScopeVO(4);
        }
        int dataScope = roles.stream()
                .map(SysRole::getDataScope)
                .filter(s -> s != null && s >= 1 && s <= 6)
                .min(Integer::compareTo)
                .orElse(4);
        if (dataScope != 5) {
            return new DataScopeVO(dataScope);
        }
        return new DataScopeVO(
                dataScope,
                rolePermissionRepository.findTargetIdsByUserIdAndPermType(
                        userId, SysRolePermission.PermType.org),
                rolePermissionRepository.findTargetIdsByUserIdAndPermType(
                        userId, SysRolePermission.PermType.dept));
    }

    @Transactional(readOnly = true)
    public int resolveMaxDataScope(Long userId) {
        return resolveDataScope(userId).dataScope();
    }

    @Transactional
    public UserVO create(UserCreateRequest request) {
        if (userRepository.existsByTenantIdAndAppIdAndUsername(request.tenantId(), request.appId(), request.username())) {
            throw new BusinessException(ResultCode.USER_EXISTS);
        }
        if (userRepository.existsByEmployeeId(request.employeeId())) {
            throw new BusinessException(ResultCode.EMPLOYEE_ALREADY_BOUND);
        }
        orgEmployeeClient.requireEmployee(request.tenantId(), request.employeeId());

        Instant now = Instant.now();
        SysUser user = new SysUser();
        user.setId(IdGenerator.nextId());
        user.setTenantId(request.tenantId());
        user.setAppId(request.appId());
        user.setEmployeeId(request.employeeId());
        user.setUsername(request.username());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setStatus(1);
        user.setLoginFailCount(0);
        user.setIsTenantAdmin(0);
        user.setMustChangePassword(1);
        user.setPermVersion(1L);
        user.setDeleted(0);
        user.setCreatedAt(now);
        user.setUpdatedAt(now);
        userRepository.save(user);

        if (request.roleIds() != null && !request.roleIds().isEmpty()) {
            replaceRoles(user, request.roleIds(), false);
        }
        return toVo(user);
    }

    @Transactional
    public UserVO update(Long id, UserUpdateRequest request) {
        SysUser user = requireUser(id);
        if (!user.getUsername().equals(request.username())
                && userRepository.existsByTenantIdAndAppIdAndUsername(user.getTenantId(), user.getAppId(), request.username())) {
            throw new BusinessException(ResultCode.USER_EXISTS);
        }
        user.setUsername(request.username());
        if (request.status() != null) {
            applyStatusChange(user, request.status());
        }
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);
        return toVo(user);
    }

    @Transactional
    public UserVO updateStatus(Long id, Integer status, Long operatorUserId) {
        if (status == null || (status != 0 && status != 1)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "status 仅支持 0 或 1");
        }
        SysUser user = requireUser(id);
        assertNotSelf(user.getId(), operatorUserId, "不可禁用自己");
        applyStatusChange(user, status);
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);
        return toVo(user);
    }

    @Transactional
    public void resetPassword(Long id, UserResetPasswordRequest request) {
        SysUser user = requireUser(id);
        String newPwd = request.newPassword() != null && !request.newPassword().isBlank()
                ? request.newPassword()
                : iamProperties.getDefaultPassword();
        user.setPasswordHash(passwordEncoder.encode(newPwd));
        user.setMustChangePassword(1);
        user.setLoginFailCount(0);
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);
    }

    /** 用户自助改密：写入新哈希并清除强制改密标记。 */
    @Transactional
    public void changePassword(Long id, String newPassword) {
        SysUser user = requireUser(id);
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setMustChangePassword(0);
        user.setLoginFailCount(0);
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);
    }

    @Transactional
    public void delete(Long id, Long operatorUserId) {
        SysUser user = requireUser(id);
        assertNotSelf(user.getId(), operatorUserId, "不可删除自己");
        assertNotLastTenantAdmin(user);
        user.setDeleted(1);
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);
        userRoleRepository.deleteByUserId(id);
        rbacCacheSupport.onUserPermissionsChanged(user);
    }

    @Transactional
    public void assignRoles(Long userId, UserRoleAssignRequest request) {
        SysUser user = requireUser(userId);
        replaceRoles(user, request.roleIds() != null ? request.roleIds() : List.of(), true);
    }

    private void replaceRoles(SysUser user, List<Long> roleIds, boolean bumpVersion) {
        List<SysRole> roles = roleIds.stream()
                .map(roleId -> roleRepository.findById(roleId)
                        .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "角色不存在: " + roleId)))
                .toList();
        for (SysRole role : roles) {
            if (!role.getTenantId().equals(user.getTenantId()) || !role.getAppId().equals(user.getAppId())) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "角色不属于该用户所在租户/应用");
            }
        }

        boolean willBeAdmin = roles.stream().anyMatch(r -> r.getType() != null && r.getType() == TYPE_BUILTIN);
        if (isTenantAdmin(user) && !willBeAdmin) {
            assertNotLastTenantAdmin(user);
        }

        userRoleRepository.deleteByUserId(user.getId());
        Instant now = Instant.now();
        for (SysRole role : roles) {
            SysUserRole ur = new SysUserRole();
            ur.setId(IdGenerator.nextId());
            ur.setUserId(user.getId());
            ur.setRoleId(role.getId());
            ur.setCreatedAt(now);
            userRoleRepository.save(ur);
        }

        user.setIsTenantAdmin(willBeAdmin ? 1 : 0);
        if (bumpVersion) {
            long next = (user.getPermVersion() == null ? 1L : user.getPermVersion()) + 1;
            user.setPermVersion(next);
        }
        user.setUpdatedAt(now);
        userRepository.save(user);
        rbacCacheSupport.onUserPermissionsChanged(user);
    }

    private void applyStatusChange(SysUser user, int status) {
        if (status == 0 && isTenantAdmin(user) && user.getStatus() != null && user.getStatus() == 1) {
            assertNotLastTenantAdmin(user);
        }
        user.setStatus(status);
    }

    private void assertNotSelf(Long targetUserId, Long operatorUserId, String message) {
        if (operatorUserId != null && operatorUserId.equals(targetUserId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, message);
        }
    }

    private void assertNotLastTenantAdmin(SysUser user) {
        if (!isTenantAdmin(user)) {
            return;
        }
        long count = userRepository.countActiveTenantAdmins(user.getTenantId(), user.getAppId());
        if (count <= 1) {
            throw new BusinessException(ResultCode.LAST_TENANT_ADMIN);
        }
    }

    private static boolean isTenantAdmin(SysUser user) {
        return user.getIsTenantAdmin() != null && user.getIsTenantAdmin() == 1;
    }

    private SysUser requireUser(Long id) {
        return userRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "用户不存在"));
    }

    private AuthUserVO toAuthVo(SysUser user) {
        List<String> roleCodes = roleRepository.findRoleCodesByUserId(user.getId());
        var employee = orgEmployeeClient.findEmployee(user.getEmployeeId());
        return new AuthUserVO(
                String.valueOf(user.getId()),
                String.valueOf(user.getTenantId()),
                String.valueOf(user.getAppId()),
                String.valueOf(user.getEmployeeId()),
                user.getUsername(),
                user.getPasswordHash(),
                user.getStatus(),
                user.getIsTenantAdmin(),
                user.getMustChangePassword(),
                user.getPermVersion(),
                roleCodes,
                employee.map(com.mis.iam.client.OrgEmployeeView::realName).orElse(null),
                employee.map(com.mis.iam.client.OrgEmployeeView::deptId).orElse(null));
    }

    private UserVO toVo(SysUser user) {
        List<RoleVO> roles = roleRepository.findRolesByUserId(user.getId()).stream()
                .map(roleService::toVo)
                .toList();
        return new UserVO(
                String.valueOf(user.getId()),
                String.valueOf(user.getTenantId()),
                String.valueOf(user.getAppId()),
                String.valueOf(user.getEmployeeId()),
                user.getUsername(),
                user.getAvatarUrl(),
                user.getStatus(),
                user.getIsTenantAdmin(),
                user.getMustChangePassword(),
                null,
                null,
                roles,
                user.getCreatedAt(),
                user.getUpdatedAt());
    }
}
