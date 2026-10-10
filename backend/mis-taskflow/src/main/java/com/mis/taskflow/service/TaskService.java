package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.SysTask;
import com.mis.taskflow.domain.repository.SysTaskRepository;
import com.mis.taskflow.dto.BatchHandleTaskRequest;
import com.mis.taskflow.dto.CreateTaskRequest;
import com.mis.taskflow.dto.HandleTaskRequest;
import com.mis.taskflow.dto.PublishMessageRequest;
import com.mis.taskflow.dto.TaskStatsVO;
import com.mis.taskflow.dto.TaskVO;
import com.mis.taskflow.dto.TransferTaskRequest;
import com.mis.taskflow.support.AuditContext;
import com.mis.taskflow.support.BusinessOperation;
import com.mis.taskflow.support.IdGenerator;
import com.mis.taskflow.support.TaskflowStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;

/**
 * 代办任务中心（P3）。
 *
 * <p>与消息中心协作：创建代办时可自动生成一条关联通知（{@code reference_task_id}）；
 * 处理代办时联动更新其关联消息状态。业务引用仅存于本表，无桥接表。
 */
@Service
public class TaskService {

    private final SysTaskRepository taskRepository;
    private final MessageService messageService;

    public TaskService(SysTaskRepository taskRepository, MessageService messageService) {
        this.taskRepository = taskRepository;
        this.messageService = messageService;
    }

    /**
     * 创建代办（可选自动生成关联通知消息）。
     *
     * @return 任务 ID
     */
    @Transactional
    public Long createTask(Long tenantId, Long operatorId, CreateTaskRequest req) {
        LocalDateTime now = LocalDateTime.now();
        Long taskId = IdGenerator.nextId();

        SysTask task = new SysTask();
        task.setId(taskId);
        task.setTenantId(tenantId);
        task.setTaskType(req.taskType().trim());
        task.setBizType(req.bizType().trim());
        task.setBizRefId(req.bizRefId().trim());
        task.setBizTitle(req.bizTitle().trim());
        task.setTargetEntity(trimToNull(req.targetEntity()));
        task.setAssigneeId(req.assigneeId());
        task.setAssigneeName(trimToNull(req.assigneeName()));
        task.setStatus(TaskflowStatus.Task.PENDING);
        task.setPriority(req.priority() == null ? (short) 1 : req.priority());
        task.setDueDate(req.dueDate());
        task.setMetadata(StringUtils.hasText(req.metadata()) ? req.metadata() : "{}");
        task.setRead(Boolean.FALSE);
        task.setCreatedBy(operatorId);
        task.setCreatedAt(now);
        task.setUpdatedAt(now);
        taskRepository.save(task);

        if (StringUtils.hasText(req.notifyTitle())) {
            PublishMessageRequest msg = new PublishMessageRequest(
                    "APPROVAL", "TASK", req.notifyTitle().trim(), trimToNull(req.notifySummary()),
                    null, null, operatorId, null, List.of(req.assigneeId()), taskId, null);
            messageService.publish(tenantId, msg);
        }

        return taskId;
    }

    /**
     * 我的待办分页（默认仅未完成）。
     */
    @Transactional(readOnly = true)
    public PageResult<TaskVO> myTasks(Long tenantId, Long assigneeId, String status, int page, int size) {
        return myTasks(tenantId, assigneeId, status, page, size, null);
    }

