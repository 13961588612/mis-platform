package com.mis.adminbff.controller;

import com.mis.adminbff.dto.RoleAssignRequest;
import com.mis.adminbff.dto.StatusUpdateRequest;
import com.mis.adminbff.dto.UserCreateRequest;
import com.mis.adminbff.dto.UserUpdateRequest;
import com.mis.adminbff.client.model.EmployeePhoneMatchVO;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.dto.UserView;
import com.mis.adminbff.client.model.EmployeeBindingCheck;
import com.mis.adminbff.service.UserAggregateService;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.common.web.audit.OperLog;
import jakarta.validation.Valid;
import java.util.List;
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
    private final OrgWebClient orgWebClient;

    public UserController(UserAggregateService userAggregateService, OrgWebClient orgWebClient) {
        this.userAggregateService = userAggregateService;
        this.orgWebClient = orgWebClient;
    }

    @GetMapping
    public Result<PageResult<UserView>> page(
            @RequestParam(required = false) Integer status,
            @RequestParam(required = false) String username,
            @RequestParam(required = false) String realName,
            @RequestParam(required = false) String phone,
            @RequestParam(required = false) List<Long> orgIds,
            @RequestParam(required = false) List<Long> deptIds,
            @RequestParam(required = false) List<Long> appIds,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return Result.ok(userAggregateService.page(status, username, realName, phone, orgIds, deptIds, appIds, page, size));
    }

    /** 员工绑定预检（D1）：该员工是否已在指定「租户 + APP」内被其他账号绑定。 */
    @GetMapping("/check-employee-binding")
    public Result<EmployeeBindingCheck> checkEmployeeBinding(
            @RequestParam Long appId,
            @RequestParam Long employeeId,
            @RequestParam(required = false) Long excludeUserId) {
        return Result.ok(userAggregateService.checkEmployeeBinding(appId, employeeId, excludeUserId));
    }

    /** 按手机查员工（新建用户时检测是否已存在员工，Req2）。 */
    @GetMapping("/employees/by-phone")
    public Result<List<EmployeePhoneMatchVO>> employeesByPhone(
            @RequestParam String phone) {
        Long tenantId = RequestContext.requireTenantId();
        return Result.ok(orgWebClient.listEmployeesByPhone(tenantId, phone));
    }

    @GetMapping("/{id}")
    public Result<UserView> get(@PathVariable Long id) {
        return Result.ok(userAggregateService.get(id));
    }

    @PostMapping
    @OperLog(module = "用户管理", operation = "新增用户")
    public Result<UserView> create(@Valid @RequestBody UserCreateRequest request) {
        return Result.ok(userAggregateService.create(request));
    }

    @PutMapping("/{id}")
    @OperLog(module = "用户管理", operation = "编辑用户")
    public Result<UserView> update(@PathVariable Long id, @Valid @RequestBody UserUpdateRequest request) {
        return Result.ok(userAggregateService.update(id, request));
    }

    @PutMapping("/{id}/status")
    @OperLog(module = "用户管理", operation = "变更状态")
    public Result<UserView> updateStatus(@PathVariable Long id, @Valid @RequestBody StatusUpdateRequest request) {
        return Result.ok(userAggregateService.updateStatus(id, request));
    }

    @PutMapping("/{id}/reset-password")
    @OperLog(module = "用户管理", operation = "重置密码")
    public Result<Void> resetPassword(@PathVariable Long id) {
        userAggregateService.resetPassword(id);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    @OperLog(module = "用户管理", operation = "删除用户")
    public Result<Void> delete(@PathVariable Long id) {
        userAggregateService.delete(id);
        return Result.ok();
    }

    @PutMapping("/{id}/roles")
    @OperLog(module = "用户管理", operation = "分配角色")
    public Result<Void> assignRoles(@PathVariable Long id, @Valid @RequestBody RoleAssignRequest request) {
        userAggregateService.assignRoles(id, request);
        return Result.ok();
    }
}
