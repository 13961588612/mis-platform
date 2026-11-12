package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.BizExecutionTask;
import com.mis.taskflow.domain.entity.WfInstance;
import com.mis.taskflow.domain.repository.BizExecutionTaskRepository;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
import com.mis.taskflow.dto.ExecutionTaskVO;
import com.mis.taskflow.support.IdGenerator;
import com.mis.taskflow.support.TaskflowStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 本地任务消息表（Outbox）+ 后置执行闭环（P6）。
 *
 * <p>职责：
 * <ul>
 *   <li>{@code enqueue}：写入待执行任务（WAITING）。</li>
 *   <li>{@code scanAndExecute}：定时扫描可执行任务，经分布式锁执行。</li>
 *   <li>失败重试：指数退避；超过上限升级 {@code MANUAL_FIX}。</li>
 *   <li>人工干预：手动重试 / 强制归档。</li>
 * </ul>
 *
 * <p><b>关键</b>：执行动作本身必须幂等；锁只保证「同一时刻单实例执行」，
 * 但超时夺权会导致重复执行，故业务实现需以状态前置校验保证幂等。
 */
@Service
public class ExecutionTaskService {

    private static final Logger log = LoggerFactory.getLogger(ExecutionTaskService.class);

    /** 最大自动重试次数，超过则升级人工。 */
    private static final int MAX_RETRY = 5;
    /** 每批扫描条数。 */
    private static final int BATCH_SIZE = 20;

    private final BizExecutionTaskRepository taskRepository;
    private final WfInstanceRepository instanceRepository;
    private final DistributedLockService lockService;
    private final ExecutionTaskStore executionTaskStore;

    public ExecutionTaskService(BizExecutionTaskRepository taskRepository,
                                WfInstanceRepository instanceRepository,
                                DistributedLockService lockService,
                                ExecutionTaskStore executionTaskStore) {
        this.taskRepository = taskRepository;
        this.instanceRepository = instanceRepository;
        this.lockService = lockService;
        this.executionTaskStore = executionTaskStore;
    }

    /** 入队一条后置执行任务。 */
    @Transactional
    public Long enqueue(Long tenantId, Long sourceInstanceId, String actionType,
                        String bizType, String bizId, String payloadJson) {
        LocalDateTime now = LocalDateTime.now();
        BizExecutionTask task = new BizExecutionTask();
        task.setId(IdGenerator.nextId());
        task.setTenantId(tenantId);
        task.setSourceInstanceId(sourceInstanceId);
        task.setActionType(actionType);
        task.setBizType(bizType);
        task.setBizRefId(bizId);
        task.setPayload(payloadJson == null ? "{}" : payloadJson);
        task.setTxStatus(TaskflowStatus.Execution.WAITING);
        task.setRetryCount(0);
        task.setCreatedAt(now);
        task.setUpdatedAt(now);
        return taskRepository.save(task).getId();
    }

    /**
     * 扫描并执行一批可运行任务。
     *
     * @return 本次实际执行（提交给锁）的任务数
     */
    public int scanAndExecute() {
        List<BizExecutionTask> runnable = taskRepository.findRunnableTop(LocalDateTime.now(), BATCH_SIZE);
        int executed = 0;
        for (BizExecutionTask task : runnable) {
            if (executeOne(task.getId())) {
                executed++;
            }
        }
        return executed;
    }

    /**
     * 执行单条任务（供扫描器与人工重试共用）。
     *
     * @return 是否由本实例实际执行
     */
    public boolean executeOne(Long taskId) {
        BizExecutionTask task = taskRepository.findById(taskId).orElse(null);
        if (task == null || !isRunnable(task)) {
            return false;
        }
        String lockType = task.getBizType() == null ? "EXEC_TASK" : task.getBizType();
        String lockId = task.getBizRefId() == null ? String.valueOf(task.getId()) : task.getBizRefId();

        try {
            DistributedLockService.LockOutcome outcome =
                    lockService.executeWithLock(lockType, lockId, () -> executionTaskStore.perform(task));
            if (outcome == DistributedLockService.LockOutcome.TIMEOUT) {
                log.warn("执行锁等待超时，task={}", taskId);
                return false;
            }
            return outcome == DistributedLockService.LockOutcome.EXECUTED;
        } catch (Exception e) {
            log.error("后置任务执行失败 task={}", taskId, e);
            executionTaskStore.markFailure(task, e);
            return false;
        }
    }

    /** 人工手动重试。 */
    @Transactional
    public void manualRetry(Long taskId, Long tenantId) {
        BizExecutionTask task = requireTask(taskId, tenantId);
        task.setTxStatus(TaskflowStatus.Execution.WAITING);
        task.setNextRetryAt(null);
        task.setUpdatedAt(LocalDateTime.now());
        taskRepository.save(task);
    }

    /** 强制归档：跳过自动执行，直接把实例置为 SUCCESS。 */
    @Transactional
    public void forceArchive(Long taskId, Long tenantId) {
        BizExecutionTask task = requireTask(taskId, tenantId);
        task.setTxStatus(TaskflowStatus.Execution.SUCCESS);
        task.setErrorMsg(null);
        task.setUpdatedAt(LocalDateTime.now());
        taskRepository.save(task);

        if (task.getSourceInstanceId() != null) {
            instanceRepository.findById(task.getSourceInstanceId()).ifPresent(inst -> {
                inst.setPostProcessStatus(TaskflowStatus.PostProcess.SUCCESS);
                inst.setPostProcessTime(LocalDateTime.now());
                inst.setPostProcessMsg("管理员强制归档");
                inst.setUpdatedAt(LocalDateTime.now());
                instanceRepository.save(inst);
            });
        }
    }

    /** 执行监控列表。 */
    @Transactional(readOnly = true)
    public PageResult<ExecutionTaskVO> monitor(Long tenantId, String status, int page, int size) {
        var pageable = PageRequest.of(Math.max(page - 1, 0), Math.min(Math.max(size, 1), 200));
        Page<BizExecutionTask> p = taskRepository.findForMonitor(blankToNull(status), pageable);
        return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(),
                p.getContent().stream().map(this::toVo).toList());
    }

    @Transactional(readOnly = true)
    public ExecutionTaskVO taskDetail(Long taskId, Long tenantId) {
        return toVo(requireTask(taskId, tenantId));
    }

    private ExecutionTaskVO toVo(BizExecutionTask t) {
        return new ExecutionTaskVO(
                String.valueOf(t.getId()), nullableId(t.getSourceInstanceId()), t.getActionType(),
                t.getBizType(), t.getBizRefId(), t.getTxStatus(), t.getRetryCount(),
                t.getNextRetryAt(), t.getErrorMsg(), t.getCreatedAt(), t.getUpdatedAt());
    }

    private static String nullableId(Long id) {
        return id == null ? null : String.valueOf(id);
    }

    private BizExecutionTask requireTask(Long taskId, Long tenantId) {
        BizExecutionTask task = taskRepository.findById(taskId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "执行任务不存在"));
        if (!task.getTenantId().equals(tenantId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权访问该执行任务");
        }
        return task;
    }

    private static boolean isRunnable(BizExecutionTask task) {
        if (TaskflowStatus.Execution.WAITING.equals(task.getTxStatus())) {
            return true;
        }
        if (TaskflowStatus.Execution.FAILED.equals(task.getTxStatus())) {
            return task.getNextRetryAt() == null || !task.getNextRetryAt().isAfter(LocalDateTime.now());
        }
        return false;
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }

    private static String truncate(String v, int max) {
        if (v == null) return null;
        return v.length() <= max ? v : v.substring(0, max);
    }
}
