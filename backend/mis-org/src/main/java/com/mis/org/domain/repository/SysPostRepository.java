package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysPost;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysPostRepository extends JpaRepository<SysPost, Long> {

    List<SysPost> findByDeptIdAndStatus(Long deptId, Integer status);

    List<SysPost> findByTenantId(Long tenantId);

    boolean existsByDeptId(Long deptId);

    boolean existsByTenantIdAndCode(Long tenantId, String code);

    boolean existsByTenantIdAndCodeAndIdNot(Long tenantId, String code, Long id);

    /** V40 新增：岗位类型引用计数（实体 @SQLRestriction deleted=0 覆盖）。 */
    long countByPostTypeId(Long postTypeId);
}
