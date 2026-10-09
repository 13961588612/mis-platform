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
                    null, null, operatorId, null, List.of(req.assigneeId()), taskId);
            messageService.publish(tenantId, msg);
        }

        return taskId;
    }

    /**
     * 我的待办分页（默认仅未完成）。
     */
    @Transactional(readOnly = true)
    public PageResult<TaskVO> myTasks(Long tenantId, Long assigneeId, String status, int page, int size) {
        Pageable pageable = PageRequest.of(Math.max(page - 1, 0), clampSize(size));
        Page<SysTask> p = StringUtils.hasText(status)
                ? taskRepository.findByAssignee(tenantId, assigneeId, status.trim(), pageable)
                : taskRepository.findOpenByAssignee(tenantId, assigneeId, pageable);
        return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(),
                p.getContent().stream().map(this::toVo).toList());
    }

    /**
     * 我处理过的（已通过 / 已驳回），按完成时间倒序。
     */
    @Transactional(readOnly = true)
    public PageResult<TaskVO> handledTasks(Long tenantId, Long assigneeId, int page, int size) {
        Pageable pageable = PageRequest.of(Math.max(page - 1, 0), clampSize(size));
        Page<SysTask> p = taskRepository.findHandledByAssignee(tenantId, assigneeId, pageable);
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
        SysTask task = requireTask(taskId, tenantId);
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
     */
    @Transactional
    public void transferTask(Long tenantId, Long taskId, TransferTaskRequest req, Long operatorId) {
        SysTask task = requireTask(taskId, tenantId);
        if (!isOpen(task.getStatus())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "该代办已处理，无法转办");
        }
        task.setAssigneeId(req.newAssigneeId());
        task.setAssigneeName(trimToNull(req.newAssigneeName()));
        task.setStatus(TaskflowStatus.Task.PENDING);
        task.setRead(Boolean.FALSE);
        task.setViewedAt(null);
        task.setUpdatedAt(LocalDateTime.now());
        taskRepository.save(task);

        // 给新处理人补发一条关联通知
        PublishMessageRequest msg = new PublishMessageRequest(
                "REMIND", "TASK", "转办待办：" + task.getBizTitle(),
                req.comment(), null, null, operatorId, null, List.of(req.newAssigneeId()), taskId);
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

    private SysTask requireTask(Long taskId, Long tenantId) {
        SysTask task = taskRepository.findByIdAndDeleted(taskId, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "代办不存在"));
        if (!task.getTenantId().equals(tenantId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权访问该代办");
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
}