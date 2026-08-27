package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysOrg;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysOrgRepository extends JpaRepository<SysOrg, Long> {

    Optional<SysOrg> findByTenantIdAndCode(Long tenantId, String code);

    List<SysOrg> findByTenantIdAndStatus(Long tenantId, Integer status);

    /** V40 新增：租户全量组织（环路 BFS 用，含禁用，仅排除软删）。 */
    List<SysOrg> findByTenantId(Long tenantId);

    /** V40 新增：是否存在以 parentId 为父的组织（组织删除约束用）。 */
    boolean existsByParentId(Long parentId);

    long countByTenantId(Long tenantId);
}
