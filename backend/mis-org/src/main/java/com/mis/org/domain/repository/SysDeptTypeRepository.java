package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysDeptType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysDeptTypeRepository extends JpaRepository<SysDeptType, Long> {

    List<SysDeptType> findByTenantIdAndStatus(Long tenantId, Integer status);

    /** 类型管理全量（含禁用）。 */
    List<SysDeptType> findByTenantId(Long tenantId);

    Optional<SysDeptType> findByTenantIdAndId(Long tenantId, Long id);

    /** 类型 code 唯一性校验。 */
    Optional<SysDeptType> findByTenantIdAndCode(Long tenantId, String code);

    /** 按父级 id 查子类型（构建树 + 防环/refreshLeaf 用）。 */
    List<SysDeptType> findByTenantIdAndParentId(Long tenantId, Long parentId);

    /** 判断某父级下是否还有子类型（refreshLeaf 真源）。 */
    boolean existsByTenantIdAndParentId(Long tenantId, Long parentId);
}
