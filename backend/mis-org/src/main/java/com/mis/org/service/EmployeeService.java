package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDept;
import com.mis.org.domain.entity.SysEmployee;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.dto.EmployeeCreateRequest;
import com.mis.org.dto.EmployeeUpdateRequest;
import com.mis.org.dto.EmployeeVO;
import com.mis.org.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class EmployeeService {

    private final SysEmployeeRepository employeeRepository;
    private final SysDeptRepository deptRepository;

    public EmployeeService(SysEmployeeRepository employeeRepository, SysDeptRepository deptRepository) {
        this.employeeRepository = employeeRepository;
        this.deptRepository = deptRepository;
    }

    @Transactional(readOnly = true)
    public EmployeeVO getById(Long id) {
        SysEmployee emp = employeeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "员工不存在"));
        return toVo(emp);
    }

    @Transactional(readOnly = true)
    public List<EmployeeVO> listByDept(Long tenantId, Long deptId) {
        return employeeRepository.findByTenantIdAndDeptIdAndStatus(tenantId, deptId, 1).stream()
                .map(this::toVo)
                .toList();
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
        // 关联 sys_user 的校验由 mis-iam 侧在删账号前约束；此处仅软删员工主数据
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