    /**
     * 我的待办分页（可含 keyword 模糊过滤，PR-04）。
     *
     * <p>{@code keyword} 命中 {@code biz_title} / {@code biz_type} / {@code biz_ref_id} /
     * {@code assignee_name}；为 {@code null}/空时退化为原查询（零回归）。
     */
    @Transactional(readOnly = true)
    public PageResult<TaskVO> myTasks(Long tenantId, Long assigneeId, String status,
                                      int page, int size, String keyword) {
        Pageable pageable = PageRequest.of(Math.max(page - 1, 0), clampSize(size));
        String pattern = likePattern(keyword);
        Page<SysTask> p = StringUtils.hasText(status)
                ? taskRepository.findByAssignee(tenantId, assigneeId, status.trim(), pattern, pageable)
                : taskRepository.findOpenByAssignee(tenantId, assigneeId, pattern, pageable);
        return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(),
                p.getContent().stream().map(this::toVo).toList());
    }

    /**
     * 我处理过的（已通过 / 已驳回），按完成时间倒序。
     */
    @Transactional(readOnly = true)
    public PageResult<TaskVO> handledTasks(Long tenantId, Long assigneeId, int page, int size) {
        return handledTasks(tenantId, assigneeId, page, size, null);
    }

    /**
     * 我处理的（handled）分页（可含 keyword 模糊过滤，PR-04）。
     */
    @Transactional(readOnly = true)
    public PageResult<TaskVO> handledTasks(Long tenantId, Long assigneeId, int page, int size, String keyword) {
        Pageable pageable = PageRequest.of(Math.max(page - 1, 0), clampSize(size));
        Page<SysTask> p = taskRepository.findHandledByAssignee(tenantId, assigneeId, likePattern(keyword), pageable);
        return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(),
                p.getContent().stream().map(this::toVo).toList());
    }

    /**
     * 处理代办：APPROVE / REJECT / COMPLETE。
     *
     * <p>幂等：仅当任务处于 OPEN（PENDING/APPROVING）时才生效；重复处理返回业务异常。
     */
    @Transactional
    @BusinessOperation(module = "代办任务", type = "APPROVE",
            businessType = "SYS_TASK", description = "处理代办任务",
            captureBefore = true, captureAfter = true)
    public void handleTask(Long tenantId, Long taskId, HandleTaskRequest req, Long operatorId) {
        SysTask task = requireTask(taskId, tenantId, operatorId);
        if (!isOpen(task.getStatus())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "该代办已处理，无法重复操作");
        }

        String action = req.action().trim().toUpperCase();
        String nextStatus = switch (action) {
            case "APPROVE", "COMPLETE" -> TaskflowStatus.Task.APPROVED;
            case "REJECT" -> TaskflowStatus.Task.REJECTED;
            default -> throw new BusinessException(ResultCode.VALIDATION_ERROR, "不支持的操作: " + action);
        };

        AuditContext.businessId(task.getBizType() + "/" + task.getBizRefId());
        AuditContext.before("{\"status\":\"" + task.getStatus() + "\"}");

        LocalDateTime now = LocalDateTime.now();
        task.setStatus(nextStatus);
        task.setResult(buildResult(req));
        task.setCompletedAt(now);
        task.setUpdatedAt(now);
        taskRepository.save(task);

        AuditContext.after("{\"status\":\"" + nextStatus + "\"}");

        syncLinkedMessagesToHandled(taskId);
    }

    /**
     * 转办：变更处理人，任务回到 PENDING。
     *
     * <p><b>为什么必须审计</b>：转办把责任从一个人移交到另一个人，是「责任归属」变更；
     * 无痕转办等于允许私下甩锅，必须留 before/after 的处理人差异。
     */
    @Transactional
    @BusinessOperation(module = "代办任务", type = "ASSIGN",
            businessType = "SYS_TASK", description = "转办代办任务",
            captureBefore = true, captureAfter = true)
    public void transferTask(Long tenantId, Long taskId, TransferTaskRequest req, Long operatorId) {
        SysTask task = requireTask(taskId, tenantId, operatorId);
        if (!isOpen(task.getStatus())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "该代办已处理，无法转办");
        }

        AuditContext.businessId(task.getBizType() + "/" + task.getBizRefId());
        AuditContext.before("{\"assigneeId\":" + task.getAssigneeId()
                + ",\"status\":\"" + task.getStatus() + "\"}");

        task.setAssigneeId(req.newAssigneeId());
        task.setAssigneeName(trimToNull(req.newAssigneeName()));
        task.setStatus(TaskflowStatus.Task.PENDING);
        task.setRead(Boolean.FALSE);
        task.setViewedAt(null);
        task.setUpdatedAt(LocalDateTime.now());
        taskRepository.save(task);

        AuditContext.after("{\"assigneeId\":" + req.newAssigneeId()
                + ",\"status\":\"" + TaskflowStatus.Task.PENDING + "\"}");

        // 给新处理人补发一条关联通知
        PublishMessageRequest msg = new PublishMessageRequest(
                "REMIND", "TASK", "转办待办：" + task.getBizTitle(),
                req.comment(), null, null, operatorId, null, List.of(req.newAssigneeId()), taskId, null);
        messageService.publish(tenantId, msg);
    }

    /**
     * 批量处理（同一 action）。
     *
     * @return 成功处理条数
     */
    @Transactional
    public int batchHandle(Long tenantId, BatchHandleTaskRequest req, Long operatorId) {
        int ok = 0;
        for (Long taskId : req.taskIds()) {
            handleTask(tenantId, taskId, new HandleTaskRequest(req.action(), req.comment(), null), operatorId);
            ok++;
        }
        return ok;
    }

    /**
     * 待办统计：待处理 / 紧急 / 逾期。
     */
    @Transactional(readOnly = true)
    public TaskStatsVO stats(Long tenantId, Long assigneeId) {
        long pending = taskRepository.countPending(tenantId, assigneeId);
        long urgent = taskRepository.countUrgent(tenantId, assigneeId);
        long overdue = taskRepository.countOverdue(tenantId, assigneeId, LocalDateTime.now());
        return new TaskStatsVO(pending, urgent, overdue);
    }

    /**
     * 取出待办并校验调用方权限，处理与转办在**同一把悲观行锁**内完成。
     *
     * <p><b>为什么必须加锁</b>：{@code isOpen()} 是 check-then-act。两人同时点「同意」
     * 会双双通过校验、双双返回 200；转办竞态更糟——可出现「任务已办但 assignee 是新人」
     * （新人收到待办提醒却点进去发现已办），反向则已办任务复活成待办。
     * 行锁把 read-check-write 串行化，后到者必然看到已提交的终态而被拒。
     *
     * <p><b>为什么必须校验 assignee</b>：同租户内任意登录用户都能猜到 {@code taskId}，
     * 只校验 {@code tenantId} 会导致「处理别人的待办」（越权）。语义与
     * {@code ProcessService.completeTask} 的处理人校验保持一致。
     *
     * <p>{@code operatorId} 为 null 表示调用方未携带操作人（未认证请求），一律拒绝。
     *
     * <p>调用方必须处于事务中（行锁持有到事务结束），本类所有写方法均已 {@code @Transactional}。
     */
    private SysTask requireTask(Long taskId, Long tenantId, Long operatorId) {
        SysTask task = taskRepository.findByIdForUpdate(taskId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "代办不存在"));
        if (!task.getTenantId().equals(tenantId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权访问该代办");
        }
        if (operatorId == null || !operatorId.equals(task.getAssigneeId())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权处理该代办");
        }
        return task;
    }

    private void syncLinkedMessagesToHandled(Long taskId) {
        // P3 简化：仅更新任务自身状态；消息明细的 HANDLED 状态在 P4/P5 随流程推进联动。
    }

    private String buildResult(HandleTaskRequest req) {
        String comment = trimToNull(req.comment());
        String result = trimToNull(req.result());
        if (result != null) {
            return result;
        }
        if (comment == null) {
            return null;
        }
        return "{\"comment\":\"" + comment.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
    }

    private TaskVO toVo(SysTask t) {
        return new TaskVO(
                String.valueOf(t.getId()),
                String.valueOf(t.getTenantId()),
                t.getTaskType(),
                t.getBizType(),
                t.getBizRefId(),
                t.getBizTitle(),
                t.getTargetEntity(),
                String.valueOf(t.getAssigneeId()),
                t.getAssigneeName(),
                t.getStatus(),
                t.getPriority(),
                t.getDueDate(),
                t.getMetadata(),
                t.getResult(),
                Boolean.TRUE.equals(t.getRead()),
                t.getCompletedAt(),
                t.getCreatedAt());
    }

    private static boolean isOpen(String status) {
        return TaskflowStatus.Task.PENDING.equals(status) || TaskflowStatus.Task.APPROVING.equals(status);
    }

    private static int clampSize(int size) {
        if (size <= 0) {
            return 20;
        }
        return Math.min(size, 200);
    }

    private static String trimToNull(String v) {
        return StringUtils.hasText(v) ? v.trim() : null;
    }

    /**
     * 把用户输入关键字转换为「大小写不敏感的 LIKE 模式」。
     *
     * <p>返回 {@code null}（关键字为 null / 空白）时，仓储查询中的 keyword 子句严格退化为原查询。
     *
     * <p><b>为什么在 Java 侧做 {@code toLowerCase} 而不是在 JPQL 里写
     * {@code lower(concat('%', :keyword, '%'))}</b>：后者在 Hibernate 6 下会因参数类型推断缺陷，
     * 把同一查询里被绑成 null 的 {@code :keyword} 绑成 {@code bytea}，PostgreSQL 报
     * {@code function lower(bytea) does not exist}（当查询里同时存在其它 null 参数时触发）。
     * 改为传递已小写的 {@code :pattern}，让 {@code :pattern} 只出现在 {@code like} 右侧
     * 而获得确定的字符串类型。使用 {@link Locale#ROOT} 保证与运行环境区域设置无关（确定性）。
     */
    static String likePattern(String keyword) {
        if (keyword == null || keyword.isBlank()) {
            return null;
        }
        return "%" + keyword.trim().toLowerCase(Locale.ROOT) + "%";
    }
}