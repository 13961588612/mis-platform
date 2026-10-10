package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.WfInstance;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface WfInstanceRepository extends JpaRepository<WfInstance, Long> {

    Optional<WfInstance> findByIdAndTenantId(Long id, Long tenantId);

    List<WfInstance> findByTenantIdAndBusinessTypeAndBusinessIdOrderByCreatedAtDesc(
            Long tenantId, String businessType, String businessId);

    /**
     * 我发起的流程分页（可含 status 与 keyword 过滤）。
     *
     * <p><b>keyword 为何传「已小写的 LIKE 模式」而非原始关键字</b>：原始写法
     * {@code lower(concat('%', :keyword, '%'))} 在 Hibernate 6 下存在参数类型推断缺陷——
     * 当同一查询里还有一个被绑成 null 的参数（如本方法的 {@code :status}）时，
     * 推断会把 {@code :keyword} 绑成 {@code bytea}，PostgreSQL 直接报
     * {@code function lower(bytea) does not exist}（这是 PR-04 引入的真实回归）。
     * 因此改由 Service 层预先算好 {@code "%"+keyword.toLowerCase()+"%"} 传入 {@code :pattern}，
     * {@code :pattern} 仅出现在 {@code like} 右侧、被 LIKE 约束为字符串，类型不再有歧义。
     *
     * <p>{@code :pattern} 为 {@code null} 时严格退化为原查询（不过滤，零回归）；
     * 非空时对 {@code business_id / business_type / definition_code / initiator_name}
     * 四列做大小写不敏感模糊匹配。
     */
    @Query("""
            select i from WfInstance i
            where i.tenantId = :tenantId
              and i.initiatorId = :initiatorId
              and (:status is null or i.status = :status)
              and (:pattern is null
                   or lower(coalesce(i.businessId, '')) like :pattern
                   or lower(coalesce(i.businessType, '')) like :pattern
                   or lower(coalesce(i.definitionCode, '')) like :pattern
                   or lower(coalesce(i.initiatorName, '')) like :pattern)
            order by i.createdAt desc
            """)
    Page<WfInstance> findByInitiator(@Param("tenantId") Long tenantId,
                                     @Param("initiatorId") Long initiatorId,
                                     @Param("status") String status,
                                     @Param("pattern") String pattern,
                                     Pageable pageable);

    /**
     * 引用计数：实际以该 formCode 启动过的实例数。
     *
     * <p>{@code started_form_code} 是无外键的字符串软引用——表单定义删除前必须查，
     * 否则历史实例的审批页会失去表单语义。
     */
    @Query("""
            select count(i) from WfInstance i
            where i.tenantId = :tenantId and i.startedFormCode = :code
            """)
    long countByStartedFormCode(@Param("tenantId") Long tenantId, @Param("code") String code);
}
