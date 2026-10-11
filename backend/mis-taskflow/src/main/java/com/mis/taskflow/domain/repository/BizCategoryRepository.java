package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.BizCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/**
 * 统一「业务分类」邻接树仓储。
 *
 * <p>两个跨表引用计数（软引用无外键，只能在这里挡「分类被定义引用时禁止删除」）：
 * <ul>
 *   <li>{@link #countWfDefinitionsByCategoryId} —— {@code wf_definition}（流程定义）。</li>
 *   <li>{@link #countFormDefinitionsByCategoryId} —— {@code form_definition}（表单定义）。</li>
 * </ul>
 */
public interface BizCategoryRepository extends JpaRepository<BizCategory, Long> {

    Optional<BizCategory> findByIdAndTenantIdAndDeleted(Long id, Long tenantId, Integer deleted);

    /** 按 code 精确取，<b>不过滤 deleted</b>（uk_biz_category_tenant_code 不带 WHERE deleted=0，软删后不可复用）。 */
    Optional<BizCategory> findByTenantIdAndCode(Long tenantId, String code);

    List<BizCategory> findByTenantIdAndDeletedOrderByParentIdAscSortOrderAscIdAsc(
            Long tenantId, Integer deleted);

    /** 某分类下未软删的子节点数——删除前校验用。 */
    long countByTenantIdAndParentIdAndDeleted(Long tenantId, Long parentId, Integer deleted);

    /**
     * 引用计数：{@code wf_definition} 中 {@code category_id = :categoryId 且未软删} 的行数。
     */
    @Query(value = """
            select count(*) from wf_definition
            where tenant_id = :tenantId and category_id = :categoryId and deleted = 0
            """, nativeQuery = true)
    long countWfDefinitionsByCategoryId(@Param("tenantId") Long tenantId,
                                        @Param("categoryId") Long categoryId);

    /**
     * 引用计数：{@code form_definition} 中 {@code category_id = :categoryId 且未软删} 的行数。
     */
    @Query(value = """
            select count(*) from form_definition
            where tenant_id = :tenantId and category_id = :categoryId and deleted = 0
            """, nativeQuery = true)
    long countFormDefinitionsByCategoryId(@Param("tenantId") Long tenantId,
                                          @Param("categoryId") Long categoryId);
}
