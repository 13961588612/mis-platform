package com.mis.iam.controller;

import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.common.jpa.support.PageMapper;
import com.mis.iam.dto.AuthUserVO;
import com.mis.iam.dto.DataScopeVO;
import com.mis.iam.dto.UserChangePasswordRequest;
import com.mis.iam.dto.UserCreateRequest;
import com.mis.iam.dto.UserResetPasswordRequest;
import com.mis.iam.dto.UserRoleAssignRequest;
import com.mis.iam.dto.UserStatusUpdateRequest;
import com.mis.iam.dto.UserUpdateRequest;
import com.mis.iam.dto.UserVO;
import com.mis.iam.service.RolePermissionService;
import com.mis.iam.service.UserService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/internal/v1/users")
public class UserController {

    private final UserService userService;
    private final RolePermissionService rolePermissionService;

    public UserController(UserService userService, RolePermissionService rolePermissionService) {
        this.userService = userService;
        this.rolePermissionService = rolePermissionService;
    }

    @GetMapping
    public Result<PageResult<UserVO>> page(
            @RequestParam Long tenantId,
            @RequestParam Long appId,
            @RequestParam(required = false) Integer status,
            @RequestParam(required = false) String username,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<UserVO> result = userService.page(tenantId, appId, status, username, page, size);
        return Result.ok(PageMapper.toPageResult(result));
    }

    @GetMapping("/by-username")
    public Result<AuthUserVO> byUsername(
            @RequestParam Long tenantId,
            @RequestParam Long appId,
            @RequestParam String username) {
        return Result.ok(userService.getAuthUser(tenantId, appId, username));
    }

    @GetMapping("/{id}/auth")
    public Result<AuthUserVO> authById(@PathVariable Long id) {
        return Result.ok(userService.getAuthUserById(id));
    }

    @GetMapping("/{id}/data-scope")
    public Result<DataScopeVO> dataScope(@PathVariable Long id) {
        return Result.ok(userService.resolveDataScope(id));
    }

    @GetMapping("/{id}/menu-ids")
    public Result<List<Long>> menuIds(@PathVariable Long id) {
        return Result.ok(rolePermissionService.listMenuIdsByUser(id));
    }

    @GetMapping("/{id}")
    public Result<UserVO> get(@PathVariable Long id) {
        return Result.ok(userService.getById(id));
    }

    @PostMapping
    public Result<UserVO> create(@Valid @RequestBody UserCreateRequest request) {
        return Result.ok(userService.create(request));
    }

    @PutMapping("/{id}")
    public Result<UserVO> update(@PathVariable Long id, @Valid @RequestBody UserUpdateRequest request) {
        return Result.ok(userService.update(id, request));
    }

    @PutMapping("/{id}/status")
    public Result<UserVO> updateStatus(
            @PathVariable Long id,
            @Valid @RequestBody UserStatusUpdateRequest request,
            @RequestHeader(value = SecurityConstants.HEADER_USER_ID, required = false) Long operatorUserId) {
        return Result.ok(userService.updateStatus(id, request.status(), operatorUserId));
    }

    @PutMapping("/{id}/reset-password")
    public Result<Void> resetPassword(
            @PathVariable Long id,
            @RequestBody(required = false) UserResetPasswordRequest request) {
        userService.resetPassword(id, request != null ? request : new UserResetPasswordRequest(null));
        return Result.ok();
    }

    @PutMapping("/{id}/password")
    public Result<Void> changePassword(
            @PathVariable Long id,
            @Valid @RequestBody UserChangePasswordRequest request) {
        userService.changePassword(id, request.newPassword());
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(
            @PathVariable Long id,
            @RequestHeader(value = SecurityConstants.HEADER_USER_ID, required = false) Long operatorUserId) {
        userService.delete(id, operatorUserId);
        return Result.ok();
    }

    @PutMapping("/{id}/roles")
    public Result<Void> assignRoles(@PathVariable Long id, @Valid @RequestBody UserRoleAssignRequest request) {
        userService.assignRoles(id, request);
        return Result.ok();
    }
}
