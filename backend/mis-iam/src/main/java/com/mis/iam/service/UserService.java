package com.mis.iam.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iam.client.OrgEmployeeClient;
import com.mis.iam.config.IamProperties;
import com.mis.iam.domain.entity.SysRole;
import com.mis.iam.domain.entity.SysRolePermission;
import com.mis.iam.domain.entity.SysUser;
import com.mis.iam.domain.entity.SysUserDept;
import com.mis.iam.domain.entity.SysUserOrg;
import com.mis.iam.domain.entity.SysUserRole;
import com.mis.iam.domain.repository.SysRolePermissionRepository;
import com.mis.iam.domain.repository.SysRoleRepository;
import com.mis.iam.domain.repository.SysUserDeptRepository;
import com.mis.iam.domain.repository.SysUserOrgRepository;
import com.mis.iam.domain.repository.SysUserRepository;
import com.mis.iam.domain.repository.SysUserRoleRepository;
import com.mis.iam.dto.AuthUserVO;
import com.mis.iam.dto.DataScopeVO;
import com.mis.iam.dto.EmployeeBindingCheck;
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
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class UserService {

    private static final int TYPE_BUILTIN = 1;

    private final SysUserRepository userRepository;
    private final SysRoleRepository roleRepository;
    private final SysUserRoleRepository userRoleRepository;
    private final SysRolePermissionRepository rolePermissionRepository;
    private final SysUserOrgRepository userOrgRepository;
    private final SysUserDeptRepository userDeptRepository;
    private final PasswordEncoder passwordEncoder;
    private final OrgEmployeeClient orgEmployeeClient;
    private final RbacCacheSupport rbacCacheSupport;
    private final IamProperties iamProperties;
    private final RoleService roleService;

    public UserService(SysUserRepository userRepository,
                       SysRoleRepository roleRepository,
                       SysUserRoleRepository userRoleRepository,
                       SysRolePermissionRepository rolePermissionRepository,
                       SysUserOrgRepository userOrgRepository,
                       SysUserDeptRepository userDeptRepository,
                       PasswordEncoder passwordEncoder,
                       OrgEmployeeClient orgEmployeeClient,
                       RbacCacheSupport rbacCacheSupport,
                       IamProperties iamProperties,
                       RoleService roleService) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.userRoleRepository = userRoleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.userOrgRepository = userOrgRepository;
        this.userDeptRepository = userDeptRepository;
        this.passwordEncoder = passwordEncoder;
        this.orgEmployeeClient = orgEmployeeClient;
        this.rbacCacheSupport = rbacCacheSupport;
        this.iamProperties = iamProperties;
        this.roleService = roleService;
    }

    @Transactional(readOnly = true)
    public Page<UserVO> page(
            Long tenantId, List<Long> appIds, Integer status, String username, String realName, String phone,
            List<Long> orgIds, List<Long> deptIds, int page, int size) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(size, 1), 100);
        var pageable = PageRequest.of(safePage - 1, safeSize, Sort.by(Sort.Direction.DESC, "createdAt"));

        // 组织/部门维度：解析候选用户 ID 集合（绑定用户与非绑定用户统一走自身 org/dept 关联）
        // 允许绑定用户也写入 sys_user_org/sys_user_dept（创建/同步时派生），故可统一过滤
        List<Long> candidateUserIds = null;
        boolean hasCandidate = (orgIds != null && !orgIds.isEmpty()) || (deptIds != null && !deptIds.isEmpty());
        if (hasCandidate) {
            Set<Long> ids = new HashSet<>();
            if (orgIds != null && !orgIds.isEmpty()) {
                userOrgRepository.findByOrgIdIn(orgIds).forEach(o -> ids.add(o.getUserId()));
            }
            if (deptIds != null && !deptIds.isEmpty()) {
                userDeptRepository.findByDeptIdIn(deptIds).forEach(d -> ids.add(d.getUserId()));
            }
            // 选中了组织/部门但无命中用户 → 返回空页（用 -1 占位，使 IN 不报错）
            candidateUserIds = ids.isEmpty() ? List.of(-1L) : List.copyOf(ids);
        } else {
            candidateUserIds = List.of(-1L);
        }

        // 跨 APP 查询（D2）：appIds 为空 = 查全部 APP（hasAppFilter=false 跳过过滤）；非空 = appId IN 取并集
        boolean hasAppFilter = appIds != null && !appIds.isEmpty();
        List<Long> effectiveAppIds = hasAppFilter ? appIds : List.of(-1L);

        String usernameFilter = StringUtils.hasText(username) ? username.trim() : "";
        String realNameFilter = StringUtils.hasText(realName) ? realName.trim() : "";
        String phoneFilter = StringUtils.hasText(phone) ? phone.trim() : "";

        Page<SysUser> result = userRepository.searchV3(
                tenantId, effectiveAppIds, hasAppFilter, status, usernameFilter, realNameFilter, phoneFilter,
                candidateUserIds, hasCandidate, pageable);
        return result.map(this::toVo);
    }

    /**
     * 员工绑定预检（D1）：该员工是否已在指定「租户 + APP」内被绑定。
     * <p>编辑时传入 {@code excludeUserId} 排除自身，避免「自己绑自己」误判冲突。</p>
     */
    @Transactional(readOnly = true)
    public EmployeeBindingCheck checkEmployeeBinding(
            Long tenantId, Long appId, Long employeeId, Long excludeUserId) {
        if (employeeId == null) {
            return new EmployeeBindingCheck(false);
        }
        boolean exists = excludeUserId != null
                ? userRepository.existsByTenantIdAndAppIdAndEmployeeIdAndIdNot(tenantId, appId, employeeId, excludeUserId)
                : userRepository.existsByTenantIdAndAppIdAndEmployeeId(tenantId, appId, employeeId);
        return new EmployeeBindingCheck(exists);
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
        // 手机号在「租户 + APP」内唯一（D4）：仅手机号非空时校验
        if (StringUtils.hasText(request.phone())
                && userRepository.existsByTenantIdAndAppIdAndPhone(request.tenantId(), request.appId(), request.phone())) {
            throw new BusinessException(ResultCode.USER_PHONE_EXISTS);
        }
        Long employeeId = request.employeeId();
        if (employeeId != null) {
            // 绑员工：校验员工存在且属于该租户；允许多用户绑同一员工（D3）
            orgEmployeeClient.requireEmployee(request.tenantId(), employeeId);
            // 每个 APP 内 employeeId 唯一（D1）
            if (userRepository.existsByTenantIdAndAppIdAndEmployeeId(request.tenantId(), request.appId(), employeeId)) {
                throw new BusinessException(ResultCode.EMPLOYEE_ALREADY_BOUND);
            }
        }
        // 注意：已移除 existsByEmployeeId 唯一校验，以支持"一个员工多个账号"场景

        Instant now = Instant.now();
        SysUser user = new SysUser();
        user.setId(IdGenerator.nextId());
        user.setTenantId(request.tenantId());
        user.setAppId(request.appId());
        user.setEmployeeId(employeeId);
        user.setUsername(request.username());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        // 姓名/手机：非员工用户自有；绑员工时由请求提供（与员工同步，便于按姓名/手机检索）
        user.setRealName(request.realName());
        user.setPhone(request.phone());
        // 用户级邮箱（Q1 裁决）：非员工取请求值；绑员工时由请求携带的 emp.email() 回填
        user.setEmail(request.email());
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
        if (request.orgIds() != null && !request.orgIds().isEmpty()) {
            replaceUserOrgs(user, request.orgIds());
        }
        if (request.deptIds() != null && !request.deptIds().isEmpty()) {
            replaceUserDepts(user, request.deptIds());
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
        // 手机唯一（D4）：租户+APP 内唯一，排除自身；仅手机号非空且发生变化时校验
        if (StringUtils.hasText(request.phone())
                && !request.phone().equals(user.getPhone())
                && userRepository.existsByTenantIdAndAppIdAndPhoneAndIdNot(
                        user.getTenantId(), user.getAppId(), request.phone(), id)) {
            throw new BusinessException(ResultCode.USER_PHONE_EXISTS);
        }

        // 改 APP 守卫（D4）：已分配任意角色则禁止修改所属 APP（角色按 appId 隔离，改 APP 会让角色失效）
        Long reqAppId = request.appId();
        boolean appChanged = reqAppId != null && !reqAppId.equals(user.getAppId());
        if (appChanged && userRoleRepository.existsByUserId(id)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "已分配角色，禁止修改所属APP");
        }

        Long reqEmp = request.employeeId();
        Long curEmp = user.getEmployeeId();
        boolean empChanged = reqEmp != null ? !reqEmp.equals(curEmp) : curEmp != null;

        if (empChanged) {
            if (reqEmp != null) {
                // 绑定 / 换绑：校验员工存在且属本租户；姓名/手机以员工资料同步（BFF 已解析回传）
                orgEmployeeClient.requireEmployee(user.getTenantId(), reqEmp);
                user.setEmployeeId(reqEmp);
                if (request.realName() != null) {
                    user.setRealName(request.realName());
                }
                if (request.phone() != null) {
                    user.setPhone(request.phone());
                }
            } else {
                // 解绑：保留已同步的姓名/手机，仅解除员工关联（后续可单独编辑）
                user.setEmployeeId(null);
            }
        }

        // 未变更绑定时，沿用既有规则：已绑定用户禁止反向修改姓名/手机（Req4 双保险）
        if (!empChanged) {
            if (user.getEmployeeId() != null) {
                if (request.realName() != null || request.phone() != null) {
                    throw new BusinessException(ResultCode.VALIDATION_ERROR, "已绑定员工的用户不可修改姓名/手机号，请在员工模块维护");
                }
            } else {
                if (request.realName() != null) {
                    user.setRealName(request.realName());
                }
                if (request.phone() != null) {
                    user.setPhone(request.phone());
                }
            }
        }

        // 改 APP（在已分配角色守卫通过后允许，D4）
        if (appChanged) {
            user.setAppId(reqAppId);
        }

        // 用户级邮箱（Q1 裁决）：绑员工时由请求携带的 emp.email() 同步回填；非员工取表单值
        if (request.email() != null) {
            user.setEmail(request.email());
        }

        user.setUsername(request.username());
        if (request.status() != null) {
            applyStatusChange(user, request.status());
        }
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);

        if (request.orgIds() != null) {
            replaceUserOrgs(user, request.orgIds());
        }
        if (request.deptIds() != null) {
            replaceUserDepts(user, request.deptIds());
        }
        return toVo(user);
    }

    /**
     * 员工变更后反向同步绑定用户（Req4）：
     * <ul>
     *   <li>realName/phone 覆盖绑定用户对应字段；</li>
     *   <li>status=0（员工停用）→ 绑定用户同步停用；</li>
     *   <li>status=1（员工恢复）→ <b>不</b>自动恢复用户（需手工恢复，见需求）。</li>
     * </ul>
     * 调用方（mis-org）在员工保存后触发。
     */
    @Transactional
    public void syncByEmployee(Long employeeId, String realName, String phone, Integer status) {
        List<SysUser> users = userRepository.findByEmployeeId(employeeId);
        if (users.isEmpty()) {
            return;
        }
        Instant now = Instant.now();
        for (SysUser u : users) {
            if (realName != null) {
                u.setRealName(realName);
            }
            if (phone != null) {
                u.setPhone(phone);
            }
            if (status != null && status == 0) {
                u.setStatus(0);
            }
            u.setUpdatedAt(now);
        }
        userRepository.saveAll(users);
        // 姓名/状态变更可能影响权限缓存，主动失效
        users.forEach(rbacCacheSupport::onUserPermissionsChanged);
    }

    private void replaceUserOrgs(SysUser user, List<Long> orgIds) {
        userOrgRepository.deleteByUserId(user.getId());
        Instant now = Instant.now();
        for (int i = 0; i < orgIds.size(); i++) {
            SysUserOrg o = new SysUserOrg();
            o.setId(IdGenerator.nextId());
            o.setTenantId(user.getTenantId());
            o.setUserId(user.getId());
            o.setOrgId(orgIds.get(i));
            o.setIsPrimary(i == 0 ? 1 : 0);
            o.setCreatedAt(now);
            userOrgRepository.save(o);
        }
    }

    private void replaceUserDepts(SysUser user, List<Long> deptIds) {
        userDeptRepository.deleteByUserId(user.getId());
        Instant now = Instant.now();
        for (int i = 0; i < deptIds.size(); i++) {
            SysUserDept d = new SysUserDept();
            d.setId(IdGenerator.nextId());
            d.setTenantId(user.getTenantId());
            d.setUserId(user.getId());
            d.setDeptId(deptIds.get(i));
            d.setIsPrimary(i == 0 ? 1 : 0);
            d.setCreatedAt(now);
            userDeptRepository.save(d);
        }
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
        List<String> orgIds = userOrgRepository.findByUserId(user.getId()).stream()
                .map(o -> String.valueOf(o.getOrgId()))
                .toList();
        List<String> deptIds = userDeptRepository.findByUserId(user.getId()).stream()
                .map(d -> String.valueOf(d.getDeptId()))
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
                user.getRealName(),
                user.getEmail(),
                null,
                roles,
                orgIds,
                deptIds,
                user.getCreatedAt(),
                user.getUpdatedAt());
    }
}
