package com.mis.iam.controller;

import com.mis.common.core.result.Result;
import com.mis.iam.dto.UserPermissionsVO;
import com.mis.iam.service.PermissionService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/v1/permissions")
public class PermissionController {

    private final PermissionService permissionService;

    public PermissionController(PermissionService permissionService) {
        this.permissionService = permissionService;
    }

    @GetMapping("/{userId}")
    public Result<UserPermissionsVO> loadAndCache(@PathVariable Long userId) {
        return Result.ok(permissionService.loadAndCache(userId));
    }
}
