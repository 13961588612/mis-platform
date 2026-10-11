package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.SysTask;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.Optional;

public interface SysTaskRepository extends JpaRepository<SysTask, Long> {

    Optional<SysTask> findByIdAndDeleted(Long id, Integer deleted);

    /**
     * 悲观写锁读取单条待办——处理（act）与转办（transfer）共用同一把行锁。
     *
     * <p><b>为什么不用 {@code @Version} 乐观锁</b>：冲突抛 {@code OptimisticLockingFailureException}，
     * 语义是「你失败了」而非「已被他人处理」，需要额外映射才能给前端正确提示，且要加迁移列。
     *
     * <p><b>为什么不用 DistributedLockService</b>：它是 Redis 轮询实现，
     * {@code POLL_TIMEOUT=60s}，用户点「同意」要等 60 秒不可接受。
     *
     * <p>刻意<b>不</b>把 {@code tenantId} 放进 where 条件：跨租户访问要能区分
     * 「不存在」（NOT_FOUND）与「无权限」（FORBIDDEN），故租户与 assignee 校验在 Service 层做。
     *
     * <p>行锁在事务提交/回滚时释放，事务边界由 {@code @Transactional} 方法承担。
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from SysTask t where t.id = :id and t.deleted = 0")
    Optional<SysTask> findByIdForUpdate(@Param("id") Long id);

    /**
     * 按处理人分页（可含 status 与 keyword 过滤）。
     *
     * <p><b>keyword 过滤为何传「已小写的 LIKE 模式」而非原始关键字</b>：见
     * {@link #findOpenByAssignee} 的类注释说明——{@code lower(concat('%', :keyword, '%'))}
     * 在 Hibernate 6 下会因参数类型推断把 null 关键字绑成 {@code bytea}，触发
     * {@code lower(bytea) does not exist}。故由 Service 层预先算好
     * {@code "%"+keyword.toLowerCase()+"%"} 直接作为 {@code :pattern} 传入，
     * {@code :pattern} 仅出现在 {@code like} 右侧（被 LIKE 约束为字符串），类型无歧义。
     */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and (:status is null or t.status = :status)
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findByAssignee(@Param("tenantId") Long tenantId,
                                 @Param("assigneeId") Long assigneeId,
                                 @Param("status") String status,
                                 @Param("pattern") String pattern,
                                 Pageable pageable);

    /**
     * 未完成待办分页（PENDING / APPROVING，可含 keyword 过滤）。
     *
     * <p>{@code :pattern} 为 {@code null} 时严格退化为原查询（不过滤，零回归）；
     * 非空时对 {@code biz_title / biz_type / biz_ref_id / assignee_name} 四列做大小写不敏感模糊匹配。
     */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('PENDING', 'APPROVING')
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findOpenByAssignee(@Param("tenantId") Long tenantId,
                                     @Param("assigneeId") Long assigneeId,
                                     @Param("pattern") String pattern,
                                     Pageable pageable);

    @Query("""
            select count(t) from SysTask t
            where t.tenantId = :tenantId and t.assigneeId = :assigneeId
              and t.deleted = 0 and t.status in ('PENDING', 'APPROVING')
            """)
    long countPending(@Param("tenantId") Long tenantId, @Param("assigneeId") Long assigneeId);

