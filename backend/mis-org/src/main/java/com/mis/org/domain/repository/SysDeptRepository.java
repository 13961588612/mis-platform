package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysDept;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface SysDeptRepository extends JpaRepository<SysDept, Long> {

    List<SysDept> findByOrgIdAndStatus(Long orgId, Integer status);

    Optional<SysDept> findByTenantIdAndOrgIdAndCode(Long tenantId, Long orgId, String code);

    List<SysDept> findByOrgIdAndParentId(Long orgId, Long parentId);

    @Query("SELECT d.id FROM SysDept d WHERE d.orgId = ?1 AND d.ancestors LIKE %?2%")
    List<Long> findSubtreeIds(Long orgId, String ancestorLike);

    boolean existsByOrgIdAndParentId(Long orgId, Long parentId);

    boolean existsByDeptIdAndDeletedFalse(Long deptId);
}
