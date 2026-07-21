package com.mis.iam.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iam.client.SystemMenuClient;
import com.mis.iam.domain.entity.SysUser;
import com.mis.iam.domain.repository.SysUserRepository;
import com.mis.iam.dto.UserPermissionsVO;
import com.mis.iam.support.RbacCacheSupport;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class PermissionService {

    private final SysUserRepository userRepository;
    private final RolePermissionService rolePermissionService;
    private final SystemMenuClient systemMenuClient;
    private final RbacCacheSupport rbacCacheSupport;

    public PermissionService(
            SysUserRepository userRepository,
            RolePermissionService rolePermissionService,
            SystemMenuClient systemMenuClient,
            RbacCacheSupport rbacCacheSupport) {
        this.userRepository = userRepository;
        this.rolePermissionService = rolePermissionService;
        this.systemMenuClient = systemMenuClient;
        this.rbacCacheSupport = rbacCacheSupport;
    }

    /**
     * 聚合菜单 permission 并写入 Redis（登录/刷新/BFF miss 回源）。
     */
    @Transactional(readOnly = true)
    public UserPermissionsVO loadAndCache(Long userId) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "用户不存在"));
        List<Long> menuIds = rolePermissionService.listMenuIdsByUser(userId);
        List<String> permissions = systemMenuClient.permissionCodes(menuIds);
        rbacCacheSupport.writePermissions(user.getTenantId(), user.getAppId(), user.getId(), permissions);
        long version = user.getPermVersion() == null ? 1L : user.getPermVersion();
        return new UserPermissionsVO(permissions, version);
    }
}
