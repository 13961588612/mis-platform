package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.client.model.ConfigVO;
import com.mis.adminbff.client.model.DeptVO;
import com.mis.adminbff.client.model.EmployeeVO;
import com.mis.adminbff.client.model.EmployeeBindingCheck;
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
import com.mis.common.core.util.DesensitizeUtils;
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
    private final SystemWebClient systemWebClient;

    public UserAggregateService(IamWebClient iamWebClient, OrgWebClient orgWebClient,
                                BffProperties properties, SystemWebClient systemWebClient) {
        this.iamWebClient = iamWebClient;
        this.orgWebClient = orgWebClient;
        this.properties = properties;
        this.systemWebClient = systemWebClient;
    }

    /** 系统参数键：用户是否强制绑定员工（默认关闭）。 */
    private static final String FORCE_BIND_KEY = "user.force.employee.bind";

    /** 读取「用户强制绑定员工」开关；配置不可用时降级为关闭，避免阻断正常创建/编辑。 */
    private boolean isForceEmployeeBind() {
        try {
            ConfigVO cfg = systemWebClient.getConfigByKey(FORCE_BIND_KEY);
            return cfg != null && Boolean.parseBoolean(cfg.configValue());
        } catch (Exception e) {
            return false;
        }
    }

    public PageResult<UserView> page(Integer status, String username, String realName, String phone,
                                    List<Long> orgIds, List<Long> deptIds, List<Long> appIds, int page, int size) {
        Long tenantId = RequestContext.requireTenantId();
        // 跨 APP 查询（D2）：appIds 为空 = 查全部 APP（IAM 端 hasAppFilter=false）；非空 = appId IN 取并集
        PageResult<IamUserVO> iamPage =
                iamWebClient.pageUsers(tenantId, appIds, status, username, realName, phone, orgIds, deptIds, page, size);
        List<IamUserVO> users = iamPage.getList() != null ? iamPage.getList() : List.of();
        List<UserView> views = enrich(users);
        return PageResult.of(iamPage.getPage(), iamPage.getSize(), iamPage.getTotal(), views);
    }

    public UserView get(Long id) {
        return enrich(List.of(iamWebClient.getUser(id))).get(0);
    }

    /**
     * 创建用户（双模式）：
     * <ul>
     *   <li>employeeId 提供 → 绑定已有员工（不再新建员工）；组织/部门派生自员工主部门，保证过滤与展示一致</li>
     *   <li>employeeId 为 null → 非员工用户（纯系统账号），realName/phone/orgIds/deptIds 自行提供，组织/部门可空</li>
     * </ul>
     */
    public UserView create(UserCreateRequest request) {
        Long tenantId = RequestContext.requireTenantId();
        // 所属 APP 显式取自请求（不再取登录态上下文，D1/D2）
        Long appId = request.appId();
        Long employeeId = request.employeeId();
        if (isForceEmployeeBind() && employeeId == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "系统已开启「用户强制绑定员工」，创建用户必须绑定员工");
        }
        List<Long> orgIds = request.orgIds();
        List<Long> deptIds = request.deptIds();
        EmployeeVO emp = null;
        if (employeeId != null) {
            emp = orgWebClient.getEmployee(employeeId);
            if (emp.deptId() != null) {
                Long primaryDept = Long.valueOf(emp.deptId());
                deptIds = List.of(primaryDept);
                DeptVO dept = orgWebClient.getDept(primaryDept);
                if (dept.orgId() != null) {
                    orgIds = List.of(Long.valueOf(dept.orgId()));
                }
            }
        }
        String password = StringUtils.hasText(request.password())
                ? request.password()
                : properties.getDefaultPassword();
        // 用户级邮箱（Q1 裁决）：绑员工时由员工邮箱同步回填（emp.email），非员工取请求值
        String email = (employeeId != null && emp != null && emp.email() != null) ? emp.email() : request.email();
        IamUserVO user = iamWebClient.createUser(IamWebClient.userCreateBody(
                tenantId, appId, employeeId, request.username(), password, request.roleIds(),
                request.realName(), request.phone(), email, orgIds, deptIds));
        return enrich(List.of(user)).get(0);
    }

    public UserView update(Long id, UserUpdateRequest request) {
        IamUserVO existing = iamWebClient.getUser(id);
        Map<String, Object> iamBody = new HashMap<>();
        iamBody.put("username", request.username());
        if (request.status() != null) {
            iamBody.put("status", request.status());
        }

        Long reqEmp = request.employeeId();
        Long existingEmp = toLongOrNull(existing.employeeId());
        boolean empChanged = reqEmp != null ? !reqEmp.equals(existingEmp) : existingEmp != null;

        if (isForceEmployeeBind() && empChanged && reqEmp == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "系统已开启「用户强制绑定员工」，禁止解绑员工");
        }

        if (empChanged && reqEmp != null) {
            // 绑定 / 换绑：组织/部门派生自员工主部门，姓名/手机取自员工（同步，Req2）
            EmployeeVO emp = orgWebClient.getEmployee(reqEmp);
            List<Long> orgIds = null;
            List<Long> deptIds = null;
            if (emp.deptId() != null) {
                Long primaryDept = Long.valueOf(emp.deptId());
                deptIds = List.of(primaryDept);
                DeptVO dept = orgWebClient.getDept(primaryDept);
                if (dept != null && dept.orgId() != null) {
                    orgIds = List.of(Long.valueOf(dept.orgId()));
                }
            }
            iamBody.put("employeeId", reqEmp);
            if (emp.realName() != null) {
                iamBody.put("realName", emp.realName());
            }
            if (emp.phone() != null) {
                iamBody.put("phone", emp.phone());
            }
            if (orgIds != null) {
                iamBody.put("orgIds", orgIds);
            }
            if (deptIds != null) {
                iamBody.put("deptIds", deptIds);
            }
        } else if (empChanged && reqEmp == null) {
            // 解绑：仅解除员工关联，保留已同步姓名/手机与组织/部门（Req2）
            iamBody.put("employeeId", null);
        } else {
            // 员工未变更
            if (existingEmp == null) {
                // 非员工用户：姓名/手机/组织/部门自行维护
                if (request.realName() != null) {
                    iamBody.put("realName", request.realName());
                }
                if (request.phone() != null) {
                    iamBody.put("phone", request.phone());
                }
                if (request.orgIds() != null) {
                    iamBody.put("orgIds", request.orgIds());
                }
                if (request.deptIds() != null) {
                    iamBody.put("deptIds", request.deptIds());
                }
            }
            // 已绑定且未变更：姓名/手机/组织/部门均由员工同步，忽略前端输入（Req4 双保险）
        }

        // 所属 APP 显式透传（不再取登录态上下文）；与现有 appId 不同且已分配角色时由 IAM 守卫拦截（D4）
        if (request.appId() != null) {
            iamBody.put("appId", request.appId());
        }
        // 用户级邮箱透传（Q1 裁决）：绑员工时前端携带 emp.email() 同步值，非员工取表单值
        if (request.email() != null) {
            iamBody.put("email", request.email());
        }

        IamUserVO updated = iamWebClient.updateUser(id, iamBody);
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

    /** 员工绑定预检（D1）：该员工是否已在指定「租户 + APP」内被其他账号绑定（前端选员工即时调用）。 */
    public EmployeeBindingCheck checkEmployeeBinding(Long appId, Long employeeId, Long excludeUserId) {
        Long tenantId = RequestContext.requireTenantId();
        return iamWebClient.checkEmployeeBinding(tenantId, appId, employeeId, excludeUserId);
    }

    public void assignRoles(Long id, RoleAssignRequest request) {
        iamWebClient.assignRoles(id, request.roleIds());
    }

    private List<UserView> enrich(List<IamUserVO> users) {
        if (users.isEmpty()) {
            return List.of();
        }
        Duration timeout = Duration.ofMillis(Math.max(properties.getAggregateTimeoutMs(), 500));

        // 1) 绑定用户 → 解析员工
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

        // 2) 部门 ID：员工主部门 + 非绑定用户自身 deptIds（统一解析组织/部门，保证过滤与展示一致）
        List<Long> deptIds = new ArrayList<>();
        employees.values().stream().map(EmployeeVO::deptId).filter(Objects::nonNull).forEach(d -> deptIds.add(Long.valueOf(d)));
        users.stream()
                .map(IamUserVO::deptIds)
                .filter(Objects::nonNull)
                .flatMap(List::stream)
                .filter(Objects::nonNull)
                .map(Long::valueOf)
                .forEach(deptIds::add);
        Map<Long, DeptVO> depts = Map.of();
        if (!deptIds.isEmpty()) {
            List<DeptVO> loaded = Flux.fromIterable(deptIds.stream().distinct().toList())
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

            String resolvedDeptId;
            if (emp != null && emp.deptId() != null) {
                resolvedDeptId = emp.deptId();
            } else if (user.deptIds() != null && !user.deptIds().isEmpty()) {
                resolvedDeptId = user.deptIds().get(0);
            } else {
                resolvedDeptId = null;
            }
            DeptVO dept = resolvedDeptId != null ? depts.get(Long.valueOf(resolvedDeptId)) : null;
            String orgId = dept != null ? dept.orgId() : null;
            String orgName = orgId != null ? orgNames.get(Long.valueOf(orgId)) : null;
            String deptName = dept != null ? dept.name() : null;

            String realName = emp != null ? emp.realName() : user.realName();
            String phone = emp != null ? DesensitizeUtils.phone(emp.phone()) : DesensitizeUtils.phone(user.phone());
            String employeeNo = emp != null ? emp.employeeNo() : null;
            // 邮箱：优先用户级邮箱（Q1 裁决），未设置时回退到员工邮箱
            String email = user.email() != null
                    ? DesensitizeUtils.email(user.email())
                    : (emp != null ? DesensitizeUtils.email(emp.email()) : null);

            List<UserView.RoleBrief> roles = mapRoles(user.roles());
            result.add(new UserView(
                    user.id(),
                    user.username(),
                    realName,
                    employeeNo,
                    user.employeeId(),
                    resolvedDeptId,
                    deptName,
                    orgId,
                    orgName,
                    email,
                    phone,
                    user.status(),
                    user.isTenantAdmin(),
                    roles,
                    user.createdAt(),
                    user.appId()));
        }
        return result;
    }

    private static Long toLongOrNull(String v) {
        if (v == null || v.isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(v);
        } catch (NumberFormatException e) {
            return null;
        }
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
