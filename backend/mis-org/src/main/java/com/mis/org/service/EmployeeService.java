package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.jpa.datascope.DataScope;
import com.mis.common.jpa.datascope.DataScopeSpecification;
import com.mis.common.jpa.datascope.DataScopeSpecification.DataScopeContext;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysEmployee;
import com.mis.org.domain.entity.SysEmployeeDept;
import com.mis.org.domain.entity.SysEmployeePost;
import com.mis.org.domain.entity.SysOrg;
import com.mis.org.domain.entity.SysPost;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeeDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.domain.repository.SysOrgRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.client.OrgIamClient;
import com.mis.org.dto.EmployeeCreateRequest;
import com.mis.org.dto.EmployeePostItem;
import com.mis.org.dto.EmployeePostVO;
import com.mis.org.dto.EmployeeUpdateRequest;
import com.mis.org.dto.EmployeePhoneMatchPostVO;
import com.mis.org.dto.EmployeePhoneMatchVO;
import com.mis.org.dto.EmployeeVO;
import com.mis.org.support.IdGenerator;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class EmployeeService {

    private final SysEmployeeRepository employeeRepository;
    private final SysDeptRepository deptRepository;
    private final SysEmployeeDeptRepository employeeDeptRepository;
    private final SysEmployeePostRepository employeePostRepository;
    private final SysPostRepository postRepository;
    private final SysOrgRepository orgRepository;
    private final DataScopeService dataScopeService;
    private final OrgIamClient orgIamClient;

    public EmployeeService(
            SysEmployeeRepository employeeRepository,
            SysDeptRepository deptRepository,
            SysEmployeeDeptRepository employeeDeptRepository,
            SysEmployeePostRepository employeePostRepository,
            SysPostRepository postRepository,
            SysOrgRepository orgRepository,
            DataScopeService dataScopeService,
            OrgIamClient orgIamClient) {
        this.employeeRepository = employeeRepository;
        this.deptRepository = deptRepository;
        this.employeeDeptRepository = employeeDeptRepository;
        this.employeePostRepository = employeePostRepository;
        this.postRepository = postRepository;
        this.orgRepository = orgRepository;
        this.dataScopeService = dataScopeService;
        this.orgIamClient = orgIamClient;
    }

    @Transactional(readOnly = true)
    public EmployeeVO getById(Long id) {
        SysEmployee emp = employeeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "员工不存在"));
        return toVo(emp);
    }

    /**
     * 按部门列员工，并叠加当前用户 DataScope（与请求 deptId 求交）。
     */
    @DataScope(deptField = "deptId")
    @Transactional(readOnly = true)
    public List<EmployeeVO> listByDept(Long tenantId, Long deptId) {
        DataScopeContext scope = dataScopeService.buildForCurrentUser();

        if (scope.dataScope() == DataScopeSpecification.SCOPE_SELF) {
            Long selfEmployeeId = SecurityContextHolder.getOptional()
                    .map(u -> u.getEmployeeId())
                    .orElse(null);
            if (selfEmployeeId == null) {
                return List.of();
            }
            return employeeRepository.findById(selfEmployeeId)
                    .filter(e -> e.getTenantId().equals(tenantId))
                    .filter(e -> e.getStatus() != null && e.getStatus() == 1)
                    .filter(e -> deptId == null || deptId.equals(e.getDeptId()))
                    .filter(e -> isDeptAllowed(e.getDeptId(), scope))
                    .map(e -> List.of(toVo(e)))
                    .orElse(List.of());
        }

        Specification<SysEmployee> base = (root, query, cb) -> cb.and(
                cb.equal(root.get("tenantId"), tenantId),
                cb.equal(root.get("status"), 1),
                cb.equal(root.get("deptId"), deptId));

        Specification<SysEmployee> scoped = DataScopeSpecification.and(
                base,
                DataScopeSpecification.of(scope, "deptId", ""));

        return employeeRepository.findAll(scoped).stream().map(this::toVo).toList();
    }

    private boolean isDeptAllowed(Long empDeptId, DataScopeContext scope) {
        if (scope.dataScope() == DataScopeSpecification.SCOPE_ALL) {
            return true;
        }
        return switch (scope.dataScope()) {
            case DataScopeSpecification.SCOPE_DEPT ->
                    scope.assignedDeptIds() != null && scope.assignedDeptIds().contains(empDeptId);
            case DataScopeSpecification.SCOPE_DEPT_AND_CHILD ->
                    scope.assignedDeptSubtreeIds() != null && scope.assignedDeptSubtreeIds().contains(empDeptId);
            case DataScopeSpecification.SCOPE_ORG ->
                    scope.deptIdsInAssignedOrgs() != null && scope.deptIdsInAssignedOrgs().contains(empDeptId);
            case DataScopeSpecification.SCOPE_CUSTOM -> {
                Set<Long> allowed = new HashSet<>();
                if (scope.customDeptIds() != null) {
                    allowed.addAll(scope.customDeptIds());
                }
                if (scope.deptIdsForCustomOrgs() != null) {
                    allowed.addAll(scope.deptIdsForCustomOrgs());
                }
                yield allowed.contains(empDeptId);
            }
            default -> false;
        };
    }

    /**
     * 员工全量列表（含禁用员工；realName 模糊；deptId/deptIds/orgIds/status 可选）。
     * 不叠加 DataScope：系统管理页按租户全量展示。
     *
     * <p>部门过滤语义：
     * <ul>
     *   <li>单值 {@code deptId} 视为 {@code deptIds=[deptId]}（保留兼容）；</li>
     *   <li>{@code orgIds} 经 {@code deptRepository.findByOrgId} 反查部门集合（并集）；</li>
     *   <li>{@code deptIds} 与组织反查部门集合默认取<b>交集</b>（与岗位 POST-04 一致）；</li>
     *   <li>两者都空 → 不过滤部门。</li>
     * </ul>
     */
    @Transactional(readOnly = true)
    public List<EmployeeVO> listAll(Long tenantId, String realName, Long deptId,
                                    List<Long> deptIds, List<Long> orgIds, Integer status) {
        // 向后兼容旧调用（不按手机号过滤）
        return listAll(tenantId, realName, null, deptId, deptIds, orgIds, status);
    }

    @Transactional(readOnly = true)
    public List<EmployeeVO> listAll(Long tenantId, String realName, String phone, Long deptId,
                                    List<Long> deptIds, List<Long> orgIds, Integer status) {
        // 组织集合 → 部门集合（经 sys_dept.org_id 反查，POST-03 精确匹配所选组织）
        Set<Long> orgDeptIds = null;
        if (orgIds != null && !orgIds.isEmpty()) {
            orgDeptIds = orgIds.stream()
                    .flatMap(orgId -> deptRepository.findByOrgId(orgId).stream())
                    .map(SysDept::getId)
                    .collect(Collectors.toSet());
        }
        // 直接部门集合：兼容单值 deptId + 多值 deptIds（并集）
        Set<Long> directDeptIds = null;
        if (deptIds != null && !deptIds.isEmpty()) {
            directDeptIds = new HashSet<>(deptIds);
            if (deptId != null) {
                directDeptIds.add(deptId);
            }
        } else if (deptId != null) {
            directDeptIds = Set.of(deptId);
        }
        // 默认交集：组织反查部门 ∩ 直接部门
        final Set<Long> allowedDeptIds;
        if (orgDeptIds != null && directDeptIds != null) {
            allowedDeptIds = orgDeptIds.stream().filter(directDeptIds::contains).collect(Collectors.toSet());
        } else if (orgDeptIds != null) {
            allowedDeptIds = orgDeptIds;
        } else if (directDeptIds != null) {
            allowedDeptIds = directDeptIds;
        } else {
            allowedDeptIds = null;
        }

        final Set<Long> allowed = allowedDeptIds;
        Specification<SysEmployee> spec = (root, query, cb) -> {
            List<jakarta.persistence.criteria.Predicate> ps = new ArrayList<>();
            ps.add(cb.equal(root.get("tenantId"), tenantId));
            if (org.springframework.util.StringUtils.hasText(realName)) {
                ps.add(cb.like(root.get("realName"), "%" + realName.trim() + "%"));
            }
            if (org.springframework.util.StringUtils.hasText(phone)) {
                ps.add(cb.equal(root.get("phone"), phone.trim()));
            }
            if (allowed != null) {
                ps.add(root.get("deptId").in(allowed));
            }
            if (status != null) {
                ps.add(cb.equal(root.get("status"), status));
            }
            return cb.and(ps.toArray(new jakarta.persistence.criteria.Predicate[0]));
        };
        return employeeRepository.findAll(spec).stream().map(this::toVo).toList();
    }

    @Transactional(readOnly = true)
    public Map<Long, String> namesByIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        return employeeRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(SysEmployee::getId, SysEmployee::getRealName, (a, b) -> a));
    }

    /**
     * 按精确手机号查员工（新建用户时检测是否已存在员工，Req2）。
     * 返回轻量视图（含主部门/组织名），便于前端提示"绑定/手动选择"。
     */
    @Transactional(readOnly = true)
    public List<EmployeePhoneMatchVO> listByPhone(Long tenantId, String phone) {
        if (!org.springframework.util.StringUtils.hasText(phone)) {
            return List.of();
        }
        List<SysEmployee> emps = employeeRepository.findAllByTenantIdAndPhone(tenantId, phone.trim());
        return emps.stream().map(this::toPhoneMatchVo).toList();
    }

    private EmployeePhoneMatchVO toPhoneMatchVo(SysEmployee emp) {
        String deptId = emp.getDeptId() != null ? String.valueOf(emp.getDeptId()) : null;
        String deptName = null;
        String orgName = null;
        if (emp.getDeptId() != null) {
            SysDept dept = deptRepository.findById(emp.getDeptId()).orElse(null);
            if (dept != null) {
                deptName = dept.getName();
                if (dept.getOrgId() != null) {
                    SysOrg org = orgRepository.findById(dept.getOrgId()).orElse(null);
                    orgName = org != null ? org.getName() : null;
                }
            }
        }
        List<EmployeePhoneMatchPostVO> posts = toMatchPostVos(emp);
        return new EmployeePhoneMatchVO(
                String.valueOf(emp.getId()),
                emp.getRealName(),
                deptId,
                deptName,
                orgName,
                posts);
    }

    /** 解析员工任职岗位（部门/组织/岗位名）用于「按手机查员工」绑定提示（Req2：展示岗位情况）。 */
    private List<EmployeePhoneMatchPostVO> toMatchPostVos(SysEmployee emp) {
        List<SysEmployeePost> activePosts = employeePostRepository.findByEmployeeIdAndStatus(emp.getId(), 1);
        if (activePosts.isEmpty()) {
            return List.of();
        }
        Set<Long> postIds = activePosts.stream().map(SysEmployeePost::getPostId).collect(Collectors.toSet());
        Map<Long, SysPost> postMap = postRepository.findAllById(postIds).stream()
                .collect(Collectors.toMap(SysPost::getId, p -> p, (a, b) -> a));
        Set<Long> involvedDeptIds = new HashSet<>();
        if (emp.getDeptId() != null) {
            involvedDeptIds.add(emp.getDeptId());
        }
        for (SysEmployeePost ep : activePosts) {
            SysPost p = postMap.get(ep.getPostId());
            if (p != null && p.getDeptId() != null) {
                involvedDeptIds.add(p.getDeptId());
            }
        }
        Map<Long, SysDept> deptMap = deptRepository.findAllById(involvedDeptIds).stream()
                .collect(Collectors.toMap(SysDept::getId, d -> d, (a, b) -> a));
        Map<Long, SysOrg> orgMap = orgRepository.findAllById(
                        deptMap.values().stream().map(SysDept::getOrgId).filter(Objects::nonNull).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(SysOrg::getId, o -> o, (a, b) -> a));
        return activePosts.stream()
                .map(ep -> {
                    SysPost p = postMap.get(ep.getPostId());
                    Long postDeptId = p != null ? p.getDeptId() : null;
                    return new EmployeePhoneMatchPostVO(
                            postDeptId != null ? String.valueOf(postDeptId) : null,
                            deptNameFromMap(postDeptId, deptMap),
                            orgNameOf(postDeptId, deptMap, orgMap),
                            String.valueOf(ep.getPostId()),
                            p != null ? p.getName() : null,
                            ep.getIsPrimary());
                })
                .toList();
    }

    @Transactional
    public EmployeeVO create(EmployeeCreateRequest request) {
        employeeRepository.findByTenantIdAndEmployeeNo(request.tenantId(), request.employeeNo())
                .ifPresent(e -> {
                    throw new BusinessException(ResultCode.EMPLOYEE_NO_EXISTS);
                });
        boolean builtin = request.isBuiltin() != null && request.isBuiltin() == 1;
        if (!builtin) {
            if (request.phone() == null || request.phone().isBlank()) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "请输入手机号");
            }
            if (employeeRepository.findByTenantIdAndPhone(request.tenantId(), request.phone()).isPresent()) {
                throw new BusinessException(ResultCode.EMPLOYEE_PHONE_EXISTS, "手机号 " + request.phone() + " 已存在");
            }
        }
        Long primaryDeptId = resolvePrimaryDept(request.deptId(), request.deptIds());
        requireDept(request.tenantId(), primaryDeptId);

        Instant now = Instant.now();
        SysEmployee emp = new SysEmployee();
        emp.setId(IdGenerator.nextId());
        emp.setTenantId(request.tenantId());
        emp.setDeptId(primaryDeptId);
        emp.setEmployeeNo(request.employeeNo());
        emp.setRealName(request.realName());
        emp.setEmail(request.email());
        emp.setPhone(request.phone());
        emp.setIsBuiltin(request.isBuiltin() != null ? request.isBuiltin() : 0);
        emp.setGender(request.gender());
        emp.setTitle(request.title());
        emp.setHireDate(request.hireDate());
        emp.setStatus(1);
        emp.setDeleted(0);
        emp.setCreatedAt(now);
        emp.setUpdatedAt(now);
        employeeRepository.save(emp);

        saveEmployeeDepts(emp.getTenantId(), emp.getId(), request.deptIds(), request.deptId(), now);
        saveEmployeePosts(emp.getTenantId(), emp.getId(), request.posts(), now);
        return toVo(emp);
    }

    @Transactional
    public EmployeeVO update(Long id, EmployeeUpdateRequest request) {
        SysEmployee emp = employeeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "员工不存在"));
        emp.setRealName(request.realName());
        boolean builtin = (emp.getIsBuiltin() != null && emp.getIsBuiltin() == 1)
                || (request.isBuiltin() != null && request.isBuiltin() == 1);
        if (request.phone() != null && !request.phone().isBlank() && !builtin) {
            if (employeeRepository.existsByTenantIdAndPhoneAndIdNot(emp.getTenantId(), request.phone(), emp.getId())) {
                throw new BusinessException(ResultCode.EMPLOYEE_PHONE_EXISTS, "手机号 " + request.phone() + " 已存在");
            }
        }
        if (request.isBuiltin() != null) {
            emp.setIsBuiltin(request.isBuiltin());
        }
        if (request.email() != null) {
            emp.setEmail(request.email());
        }
        if (request.phone() != null) {
            emp.setPhone(request.phone());
        }
        if (request.gender() != null) {
            emp.setGender(request.gender());
        }
        if (request.title() != null) {
            emp.setTitle(request.title());
        }
        if (request.status() != null) {
            emp.setStatus(request.status());
        }

        Instant now = Instant.now();
        List<Long> deptIds = request.deptIds();
        if (deptIds != null || request.deptId() != null) {
            Long primaryDeptId = resolvePrimaryDept(request.deptId(), deptIds);
            requireDept(emp.getTenantId(), primaryDeptId);
            emp.setDeptId(primaryDeptId);
            saveEmployeeDepts(emp.getTenantId(), emp.getId(), deptIds, request.deptId(), now);
        }
        if (request.posts() != null) {
            saveEmployeePosts(emp.getTenantId(), emp.getId(), request.posts(), now);
        }
        if (request.hireDate() != null) {
            emp.setHireDate(request.hireDate());
        }

        emp.setUpdatedAt(now);
        employeeRepository.save(emp);

        // Req4：员工姓名/手机/状态变更 → 反向同步绑定用户（禁用级联、恢复不级联）
        if (request.realName() != null || request.phone() != null || request.status() != null) {
            orgIamClient.syncByEmployee(emp.getId(), emp.getRealName(), emp.getPhone(), emp.getStatus());
        }
        return toVo(emp);
    }

    @Transactional
    public void delete(Long id) {
        SysEmployee emp = employeeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "员工不存在"));
        emp.setDeleted(1);
        emp.setUpdatedAt(Instant.now());
        employeeRepository.save(emp);
    }

    private Long resolvePrimaryDept(Long singleDeptId, List<Long> deptIds) {
        if (deptIds != null && !deptIds.isEmpty()) {
            return deptIds.get(0);
        }
        return Objects.requireNonNull(singleDeptId, "主部门不能为空");
    }

    /**
     * 全量覆盖任职部门。delete + flush 必须先于 INSERT，避免同事务撞 uk_emp_dept。
     */
    private void saveEmployeeDepts(Long tenantId, Long empId, List<Long> deptIds, Long fallbackDeptId, Instant now) {
        List<Long> ids = (deptIds != null && !deptIds.isEmpty())
                ? deptIds
                : (fallbackDeptId != null ? List.of(fallbackDeptId) : List.of());
        employeeDeptRepository.deleteByEmployeeId(empId);
        employeeDeptRepository.flush();
        List<SysEmployeeDept> rows = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) {
            SysEmployeeDept ed = new SysEmployeeDept();
            ed.setId(IdGenerator.nextId());
            ed.setTenantId(tenantId);
            ed.setEmployeeId(empId);
            ed.setDeptId(ids.get(i));
            ed.setIsPrimary(i == 0 ? 1 : 0);
            ed.setStatus(1);
            ed.setCreatedAt(now);
            rows.add(ed);
        }
        if (!rows.isEmpty()) {
            employeeDeptRepository.saveAll(rows);
        }
    }

    /**
     * 全量覆盖任职岗位。delete + flush 必须先于 INSERT，避免同事务撞 uk_emp_post
     *（Hibernate 可能把 INSERT 排在派生 DELETE 之前）。
     */
    private void saveEmployeePosts(Long tenantId, Long empId, List<EmployeePostItem> posts, Instant now) {
        if (posts == null) return;
        employeePostRepository.deleteByEmployeeId(empId);
        employeePostRepository.flush();
        List<SysEmployeePost> rows = new ArrayList<>();
        for (int i = 0; i < posts.size(); i++) {
            EmployeePostItem item = posts.get(i);
            SysEmployeePost ep = new SysEmployeePost();
            ep.setId(IdGenerator.nextId());
            ep.setTenantId(tenantId);
            ep.setEmployeeId(empId);
            ep.setPostId(item.postId());
            Integer isPrimary = item.isPrimary() != null ? item.isPrimary() : (i == 0 ? 1 : 0);
            ep.setIsPrimary(isPrimary);
            ep.setStartDate(item.startDate());
            ep.setStatus(1);
            ep.setCreatedAt(now);
            rows.add(ep);
        }
        if (!rows.isEmpty()) {
            employeePostRepository.saveAll(rows);
        }
    }

    private void requireDept(Long tenantId, Long deptId) {
        SysDept dept = deptRepository.findById(deptId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "部门不存在"));
        if (!tenantId.equals(dept.getTenantId())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "部门不属于该租户");
        }
        if (dept.getStatus() != null && dept.getStatus() == 0) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "部门已禁用");
        }
    }

    private EmployeeVO toVo(SysEmployee emp) {
        List<Long> deptIds = employeeDeptRepository.findActiveDeptIds(emp.getId());
        List<SysEmployeePost> activePosts = employeePostRepository.findByEmployeeIdAndStatus(emp.getId(), 1);
        // R1：一次性收集全部涉及部门（主部门 + 各任职部门），批量预取 dept / org，消除 N+1
        Set<Long> postIds = activePosts.stream().map(SysEmployeePost::getPostId).collect(Collectors.toSet());
        Map<Long, SysPost> postMap = postRepository.findAllById(postIds).stream()
                .collect(Collectors.toMap(SysPost::getId, p -> p, (a, b) -> a));
        Set<Long> involvedDeptIds = new HashSet<>();
        if (emp.getDeptId() != null) {
            involvedDeptIds.add(emp.getDeptId());
        }
        for (SysEmployeePost ep : activePosts) {
            SysPost p = postMap.get(ep.getPostId());
            if (p != null && p.getDeptId() != null) {
                involvedDeptIds.add(p.getDeptId());
            }
        }
        Map<Long, SysDept> deptMap = deptRepository.findAllById(involvedDeptIds).stream()
                .collect(Collectors.toMap(SysDept::getId, d -> d, (a, b) -> a));
        Set<Long> orgIdsSet = deptMap.values().stream()
                .map(SysDept::getOrgId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, SysOrg> orgMap = orgRepository.findAllById(orgIdsSet).stream()
                .collect(Collectors.toMap(SysOrg::getId, o -> o, (a, b) -> a));

        List<EmployeePostVO> postVos = activePosts.stream()
                .map(ep -> {
                    SysPost p = postMap.get(ep.getPostId());
                    Long postDeptId = p != null ? p.getDeptId() : null;
                    return new EmployeePostVO(
                            String.valueOf(ep.getPostId()),
                            p != null ? p.getName() : null,
                            postDeptId != null ? String.valueOf(postDeptId) : null,
                            deptNameFromMap(postDeptId, deptMap),
                            orgNameOf(postDeptId, deptMap, orgMap),
                            ep.getIsPrimary(),
                            ep.getStatus(),
                            ep.getStartDate() != null ? ep.getStartDate().toString() : null);
                })
                .toList();
        return new EmployeeVO(
                String.valueOf(emp.getId()),
                String.valueOf(emp.getTenantId()),
                String.valueOf(emp.getDeptId()),
                deptIds.stream().map(String::valueOf).toList(),
                String.valueOf(emp.getDeptId()),
                orgNameOf(emp.getDeptId(), deptMap, orgMap),
                postVos,
                emp.getEmployeeNo(),
                emp.getRealName(),
                emp.getEmail(),
                emp.getPhone(),
                emp.getGender(),
                emp.getTitle(),
                emp.getHireDate(),
                emp.getStatus(),
                emp.getIsBuiltin(),
                emp.getCreatedAt(),
                emp.getUpdatedAt());
    }

    /** 经批量 deptMap 取部门名（避免逐条查库）。 */
    private String deptNameFromMap(Long deptId, Map<Long, SysDept> deptMap) {
        if (deptId == null) return null;
        SysDept dept = deptMap.get(deptId);
        return dept != null ? dept.getName() : null;
    }

    /** 经 deptMap → orgMap 解析部门所属组织名；脏数据（dept.orgId 为 null 或 org 不在 orgMap）→ null。 */
    private String orgNameOf(Long deptId, Map<Long, SysDept> deptMap, Map<Long, SysOrg> orgMap) {
        if (deptId == null) return null;
        SysDept dept = deptMap.get(deptId);
        if (dept == null || dept.getOrgId() == null) return null;
        SysOrg org = orgMap.get(dept.getOrgId());
        return org != null ? org.getName() : null;
    }
}
