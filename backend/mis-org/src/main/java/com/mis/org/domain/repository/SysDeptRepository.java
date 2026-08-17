package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysDept;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SysDeptRepository extends JpaRepository<SysDept, Long> {

    List<SysDept> findByOrgIdAndStatus(Long orgId, Integer status);

    List<SysDept> findByOrgId(Long orgId);

    /**
     * 按组织 + 是否根部门查询（规则 1.4 / 1.5：取某组织的顶级根部门，做名称/状态同步）。
     */
    Optional<SysDept> findByOrgIdAndIsRoot(Long orgId, Integer isRoot);

    Optional<SysDept> findByTenantIdAndOrgIdAndCode(Long tenantId, Long orgId, String code);

    List<SysDept> findByOrgIdAndParentId(Long orgId, Long parentId);

    /**
     * 子孙部门 ID（不含自身）：ancestors 路径中包含指定部门 ID。
     *
     * @param deptIdStr 部门 ID 的十进制字符串
     */
    @Query("""
            SELECT d.id FROM SysDept d
            WHERE d.orgId = :orgId
              AND CONCAT(',', d.ancestors, ',') LIKE CONCAT('%,', :deptIdStr, ',%')
            """)
    List<Long> findDescendantIds(@Param("orgId") Long orgId, @Param("deptIdStr") String deptIdStr);

    boolean existsByOrgIdAndParentId(Long orgId, Long parentId);

    /** V40 新增：组织下是否存在部门（组织删除约束用）。 */
    boolean existsByOrgId(Long orgId);
}
