package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.WfDefinition;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface WfDefinitionRepository extends JpaRepository<WfDefinition, Long> {

    Optional<WfDefinition> findByIdAndDeleted(Long id, Integer deleted);

    /** 取某编码下已发布的最新版本。 */
    Optional<WfDefinition> findFirstByTenantIdAndCodeAndStatusAndDeletedOrderByVersionDesc(
            Long tenantId, String code, String status, Integer deleted);

    List<WfDefinition> findByTenantIdAndDeletedOrderByUpdatedAtDesc(Long tenantId, Integer deleted);

    Page<WfDefinition> findByTenantIdAndDeleted(Long tenantId, Integer deleted, Pageable pageable);

    /** 按流程分类筛选（决策 B：categoryId 软引用，可空）。 */
    List<WfDefinition> findByTenantIdAndCategoryIdAndDeleted(Long tenantId, Long categoryId, Integer deleted);

    /**
     * 按流程分类<b>集合</b>筛选（多选：{@code category_id IN (...)}，即集合 IN 的 OR）。
     *
     * <p>精确匹配、不含子分类：categoryId 是属性（软引用 wf_category.id）。
     */
    List<WfDefinition> findByTenantIdAndCategoryIdInAndDeleted(
            Long tenantId, Collection<Long> categoryIds, Integer deleted);

    /**
     * 引用计数：白名单里含该 formCode 的流程定义数（含软删行）。
     *
     * <p>删除表单定义前必须查——{@code supported_form_codes} 是 TEXT[]，用 {@code = ANY(数组)} 判定。
     * 不过滤 deleted：软删的流程定义也可能是别人引用的历史证据，宁可多拒一次。
     */
    @Query(value = """
            select count(*) from wf_definition
            where tenant_id = :tenantId and :code = any(supported_form_codes)
            """, nativeQuery = true)
    long countBySupportedFormCode(@Param("tenantId") Long tenantId, @Param("code") String code);
}
