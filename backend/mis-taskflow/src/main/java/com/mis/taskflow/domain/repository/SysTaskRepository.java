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

    // ------------------------------------------------------------------
    // 发起人 / 参与人过滤片段（本轮新增；JPQL 跨实体相关子查询，本仓首次）
    // ------------------------------------------------------------------
    //
    // 两片段均以「:xxxPattern is null」开头 ⇒ 参数为 null 时整条子句恒真（零回归）。
    // 语义（设计 §4）：
    //   发起人 = 该 sys_task 所属实例的 initiator_name（经 wf_task.instance_id 反查）；
    //   参与人 = 该实例任一 wf_task 的处理人（wf_task.assignee_name），
    //            或其关联 sys_task 的处理人（wf_task.sys_task_id → sys_task.assignee_name）；
    //            之所以「或」上后者：ProcessService.assignNode 写 wfTask.setAssigneeName(null)
    //            ⇒ wf_task.assignee_name 实测恒空，纯靠它会「参与人过滤恒空」（主理人裁定#2）。
    //
    // ⚠️ wf_task.sys_task_id 无唯一约束 ⇒ 只出现在 exists/in 子查询内，绝不直接 JOIN sys_task。

    /**
     * 按处理人分页（可含 status 与 keyword 过滤；可选发起人/参与人过滤）。
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
              and t.taskType <> 'CC'
              and (:status is null or t.status = :status)
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
              and (:initiatorPattern is null
                   or exists (select 1 from WfInstance wi
                              where wi.id in (select wt.instanceId from WfTask wt where wt.sysTaskId = t.id)
                                and lower(coalesce(wi.initiatorName, '')) like :initiatorPattern))
              and (:participantPattern is null
                   or exists (select 1 from WfTask wt
                              where wt.instanceId in (select wt3.instanceId from WfTask wt3 where wt3.sysTaskId = t.id)
                                and ( lower(coalesce(wt.assigneeName, '')) like :participantPattern
                                      or exists (select 1 from SysTask st2
                                                 where st2.id = wt.sysTaskId
                                                   and lower(coalesce(st2.assigneeName, '')) like :participantPattern) )))
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findByAssignee(@Param("tenantId") Long tenantId,
                                 @Param("assigneeId") Long assigneeId,
                                 @Param("status") String status,
                                 @Param("pattern") String pattern,
                                 @Param("initiatorPattern") String initiatorPattern,
                                 @Param("participantPattern") String participantPattern,
                                 Pageable pageable);

    /**
     * 未完成待办分页（PENDING / APPROVING，可含 keyword 过滤；可选发起人/参与人过滤）。
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
              and t.taskType <> 'CC'
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
              and (:initiatorPattern is null
                   or exists (select 1 from WfInstance wi
                              where wi.id in (select wt.instanceId from WfTask wt where wt.sysTaskId = t.id)
                                and lower(coalesce(wi.initiatorName, '')) like :initiatorPattern))
              and (:participantPattern is null
                   or exists (select 1 from WfTask wt
                              where wt.instanceId in (select wt3.instanceId from WfTask wt3 where wt3.sysTaskId = t.id)
                                and ( lower(coalesce(wt.assigneeName, '')) like :participantPattern
                                      or exists (select 1 from SysTask st2
                                                 where st2.id = wt.sysTaskId
                                                   and lower(coalesce(st2.assigneeName, '')) like :participantPattern) )))
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findOpenByAssignee(@Param("tenantId") Long tenantId,
                                     @Param("assigneeId") Long assigneeId,
                                     @Param("pattern") String pattern,
                                     @Param("initiatorPattern") String initiatorPattern,
                                     @Param("participantPattern") String participantPattern,
                                     Pageable pageable);

    @Query("""
            select count(t) from SysTask t
            where t.tenantId = :tenantId and t.assigneeId = :assigneeId
              and t.deleted = 0 and t.status in ('PENDING', 'APPROVING')
              and t.taskType <> 'CC'
            """)
    long countPending(@Param("tenantId") Long tenantId, @Param("assigneeId") Long assigneeId);

    /**
     * 我处理过的（已通过 / 已驳回），按完成时间倒序——用于「我审批的」（可含 keyword 过滤；可选发起人/参与人过滤）。
     *
     * <p>{@code :pattern} 语义见 {@link #findOpenByAssignee}：null 时退化原查询。
     */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('APPROVED', 'REJECTED')
              and t.taskType <> 'CC'
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
              and (:initiatorPattern is null
                   or exists (select 1 from WfInstance wi
                              where wi.id in (select wt.instanceId from WfTask wt where wt.sysTaskId = t.id)
                                and lower(coalesce(wi.initiatorName, '')) like :initiatorPattern))
              and (:participantPattern is null
                   or exists (select 1 from WfTask wt
                              where wt.instanceId in (select wt3.instanceId from WfTask wt3 where wt3.sysTaskId = t.id)
                                and ( lower(coalesce(wt.assigneeName, '')) like :participantPattern
                                      or exists (select 1 from SysTask st2
                                                 where st2.id = wt.sysTaskId
                                                   and lower(coalesce(st2.assigneeName, '')) like :participantPattern) )))
            order by t.completedAt desc, t.createdAt desc
            """)
    Page<SysTask> findHandledByAssignee(@Param("tenantId") Long tenantId,
                                        @Param("assigneeId") Long assigneeId,
                                        @Param("pattern") String pattern,
                                        @Param("initiatorPattern") String initiatorPattern,
                                        @Param("participantPattern") String participantPattern,
                                        Pageable pageable);

    @Query("""
            select count(t) from SysTask t
            where t.tenantId = :tenantId and t.assigneeId = :assigneeId
              and t.deleted = 0 and t.status in ('PENDING', 'APPROVING')
              and t.taskType <> 'CC' and t.priority = 4
            """)
    long countUrgent(@Param("tenantId") Long tenantId, @Param("assigneeId") Long assigneeId);

    @Query("""
            select count(t) from SysTask t
            where t.tenantId = :tenantId and t.assigneeId = :assigneeId
              and t.deleted = 0 and t.status in ('PENDING', 'APPROVING')
              and t.taskType <> 'CC'
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
              and t.taskType <> 'CC'
              and (:status is null or t.status = :status)
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
              and (:initiatorPattern is null
                   or exists (select 1 from WfInstance wi
                              where wi.id in (select wt.instanceId from WfTask wt where wt.sysTaskId = t.id)
                                and lower(coalesce(wi.initiatorName, '')) like :initiatorPattern))
              and (:participantPattern is null
                   or exists (select 1 from WfTask wt
                              where wt.instanceId in (select wt3.instanceId from WfTask wt3 where wt3.sysTaskId = t.id)
                                and ( lower(coalesce(wt.assigneeName, '')) like :participantPattern
                                      or exists (select 1 from SysTask st2
                                                 where st2.id = wt.sysTaskId
                                                   and lower(coalesce(st2.assigneeName, '')) like :participantPattern) )))
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findByAssigneeAndApp(@Param("tenantId") Long tenantId,
                                       @Param("assigneeId") Long assigneeId,
                                       @Param("status") String status,
                                       @Param("pattern") String pattern,
                                       @Param("initiatorPattern") String initiatorPattern,
                                       @Param("participantPattern") String participantPattern,
                                       @Param("appCode") String appCode,
                                       Pageable pageable);

    /** 按处理人分页 + 平台级过滤（{@code scope=PLATFORM}）：等价 {@link #findByAssignee} 加 {@code and t.appCode is null}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.appCode is null
              and t.taskType <> 'CC'
              and (:status is null or t.status = :status)
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
              and (:initiatorPattern is null
                   or exists (select 1 from WfInstance wi
                              where wi.id in (select wt.instanceId from WfTask wt where wt.sysTaskId = t.id)
                                and lower(coalesce(wi.initiatorName, '')) like :initiatorPattern))
              and (:participantPattern is null
                   or exists (select 1 from WfTask wt
                              where wt.instanceId in (select wt3.instanceId from WfTask wt3 where wt3.sysTaskId = t.id)
                                and ( lower(coalesce(wt.assigneeName, '')) like :participantPattern
                                      or exists (select 1 from SysTask st2
                                                 where st2.id = wt.sysTaskId
                                                   and lower(coalesce(st2.assigneeName, '')) like :participantPattern) )))
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findByAssigneePlatform(@Param("tenantId") Long tenantId,
                                         @Param("assigneeId") Long assigneeId,
                                         @Param("status") String status,
                                         @Param("pattern") String pattern,
                                         @Param("initiatorPattern") String initiatorPattern,
                                         @Param("participantPattern") String participantPattern,
                                         Pageable pageable);

    /** 未完成待办分页 + 应用级过滤（{@code scope=APP}）：等价 {@link #findOpenByAssignee} 加 {@code and t.appCode = :appCode}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('PENDING', 'APPROVING')
              and t.taskType <> 'CC'
              and t.appCode = :appCode
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
              and (:initiatorPattern is null
                   or exists (select 1 from WfInstance wi
                              where wi.id in (select wt.instanceId from WfTask wt where wt.sysTaskId = t.id)
                                and lower(coalesce(wi.initiatorName, '')) like :initiatorPattern))
              and (:participantPattern is null
                   or exists (select 1 from WfTask wt
                              where wt.instanceId in (select wt3.instanceId from WfTask wt3 where wt3.sysTaskId = t.id)
                                and ( lower(coalesce(wt.assigneeName, '')) like :participantPattern
                                      or exists (select 1 from SysTask st2
                                                 where st2.id = wt.sysTaskId
                                                   and lower(coalesce(st2.assigneeName, '')) like :participantPattern) )))
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findOpenByAssigneeAndApp(@Param("tenantId") Long tenantId,
                                           @Param("assigneeId") Long assigneeId,
                                           @Param("pattern") String pattern,
                                           @Param("initiatorPattern") String initiatorPattern,
                                           @Param("participantPattern") String participantPattern,
                                           @Param("appCode") String appCode,
                                           Pageable pageable);

    /** 未完成待办分页 + 平台级过滤（{@code scope=PLATFORM}）：等价 {@link #findOpenByAssignee} 加 {@code and t.appCode is null}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('PENDING', 'APPROVING')
              and t.taskType <> 'CC'
              and t.appCode is null
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
              and (:initiatorPattern is null
                   or exists (select 1 from WfInstance wi
                              where wi.id in (select wt.instanceId from WfTask wt where wt.sysTaskId = t.id)
                                and lower(coalesce(wi.initiatorName, '')) like :initiatorPattern))
              and (:participantPattern is null
                   or exists (select 1 from WfTask wt
                              where wt.instanceId in (select wt3.instanceId from WfTask wt3 where wt3.sysTaskId = t.id)
                                and ( lower(coalesce(wt.assigneeName, '')) like :participantPattern
                                      or exists (select 1 from SysTask st2
                                                 where st2.id = wt.sysTaskId
                                                   and lower(coalesce(st2.assigneeName, '')) like :participantPattern) )))
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findOpenByAssigneePlatform(@Param("tenantId") Long tenantId,
                                             @Param("assigneeId") Long assigneeId,
                                             @Param("pattern") String pattern,
                                             @Param("initiatorPattern") String initiatorPattern,
                                             @Param("participantPattern") String participantPattern,
                                             Pageable pageable);

    /** 我处理过的 + 应用级过滤（{@code scope=APP}）：等价 {@link #findHandledByAssignee} 加 {@code and t.appCode = :appCode}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('APPROVED', 'REJECTED')
              and t.taskType <> 'CC'
              and t.appCode = :appCode
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
              and (:initiatorPattern is null
                   or exists (select 1 from WfInstance wi
                              where wi.id in (select wt.instanceId from WfTask wt where wt.sysTaskId = t.id)
                                and lower(coalesce(wi.initiatorName, '')) like :initiatorPattern))
              and (:participantPattern is null
                   or exists (select 1 from WfTask wt
                              where wt.instanceId in (select wt3.instanceId from WfTask wt3 where wt3.sysTaskId = t.id)
                                and ( lower(coalesce(wt.assigneeName, '')) like :participantPattern
                                      or exists (select 1 from SysTask st2
                                                 where st2.id = wt.sysTaskId
                                                   and lower(coalesce(st2.assigneeName, '')) like :participantPattern) )))
            order by t.completedAt desc, t.createdAt desc
            """)
    Page<SysTask> findHandledByAssigneeAndApp(@Param("tenantId") Long tenantId,
                                              @Param("assigneeId") Long assigneeId,
                                              @Param("pattern") String pattern,
                                              @Param("initiatorPattern") String initiatorPattern,
                                              @Param("participantPattern") String participantPattern,
                                              @Param("appCode") String appCode,
                                              Pageable pageable);

    /** 我处理过的 + 平台级过滤（{@code scope=PLATFORM}）：等价 {@link #findHandledByAssignee} 加 {@code and t.appCode is null}。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('APPROVED', 'REJECTED')
              and t.taskType <> 'CC'
              and t.appCode is null
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern
                   or lower(coalesce(t.assigneeName, '')) like :pattern)
              and (:initiatorPattern is null
                   or exists (select 1 from WfInstance wi
                              where wi.id in (select wt.instanceId from WfTask wt where wt.sysTaskId = t.id)
                                and lower(coalesce(wi.initiatorName, '')) like :initiatorPattern))
              and (:participantPattern is null
                   or exists (select 1 from WfTask wt
                              where wt.instanceId in (select wt3.instanceId from WfTask wt3 where wt3.sysTaskId = t.id)
                                and ( lower(coalesce(wt.assigneeName, '')) like :participantPattern
                                      or exists (select 1 from SysTask st2
                                                 where st2.id = wt.sysTaskId
                                                   and lower(coalesce(st2.assigneeName, '')) like :participantPattern) )))
            order by t.completedAt desc, t.createdAt desc
            """)
    Page<SysTask> findHandledByAssigneePlatform(@Param("tenantId") Long tenantId,
                                                @Param("assigneeId") Long assigneeId,
                                                @Param("pattern") String pattern,
                                                @Param("initiatorPattern") String initiatorPattern,
                                                @Param("participantPattern") String participantPattern,
                                                Pageable pageable);

    /**
     * 抄送我的：{@code taskType=CC}，按创建时间倒序（与待办/已办隔离）。
     */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.taskType = 'CC'
              and (:pattern is null
                   or lower(coalesce(t.bizTitle, '')) like :pattern
                   or lower(coalesce(t.bizType, '')) like :pattern
                   or lower(coalesce(t.bizRefId, '')) like :pattern)
            order by t.createdAt desc
            """)
    Page<SysTask> findCcByAssignee(@Param("tenantId") Long tenantId,
                                   @Param("assigneeId") Long assigneeId,
                                   @Param("pattern") String pattern,
                                   Pageable pageable);

    /**
     * 悲观行锁读取：处理 / 转办在同把行锁内完成 read-check-write（见 {@code TaskService.requireTask}）。
     *
     * <p>{@code PESSIMISTIC_WRITE} ⇒ {@code SELECT ... FOR UPDATE}，把并发处理串行化，
     * 避免「两人同时同意」或「转办竞态」。
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from SysTask t where t.id = :id")
    Optional<SysTask> findByIdForUpdate(@Param("id") Long id);
}
