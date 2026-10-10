package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.FormCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/**
 * 表单分类邻接树仓储（决策 B：与表单定义拆分为两张表）。
 *
 * <p>{@code countByTenantIdAndCategoryIdAndDeleted} 是跨表计数：统计 {@code form_definition}
 * 中引用了某分类的未软删行数（用于删除分类前的引用校验）。
 */
public interface FormCategoryRepository extends JpaRepository<FormCategory, Long> {

    Optional<FormCategory> findByIdAndTenantIdAndDeleted(Long id, Long tenantId, Integer deleted);

    /** 按 code 精确取，<b>不过滤 deleted</b>（uk_form_category_tenant_code 不带 WHERE deleted=0，软删后不可复用）。 */
    Optional<FormCategory> findByTenantIdAndCode(Long tenantId, String code);

    List<FormCategory> findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(
            Long tenantId, Integer deleted);

    /** 某分类下未软删的子节点数——删除前校验用。 */
    long countByTenantIdAndParentIdAndDeleted(Long tenantId, Long parentId, Integer deleted);

    /**
     * 引用计数：{@code form_definition} 中 {@code category_id = :categoryId 且未软删} 的行数。
     *
     * <p>软引用无外键约束，只能在这里挡「分类下有表单时禁止删除」。
     */
    @org.springframework.data.jpa.repository.Query(value = """
            select count(*) from form_definition
            where tenant_id = :tenantId and category_id = :categoryId and deleted = 0
            """, nativeQuery = true)
    long countByTenantIdAndCategoryIdAndDeleted(@Param("tenantId") Long tenantId,
                                                @Param("categoryId") Long categoryId);
}
