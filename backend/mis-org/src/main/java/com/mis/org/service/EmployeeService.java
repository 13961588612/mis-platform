package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.jpa.datascope.DataScope;
import com.mis.common.jpa.datascope.DataScopeSpecification;
import com.mis.common.jpa.datascope.DataScopeSpecification.DataScopeContext;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysEmployee;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.dto.EmployeeCreateRequest;
import com.mis.org.dto.EmployeeUpdateRequest;
import com.mis.org.dto.EmployeeVO;
import com.mis.org.support.IdGenerator;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class EmployeeService {

    private final SysEmployeeRepository employeeRepository;
    private final SysDeptRepository deptRepository;
    private final DataScopeService dataScopeService;

    public EmployeeService(
            SysEmployeeRepository employeeRepository,
            SysDeptRepository deptRepository,
            DataScopeService dataScopeService) {
        this.employeeRepository = employeeRepository;
        this.deptRepository = deptRepository;
        this.dataScopeService = dataScopeService;
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

    @Transactional(readOnly = true)
    public Map<Long, String> namesByIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        return employeeRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(SysEmployee::getId, SysEmployee::getRealName, (a, b) -> a));
    }

    @Transactional
    public EmployeeVO create(EmployeeCreateRequest request) {
        employeeRepository.findByTenantIdAndEmployeeNo(request.tenantId(), request.employeeNo())
                .ifPresent(e -> {
                    throw new BusinessException(ResultCode.EMPLOYEE_NO_EXISTS);
                });
        requireDept(request.tenantId(), request.deptId());

        Instant now = Instant.now();
        SysEmployee emp = new SysEmployee();
        emp.setId(IdGenerator.nextId());
        emp.setTenantId(request.tenantId());
        emp.setDeptId(request.deptId());
        emp.setEmployeeNo(request.employeeNo());
        emp.setRealName(request.realName());
        emp.setEmail(request.email());
        emp.setPhone(request.phone());
        emp.setGender(request.gender());
        emp.setTitle(request.title());
        emp.setHireDate(request.hireDate());
        emp.setStatus(1);
        emp.setDeleted(0);
        emp.setCreatedAt(now);
        emp.setUpdatedAt(now);
        employeeRepository.save(emp);
        return toVo(emp);
    }

    @Transactional
    public EmployeeVO update(Long id, EmployeeUpdateRequest request) {
        SysEmployee emp = employeeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "员工不存在"));
        emp.setRealName(request.realName());
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
        if (request.deptId() != null) {
            requireDept(emp.getTenantId(), request.deptId());
            emp.setDeptId(request.deptId());
        }
        if (request.hireDate() != null) {
            emp.setHireDate(request.hireDate());
        }
        if (request.status() != null) {
            emp.setStatus(request.status());
        }
        emp.setUpdatedAt(Instant.now());
        employeeRepository.save(emp);
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
        return new EmployeeVO(
                String.valueOf(emp.getId()),
                String.valueOf(emp.getTenantId()),
                String.valueOf(emp.getDeptId()),
                emp.getEmployeeNo(),
                emp.getRealName(),
                emp.getEmail(),
                emp.getPhone(),
                emp.getGender(),
                emp.getTitle(),
                emp.getHireDate(),
                emp.getStatus(),
                emp.getCreatedAt(),
                emp.getUpdatedAt());
    }
}
