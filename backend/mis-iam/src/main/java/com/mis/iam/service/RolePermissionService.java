package com.mis.iam.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iam.domain.entity.SysRole;
import com.mis.iam.domain.entity.SysRolePermission;
import com.mis.iam.domain.entity.SysRolePermission.PermType;
import com.mis.iam.domain.repository.SysRolePermissionRepository;
import com.mis.iam.domain.repository.SysRoleRepository;
import com.mis.iam.domain.repository.SysUserRepository;
import com.mis.iam.dto.RoleDataScopeRequest;
import com.mis.iam.dto.RoleDataScopeVO;
import com.mis.iam.dto.RoleMenuAssignRequest;
import com.mis.iam.support.IdGenerator;
import com.mis.iam.support.RbacCacheSupport;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;

import java.time.Instant;
import java.util.List;

@Service
public class RolePermissionService {

    private final SysRoleRepository roleRepository;
    private final SysRolePermissionRepository rolePermissionRepository;
    private final SysUserRepository userRepository;
    private final RbacCacheSupport rbacCacheSupport;

    public RolePermissionService(
            SysRoleRepository roleRepository,
            SysRolePermissionRepository rolePermissionRepository,
            SysUserRepository userRepository,
            RbacCacheSupport rbacCacheSupport) {
        this.roleRepository = roleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.userRepository = userRepository;
        this.rbacCacheSupport = rbacCacheSupport;
    }

    @Transactional(readOnly = true)
    public List<Long> listMenuIds(Long roleId) {
        requireRole(roleId);
        return rolePermissionRepository.findByRoleIdAndPermType(roleId, PermType.menu).stream()
                .map(SysRolePermission::getTargetId)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<Long> listMenuIdsByUser(Long userId) {
        return rolePermissionRepository.findTargetIdsByUserIdAndPermType(userId, PermType.menu);
    }

    @Transactional
    public void assignMenus(Long roleId, RoleMenuAssignRequest request) {
        requireRole(roleId);
        rolePermissionRepository.deleteByRoleIdAndPermType(roleId, PermType.menu);
        Instant now = Instant.now();
        List<Long> menuIds = request.menuIds() != null ? request.menuIds() : List.of();
        for (Long menuId : menuIds) {
            SysRolePermission rp = new SysRolePermission();
            rp.setId(IdGenerator.nextId());
            rp.setRoleId(roleId);
            rp.setPermType(PermType.menu);
            rp.setTargetId(menuId);
            rp.setCreatedAt(now);
            rolePermissionRepository.save(rp);
        }
        bumpUsersOfRole(roleId);
    }

    @Transactional(readOnly = true)
    public RoleDataScopeVO getDataScope(Long roleId) {
        SysRole role = requireRole(roleId);
        List<Long> orgIds = rolePermissionRepository.findByRoleIdAndPermType(roleId, PermType.org).stream()
                .map(SysRolePermission::getTargetId)
                .toList();
        List<Long> deptIds = rolePermissionRepository.findByRoleIdAndPermType(roleId, PermType.dept).stream()
                .map(SysRolePermission::getTargetId)
                .toList();
        return new RoleDataScopeVO(role.getDataScope(), orgIds, deptIds);
    }

    /**
     * 更新角色 data_scope；CUSTOM(5) 时写入 perm_type=org|dept（至少一项非空）。
     */
    @Transactional
    public RoleDataScopeVO assignDataScope(Long roleId, RoleDataScopeRequest request) {
        SysRole role = requireRole(roleId);
        int scope = request.dataScope();
        if (scope < 1 || scope > 6) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "dataScope 无效");
        }
        List<Long> orgIds = request.orgIds() != null ? request.orgIds() : List.of();
        List<Long> deptIds = request.deptIds() != null ? request.deptIds() : List.of();
        if (scope == 5 && CollectionUtils.isEmpty(orgIds) && CollectionUtils.isEmpty(deptIds)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "自定义数据范围需至少指定组织或部门");
        }

        role.setDataScope(scope);
        role.setUpdatedAt(Instant.now());
        roleRepository.save(role);

        rolePermissionRepository.deleteByRoleIdAndPermType(roleId, PermType.org);
        rolePermissionRepository.deleteByRoleIdAndPermType(roleId, PermType.dept);
        Instant now = Instant.now();
        if (scope == 5) {
            for (Long orgId : orgIds) {
                SysRolePermission rp = new SysRolePermission();
                rp.setId(IdGenerator.nextId());
                rp.setRoleId(roleId);
                rp.setPermType(PermType.org);
                rp.setTargetId(orgId);
                rp.setCreatedAt(now);
                rolePermissionRepository.save(rp);
            }
            for (Long deptId : deptIds) {
                SysRolePermission rp = new SysRolePermission();
                rp.setId(IdGenerator.nextId());
                rp.setRoleId(roleId);
                rp.setPermType(PermType.dept);
                rp.setTargetId(deptId);
                rp.setCreatedAt(now);
                rolePermissionRepository.save(rp);
            }
        }
        bumpUsersOfRole(roleId);
        return getDataScope(roleId);
    }

    @Transactional(readOnly = true)
    public List<Long> listCustomOrgIdsByUser(Long userId) {
        return rolePermissionRepository.findTargetIdsByUserIdAndPermType(userId, PermType.org);
    }

    @Transactional(readOnly = true)
    public List<Long> listCustomDeptIdsByUser(Long userId) {
        return rolePermissionRepository.findTargetIdsByUserIdAndPermType(userId, PermType.dept);
    }

    private void bumpUsersOfRole(Long roleId) {
        List<Long> userIds = rolePermissionRepository.findUserIdsByRoleId(roleId);
        Instant now = Instant.now();
        for (Long userId : userIds) {
            userRepository.findById(userId).ifPresent(user -> {
                long next = (user.getPermVersion() == null ? 1L : user.getPermVersion()) + 1;
                user.setPermVersion(next);
                user.setUpdatedAt(now);
                userRepository.save(user);
                rbacCacheSupport.onUserPermissionsChanged(user);
            });
        }
    }

    private SysRole requireRole(Long roleId) {
        return roleRepository.findById(roleId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "角色不存在"));
    }
}
