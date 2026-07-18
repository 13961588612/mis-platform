package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysEmployee;
import com.mis.org.domain.repository.SysEmployeeRepository;
import com.mis.org.dto.EmployeeCreateRequest;
import com.mis.org.dto.EmployeeUpdateRequest;
import com.mis.org.dto.EmployeeVO;
import com.mis.org.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Service
public class EmployeeService {

    private final SysEmployeeRepository employeeRepository;

    public EmployeeService(SysEmployeeRepository employeeRepository) {
        this.employeeRepository = employeeRepository;
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

    @Transactional
    public EmployeeVO create(EmployeeCreateRequest request) {
        employeeRepository.findByTenantIdAndEmployeeNo(request.tenantId(), request.employeeNo())
                .ifPresent(e -> { throw new BusinessException(ResultCode.USER_EXISTS, "工号已存在"); });

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
        emp.setCreatedAt(Instant.now());
        emp.setUpdatedAt(Instant.now());
        employeeRepository.save(emp);
        return toVo(emp);
    }

    @Transactional
    public EmployeeVO update(Long id, EmployeeUpdateRequest request) {
        SysEmployee emp = employeeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "员工不存在"));
        emp.setRealName(request.realName());
        if (request.email() != null) emp.setEmail(request.email());
        if (request.phone() != null) emp.setPhone(request.phone());
        if (request.gender() != null) emp.setGender(request.gender());
        if (request.title() != null) emp.setTitle(request.title());
        if (request.deptId() != null) emp.setDeptId(request.deptId());
        if (request.hireDate() != null) emp.setHireDate(request.hireDate());
        if (request.status() != null) emp.setStatus(request.status());
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
