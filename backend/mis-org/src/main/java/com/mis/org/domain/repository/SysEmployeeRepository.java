package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysEmployee;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysEmployeeRepository extends JpaRepository<SysEmployee, Long> {

    Optional<SysEmployee> findByTenantIdAndEmployeeNo(Long tenantId, String employeeNo);

    List<SysEmployee> findByTenantIdAndDeptIdAndStatus(Long tenantId, Long deptId, Integer status);

    boolean existsByDeptId(Long deptId);
}
