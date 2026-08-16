package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysPostType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysPostTypeRepository extends JpaRepository<SysPostType, Long> {

    List<SysPostType> findByTenantIdAndStatus(Long tenantId, Integer status);

    /** V40 新增：类型管理全量（含禁用）。 */
    List<SysPostType> findByTenantId(Long tenantId);

    Optional<SysPostType> findByTenantIdAndId(Long tenantId, Long id);

    /** V40 新增：类型 code 唯一性校验。 */
    Optional<SysPostType> findByTenantIdAndCode(Long tenantId, String code);

    /** V47 多层化：按父级 id 查子类型（构建树 + 防环/refreshLeaf 用）。 */
    List<SysPostType> findByTenantIdAndParentId(Long tenantId, Long parentId);

    /** V47 多层化：判断某父级下是否还有子类型（refreshLeaf 真源）。 */
    boolean existsByTenantIdAndParentId(Long tenantId, Long parentId);
}
