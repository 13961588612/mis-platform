package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysEmployeeDept;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SysEmployeeDeptRepository extends JpaRepository<SysEmployeeDept, Long> {

    List<SysEmployeeDept> findByEmployeeIdAndStatus(Long employeeId, Integer status);

    List<SysEmployeeDept> findByDeptIdAndStatus(Long deptId, Integer status);

    @Query("SELECT ed.deptId FROM SysEmployeeDept ed WHERE ed.employeeId = :employeeId AND ed.status = 1")
    List<Long> findActiveDeptIds(@Param("employeeId") Long employeeId);

    /**
     * 全量覆盖任职部门前先物理删除。flush/clear 避免同事务再 INSERT 同一
     * (employee_id, dept_id) 时撞 {@code uk_emp_dept}。
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM SysEmployeeDept ed WHERE ed.employeeId = :employeeId")
    void deleteByEmployeeId(@Param("employeeId") Long employeeId);
}