    /**
     * 我处理过的（已通过 / 已驳回），按完成时间倒序——用于「我审批的」（可含 keyword 过滤）。
     *
     * <p>{@code :pattern} 语义见 {@link #findOpenByAssignee}：null 时退化原查询。
     */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('APPROVED', 'REJECTED')
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
            order by t.completedAt desc, t.createdAt desc
            """)
    Page<SysTask> findHandledByAssignee(@Param("tenantId") Long tenantId,
                                        @Param("assigneeId") Long assigneeId,
                                        @Param("pattern") String pattern,
                                        Pageable pageable);

    @Query("""
            select count(t) from SysTask t
            where t.tenantId = :tenantId and t.assigneeId = :assigneeId
              and t.deleted = 0 and t.status in ('PENDING', 'APPROVING') and t.priority = 4
            """)
    long countUrgent(@Param("tenantId") Long tenantId, @Param("assigneeId") Long assigneeId);

    @Query("""
            select count(t) from SysTask t
            where t.tenantId = :tenantId and t.assigneeId = :assigneeId
              and t.deleted = 0 and t.status in ('PENDING', 'APPROVING')
              and t.dueDate is not null and t.dueDate < :now
            """)
    long countOverdue(@Param("tenantId") Long tenantId,
                      @Param("assigneeId") Long assigneeId,
                      @Param("now") LocalDateTime now);

    // ------------------------------------------------------------------
    // 应用归属过滤（P0）：scope=APP / PLATFORM 各拆独立方法
    // ------------------------------------------------------------------
    //
    // ⚠️ 刻意**不**把 appCode 写成 `(:appCode is null or t.appCode = :appCode)` 的单条查询：
    //    本仓既有事故（Hibernate 6 参数类型推断把 null 参绑成 bytea，PostgreSQL 报
    //    `lower(bytea) does not exist` / `could not determine data type of parameter`）。
    //    拆成「无条件等值 `t.appCode = :appCode`」与「`t.appCode is null`」两条，
    //    :appCode 仅出现在等值比较处、类型由 varchar 列锚定，零歧义；ALL 直接复用原方法。

    /** 按处理人分页 + 应用级过滤（{@code scope=APP}）：等价 {@link #findByAssignee} 加 {@code and t.appCode = :appCode}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.appCode = :appCode
              and (:status is null or t.status = :status)
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findByAssigneeAndApp(@Param("tenantId") Long tenantId,
                                       @Param("assigneeId") Long assigneeId,
                                       @Param("status") String status,
                                       @Param("pattern") String pattern,
                                       @Param("appCode") String appCode,
                                       Pageable pageable);

    /** 按处理人分页 + 平台级过滤（{@code scope=PLATFORM}）：等价 {@link #findByAssignee} 加 {@code and t.appCode is null}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.appCode is null
              and (:status is null or t.status = :status)
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findByAssigneePlatform(@Param("tenantId") Long tenantId,
                                         @Param("assigneeId") Long assigneeId,
                                         @Param("status") String status,
                                         @Param("pattern") String pattern,
                                         Pageable pageable);

    /** 未完成待办分页 + 应用级过滤（{@code scope=APP}）：等价 {@link #findOpenByAssignee} 加 {@code and t.appCode = :appCode}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('PENDING', 'APPROVING')
              and t.appCode = :appCode
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findOpenByAssigneeAndApp(@Param("tenantId") Long tenantId,
                                           @Param("assigneeId") Long assigneeId,
                                           @Param("pattern") String pattern,
                                           @Param("appCode") String appCode,
                                           Pageable pageable);

    /** 未完成待办分页 + 平台级过滤（{@code scope=PLATFORM}）：等价 {@link #findOpenByAssignee} 加 {@code and t.appCode is null}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('PENDING', 'APPROVING')
              and t.appCode is null
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findOpenByAssigneePlatform(@Param("tenantId") Long tenantId,
                                             @Param("assigneeId") Long assigneeId,
                                             @Param("pattern") String pattern,
                                             Pageable pageable);

    /** 我处理过的 + 应用级过滤（{@code scope=APP}）：等价 {@link #findHandledByAssignee} 加 {@code and t.appCode = :appCode}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('APPROVED', 'REJECTED')
              and t.appCode = :appCode
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
            order by t.completedAt desc, t.createdAt desc
            """)
    Page<SysTask> findHandledByAssigneeAndApp(@Param("tenantId") Long tenantId,
                                              @Param("assigneeId") Long assigneeId,
                                              @Param("pattern") String pattern,
                                              @Param("appCode") String appCode,
                                              Pageable pageable);

    /** 我处理过的 + 平台级过滤（{@code scope=PLATFORM}）：等价 {@link #findHandledByAssignee} 加 {@code and t.appCode is null}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('APPROVED', 'REJECTED')
              and t.appCode is null
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
            order by t.completedAt desc, t.createdAt desc
            """)
    Page<SysTask> findHandledByAssigneePlatform(@Param("tenantId") Long tenantId,
                                                @Param("assigneeId") Long assigneeId,
                                                @Param("pattern") String pattern,
                                                Pageable pageable);
}
