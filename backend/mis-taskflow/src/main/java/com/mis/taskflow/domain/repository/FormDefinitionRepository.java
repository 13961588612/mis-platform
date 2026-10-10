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

    List<FormDefinition> findByTenantIdAndParentIdAndDeletedOrderBySortOrderAscIdAsc(
            Long tenantId, Long parentId, Integer deleted);

    List<FormDefinition> findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(
            Long tenantId, Integer deleted);

    List<FormDefinition> findByTenantIdAndStatusAndDeletedOrderBySortOrderAscIdAsc(
            Long tenantId, String status, Integer deleted);

    /** 按 kind 过滤的平铺列表（决策 B：CATEGORY 仅取文件夹、FORM 仅取真实表单）。 */
    List<FormDefinition> findByTenantIdAndKindAndDeletedOrderByParentIdAscSortOrderAscIdAsc(
            Long tenantId, String kind, Integer deleted);

    /** 某分类（指定 kind）下未软删的子节点数——删除前校验用。 */
    long countByTenantIdAndKindAndParentIdAndDeleted(Long tenantId, String kind, Long parentId, Integer deleted);

    /**
     * 批量按 code 取未软删记录，用于流程定义保存时的白名单强校验（避免逐个查询）。
     */
    @Query("""
            select f from FormDefinition f
            where f.tenantId = :tenantId and f.deleted = 0 and f.code in :codes
            """)
    List<FormDefinition> findAliveByTenantIdAndCodes(@Param("tenantId") Long tenantId,
                                                      @Param("codes") Collection<String> codes);

    /** 某分类下未软删的子节点数——删除分类前校验用。 */
    long countByTenantIdAndParentIdAndDeleted(Long tenantId, Long parentId, Integer deleted);
}