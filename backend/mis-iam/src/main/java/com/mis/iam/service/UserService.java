package com.mis.iam.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iam.domain.entity.SysRole;
import com.mis.iam.domain.entity.SysUser;
import com.mis.iam.domain.entity.SysUserRole;
import com.mis.iam.domain.repository.SysRoleRepository;
import com.mis.iam.domain.repository.SysUserRepository;
import com.mis.iam.domain.repository.SysUserRoleRepository;
import com.mis.iam.dto.UserCreateRequest;
import com.mis.iam.dto.UserResetPasswordRequest;
import com.mis.iam.dto.UserRoleAssignRequest;
import com.mis.iam.dto.UserUpdateRequest;
import com.mis.iam.dto.UserVO;
import com.mis.iam.support.IdGenerator;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Service
public class UserService {

    private final SysUserRepository userRepository;
    private final SysRoleRepository roleRepository;
    private final SysUserRoleRepository userRoleRepository;
    private final PasswordEncoder passwordEncoder;

    public UserService(SysUserRepository userRepository,
                       SysRoleRepository roleRepository,
                       SysUserRoleRepository userRoleRepository,
                       PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.userRoleRepository = userRoleRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional(readOnly = true)
    public Page<UserVO> page(Long tenantId, Long appId, int page, int size) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(size, 1), 100);
        Page<SysUser> result = userRepository.findByTenantIdAndAppId(
                tenantId, appId,
                PageRequest.of(safePage - 1, safeSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        return result.map(this::toVo);
    }

    @Transactional(readOnly = true)
    public UserVO getById(Long id) {
        SysUser user = userRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "用户不存在"));
        return toVo(user);
    }

    @Transactional
    public UserVO create(UserCreateRequest request) {
        if (userRepository.existsByTenantIdAndAppIdAndUsername(request.tenantId(), request.appId(), request.username())) {
            throw new BusinessException(ResultCode.USER_EXISTS);
        }

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
        user.setCreatedAt(Instant.now());
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);
        return toVo(user);
    }

    @Transactional
    public UserVO update(Long id, UserUpdateRequest request) {
        SysUser user = userRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "用户不存在"));
        if (!user.getUsername().equals(request.username())
                && userRepository.existsByTenantIdAndAppIdAndUsername(user.getTenantId(), user.getAppId(), request.username())) {
            throw new BusinessException(ResultCode.USER_EXISTS);
        }
        user.setUsername(request.username());
        if (request.status() != null) user.setStatus(request.status());
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);
        return toVo(user);
    }

    @Transactional
    public void resetPassword(Long id, UserResetPasswordRequest request) {
        SysUser user = userRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "用户不存在"));
        String newPwd = request.newPassword() != null && !request.newPassword().isBlank()
                ? request.newPassword()
                : "Mis@123456";
        user.setPasswordHash(passwordEncoder.encode(newPwd));
        user.setMustChangePassword(1);
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);
    }

    @Transactional
    public void delete(Long id) {
        SysUser user = userRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "用户不存在"));
        if (user.getIsTenantAdmin() == 1) {
            throw new BusinessException(ResultCode.FORBIDDEN, "不可删除租户管理员");
        }
        user.setDeleted(1);
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);
    }

    @Transactional
    public void assignRoles(Long userId, UserRoleAssignRequest request) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "用户不存在"));
        // clear existing roles
        List<SysUserRole> existing = userRoleRepository.findByUserId(userId);
        userRoleRepository.deleteAll(existing);
        // assign new roles
        Instant now = Instant.now();
        for (Long roleId : request.roleIds()) {
            SysRole role = roleRepository.findById(roleId)
                    .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "角色不存在: " + roleId));
            SysUserRole ur = new SysUserRole();
            ur.setId(IdGenerator.nextId());
            ur.setUserId(userId);
            ur.setRoleId(roleId);
            ur.setCreatedAt(now);
            userRoleRepository.save(ur);
        }
        // bump perm version
        user.setPermVersion(user.getPermVersion() + 1);
        user.setUpdatedAt(now);
        userRepository.save(user);
    }

    private UserVO toVo(SysUser user) {
        List<String> roles = roleRepository.findRoleCodesByUserId(user.getId());
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
                null, // realName — filled by BFF after calling mis-org
                null, // deptId   — filled by BFF after calling mis-org
                roles,
                user.getCreatedAt(),
                user.getUpdatedAt());
    }
}
