package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.model.DeptVO;
import com.mis.adminbff.client.model.EmployeeVO;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.config.BffProperties;
import com.mis.adminbff.dto.RoleAssignRequest;
import com.mis.adminbff.dto.StatusUpdateRequest;
import com.mis.adminbff.dto.UserCreateRequest;
import com.mis.adminbff.dto.UserUpdateRequest;
import com.mis.adminbff.dto.UserView;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
public class UserAggregateService {

    private final IamWebClient iamWebClient;
    private final OrgWebClient orgWebClient;
    private final BffProperties properties;

    public UserAggregateService(IamWebClient iamWebClient, OrgWebClient orgWebClient, BffProperties properties) {
        this.iamWebClient = iamWebClient;
        this.orgWebClient = orgWebClient;
        this.properties = properties;
    }

    public PageResult<UserView> page(Integer status, String username, int page, int size) {
        Long tenantId = RequestContext.requireTenantId();
        Long appId = RequestContext.requireAppId();
        PageResult<IamUserVO> iamPage = iamWebClient.pageUsers(tenantId, appId, status, username, page, size);
        List<IamUserVO> users = iamPage.getList() != null ? iamPage.getList() : List.of();
        List<UserView> views = enrich(users);
        return PageResult.of(iamPage.getPage(), iamPage.getSize(), iamPage.getTotal(), views);
    }

    public UserView get(Long id) {
        return enrich(List.of(iamWebClient.getUser(id))).get(0);
    }

    public UserView create(UserCreateRequest request) {
        Long tenantId = RequestContext.requireTenantId();
        Long appId = RequestContext.requireAppId();
        // 校验部门归属
        DeptVO dept = orgWebClient.getDept(request.deptId());
        if (!String.valueOf(tenantId).equals(dept.tenantId())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "部门不属于当前租户");
        }

        EmployeeVO employee = orgWebClient.createEmployee(OrgWebClient.employeeCreateBody(
                tenantId,
                request.deptId(),
                request.employeeNo(),
                request.realName(),
                request.email(),
                request.phone()));
        Long employeeId = Long.valueOf(employee.id());
        try {
            String password = StringUtils.hasText(request.password())
                    ? request.password()
                    : properties.getDefaultPassword();
            IamUserVO user = iamWebClient.createUser(IamWebClient.userCreateBody(
                    tenantId, appId, employeeId, request.username(), password, request.roleIds()));
            return enrich(List.of(user)).get(0);
        } catch (RuntimeException ex) {
            try {
                orgWebClient.deleteEmployee(employeeId);
            } catch (Exception ignored) {
                // 补偿失败仅记录链路；业务异常继续抛出
            }
            throw ex;
        }
    }

    public UserView update(Long id, UserUpdateRequest request) {
        IamUserVO existing = iamWebClient.getUser(id);
        Map<String, Object> iamBody = new HashMap<>();
        iamBody.put("username", request.username());
        if (request.status() != null) {
            iamBody.put("status", request.status());
        }
        IamUserVO updated = iamWebClient.updateUser(id, iamBody);

        if (existing.employeeId() != null
                && (request.realName() != null || request.email() != null || request.phone() != null)) {
            EmployeeVO current = orgWebClient.getEmployee(Long.valueOf(existing.employeeId()));
            Map<String, Object> empBody = new HashMap<>();
            empBody.put("realName", request.realName() != null ? request.realName() : current.realName());
            empBody.put("email", request.email() != null ? request.email() : current.email());
            empBody.put("phone", request.phone() != null ? request.phone() : current.phone());
            orgWebClient.updateEmployee(Long.valueOf(existing.employeeId()), empBody);
        }
        return enrich(List.of(updated)).get(0);
    }

    public UserView updateStatus(Long id, StatusUpdateRequest request) {
        IamUserVO user = iamWebClient.updateStatus(id, request.status(), RequestContext.currentUserId());
        return enrich(List.of(user)).get(0);
    }

    public void resetPassword(Long id) {
        iamWebClient.resetPassword(id);
    }

    public void delete(Long id) {
        iamWebClient.deleteUser(id, RequestContext.currentUserId());
    }

    public void assignRoles(Long id, RoleAssignRequest request) {
        iamWebClient.assignRoles(id, request.roleIds());
    }

    private List<UserView> enrich(List<IamUserVO> users) {
        if (users.isEmpty()) {
            return List.of();
        }
        Duration timeout = Duration.ofMillis(Math.max(properties.getAggregateTimeoutMs(), 500));
        List<Long> employeeIds = users.stream()
                .map(IamUserVO::employeeId)
                .filter(Objects::nonNull)
                .map(Long::valueOf)
                .distinct()
                .toList();

        Map<Long, EmployeeVO> employees = Map.of();
        if (!employeeIds.isEmpty()) {
            List<EmployeeVO> loaded = Flux.fromIterable(employeeIds)
                    .flatMap(id -> orgWebClient.getEmployeeMono(id)
                            .map(RequestContext::unwrap)
                            .onErrorResume(ex -> Mono.empty()))
                    .collectList()
                    .block(timeout);
            if (loaded != null) {
                employees = loaded.stream().collect(Collectors.toMap(e -> Long.valueOf(e.id()), e -> e, (a, b) -> a));
            }
        }

        List<Long> deptIds = employees.values().stream()
                .map(EmployeeVO::deptId)
                .filter(Objects::nonNull)
                .map(Long::valueOf)
                .distinct()
                .toList();
        Map<Long, DeptVO> depts = Map.of();
        if (!deptIds.isEmpty()) {
            List<DeptVO> loaded = Flux.fromIterable(deptIds)
                    .flatMap(id -> orgWebClient.getDeptMono(id)
                            .map(RequestContext::unwrap)
                            .onErrorResume(ex -> Mono.empty()))
                    .collectList()
                    .block(timeout);
            if (loaded != null) {
                depts = loaded.stream().collect(Collectors.toMap(d -> Long.valueOf(d.id()), d -> d, (a, b) -> a));
            }
        }

        List<Long> orgIds = depts.values().stream()
                .map(DeptVO::orgId)
                .filter(Objects::nonNull)
                .map(Long::valueOf)
                .distinct()
                .toList();
        Map<Long, String> orgNames = orgWebClient.orgNames(orgIds);

        List<UserView> result = new ArrayList<>(users.size());
        for (IamUserVO user : users) {
            EmployeeVO emp = user.employeeId() != null ? employees.get(Long.valueOf(user.employeeId())) : null;
            DeptVO dept = emp != null && emp.deptId() != null ? depts.get(Long.valueOf(emp.deptId())) : null;
            String orgId = dept != null ? dept.orgId() : null;
            String orgName = orgId != null ? orgNames.get(Long.valueOf(orgId)) : null;
            List<UserView.RoleBrief> roles = mapRoles(user.roles());
            result.add(new UserView(
                    user.id(),
                    user.username(),
                    emp != null ? emp.realName() : user.realName(),
                    emp != null ? emp.employeeNo() : null,
                    user.employeeId(),
                    emp != null ? emp.deptId() : user.deptId(),
                    dept != null ? dept.name() : null,
                    orgId,
                    orgName,
                    emp != null ? emp.email() : null,
                    emp != null ? emp.phone() : null,
                    user.status(),
                    user.isTenantAdmin(),
                    roles,
                    user.createdAt()));
        }
        return result;
    }

    private static List<UserView.RoleBrief> mapRoles(List<IamRoleVO> roles) {
        if (roles == null) {
            return List.of();
        }
        return roles.stream()
                .map(r -> new UserView.RoleBrief(r.id(), r.name(), r.code()))
                .toList();
    }
}
