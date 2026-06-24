package com.mis.auth.domain.repository;

import com.mis.auth.domain.entity.SysEmployee;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SysEmployeeRepository extends JpaRepository<SysEmployee, Long> {
}
