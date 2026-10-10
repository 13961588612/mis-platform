package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.FormDefinition;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface FormDefinitionRepository extends JpaRepository<FormDefinition, Long> {

    /**
     * 按 code 精确取，<b>不过滤 deleted</b>。
     *
     * <p>{@code uk_form_def_tenant_code} 不带 {@code WHERE deleted = 0} ⇒ code 软删后不可复用，
     * 所以冲突判定必须看到软删行。
     */
    Optional<FormDefinition> findByTenantIdAndCode(Long tenantId, String code);

    Optional<FormDefinition> findByIdAndTenantIdAndDeleted(Long id, Long tenantId, Integer deleted);

    List<FormDefinition> findByTenantIdAndDeletedOrderBySortOrderAscIdAsc(Long tenantId, Integer deleted);

    List<FormDefinition> findByTenantIdAndStatusAndDeletedOrderBySortOrderAscIdAsc(
            Long tenantId, String status, Integer deleted);

    /** 按分类过滤的平铺列表（决策 B：分类是表单的属性，精确匹配 category_id）。 */
    List<FormDefinition> findByTenantIdAndCategoryIdAndDeletedOrderBySortOrderAscIdAsc(
            Long tenantId, Long categoryId, Integer deleted);

    /**
     * 按分类<b>集合</b>过滤的平铺列表（多选筛选：{@code category_id IN (...)}，即集合 IN 的 OR）。
     *
     * <p>精确匹配、<b>不含子分类</b>：分类是表单的属性（软引用），不存在父子继承语义。
     * 未分类（{@code category_id IS NULL}）不属于任何显式分类，故不会被本查询命中。
     */
    List<FormDefinition> findByTenantIdAndCategoryIdInAndDeletedOrderBySortOrderAscIdAsc(
            Long tenantId, Collection<Long> categoryIds, Integer deleted);

    /**
     * 批量按 code 取未软删记录，用于流程定义保存时的白名单强校验（避免逐个查询）。
     */
    @Query("""
            select f from FormDefinition f
            where f.tenantId = :tenantId and f.deleted = 0 and f.code in :codes
            """)
    List<FormDefinition> findAliveByTenantIdAndCodes(@Param("tenantId") Long tenantId,
                                                      @Param("codes") Collection<String> codes);
}
