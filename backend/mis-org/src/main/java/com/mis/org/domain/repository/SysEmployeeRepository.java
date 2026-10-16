package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysEmployee;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SysEmployeeRepository extends JpaRepository<SysEmployee, Long>, JpaSpecificationExecutor<SysEmployee> {

    Optional<SysEmployee> findByTenantIdAndEmployeeNo(Long tenantId, String employeeNo);

    Optional<SysEmployee> findByTenantIdAndPhone(Long tenantId, String phone);

    List<SysEmployee> findAllByTenantIdAndPhone(Long tenantId, String phone);

    boolean existsByTenantIdAndPhoneAndIdNot(Long tenantId, String phone, Long id);

    List<SysEmployee> findByTenantIdAndDeptIdAndStatus(Long tenantId, Long deptId, Integer status);

    boolean existsByDeptId(Long deptId);

    /** 主部门或任职部门命中，且员工启用。 */
    @Query("""
            SELECT DISTINCT e.id FROM SysEmployee e
            WHERE e.tenantId = :tenantId AND e.status = 1
              AND (e.deptId IN :deptIds OR e.id IN (
                    SELECT ed.employeeId FROM SysEmployeeDept ed
                    WHERE ed.status = 1 AND ed.deptId IN :deptIds))
            """)
    List<Long> findActiveIdsInDepts(@Param("tenantId") Long tenantId, @Param("deptIds") Collection<Long> deptIds);
}
