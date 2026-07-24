package com.mis.adminbff.controller;

import com.mis.adminbff.dto.RoleAssignRequest;
import com.mis.adminbff.dto.StatusUpdateRequest;
import com.mis.adminbff.dto.UserCreateRequest;
import com.mis.adminbff.dto.UserUpdateRequest;
import com.mis.adminbff.dto.UserView;
import com.mis.adminbff.service.UserAggregateService;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    private final UserAggregateService userAggregateService;

    public UserController(UserAggregateService userAggregateService) {
        this.userAggregateService = userAggregateService;
    }

    @GetMapping
    public Result<PageResult<UserView>> page(
            @RequestParam(required = false) Integer status,
            @RequestParam(required = false) String username,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return Result.ok(userAggregateService.page(status, username, page, size));
    }

    @GetMapping("/{id}")
    public Result<UserView> get(@PathVariable Long id) {
        return Result.ok(userAggregateService.get(id));
    }

    @PostMapping
    public Result<UserView> create(@Valid @RequestBody UserCreateRequest request) {
        return Result.ok(userAggregateService.create(request));
    }

    @PutMapping("/{id}")
    public Result<UserView> update(@PathVariable Long id, @Valid @RequestBody UserUpdateRequest request) {
        return Result.ok(userAggregateService.update(id, request));
    }

    @PutMapping("/{id}/status")
    public Result<UserView> updateStatus(@PathVariable Long id, @Valid @RequestBody StatusUpdateRequest request) {
        return Result.ok(userAggregateService.updateStatus(id, request));
    }

    @PutMapping("/{id}/reset-password")
    public Result<Void> resetPassword(@PathVariable Long id) {
        userAggregateService.resetPassword(id);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        userAggregateService.delete(id);
        return Result.ok();
    }

    @PutMapping("/{id}/roles")
    public Result<Void> assignRoles(@PathVariable Long id, @Valid @RequestBody RoleAssignRequest request) {
        userAggregateService.assignRoles(id, request);
        return Result.ok();
    }
}
