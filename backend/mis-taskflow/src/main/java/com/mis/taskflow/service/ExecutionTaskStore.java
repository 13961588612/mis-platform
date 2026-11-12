package com.mis.taskflow.service;

import com.mis.taskflow.domain.entity.BizExecutionTask;
import com.mis.taskflow.domain.entity.WfInstance;
import com.mis.taskflow.domain.repository.BizExecutionTaskRepository;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
import com.mis.taskflow.support.TaskflowStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * 后置任务执行的持久化动作（P6）。
 *
 * <p>拆成独立 Bean 是为了让 {@code @Transactional(REQUIRES_NEW)} 经 Spring 代理生效：
 * 业务动作与其结果回写必须在独立事务中提交，不能与扫描外层共享事务。
 */
@Component
public class ExecutionTaskStore {

    /** 最大自动重试次数，超过则升级人工。 */
    private static final int MAX_RETRY = 5;

    private final BizExecutionTaskRepository taskRepository;
    private final WfInstanceRepository instanceRepository;

    public ExecutionTaskStore(BizExecutionTaskRepository taskRepository, WfInstanceRepository instanceRepository) {
        this.taskRepository = taskRepository;
        this.instanceRepository = instanceRepository;
    }

    /** 真正的业务动作：当前为流程后处理示例（回写实例后处理状态）。 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void perform(BizExecutionTask task) {
        if ("FINALIZE_BIZ".equals(task.getActionType()) && task.getSourceInstanceId() != null) {
            Optional<WfInstance> opt = instanceRepository.findById(task.getSourceInstanceId());
            if (opt.isPresent()) {
                WfInstance instance = opt.get();
                // 幂等：仅当仍为 WAITING 时回写 SUCCESS
                if (TaskflowStatus.PostProcess.WAITING.equals(instance.getPostProcessStatus())) {
                    instance.setPostProcessStatus(TaskflowStatus.PostProcess.SUCCESS);
                    instance.setPostProcessTime(LocalDateTime.now());
                    instance.setPostProcessMsg("业务归档完成");
                    instance.setUpdatedAt(LocalDateTime.now());
                    instanceRepository.save(instance);
                }
            }
        }
        task.setTxStatus(TaskflowStatus.Execution.SUCCESS);
        task.setErrorMsg(null);
        task.setUpdatedAt(LocalDateTime.now());
        taskRepository.save(task);
    }

    /** 记录失败并设置指数退避；超过上限升级人工。 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markFailure(BizExecutionTask task, Exception e) {
        int retry = task.getRetryCount() == null ? 0 : task.getRetryCount();
        retry++;
        task.setRetryCount(retry);
        task.setErrorMsg(truncate(e.getMessage(), 2000));
        task.setUpdatedAt(LocalDateTime.now());
        if (retry >= MAX_RETRY) {
            task.setTxStatus(TaskflowStatus.PostProcess.MANUAL_FIX);
            task.setNextRetryAt(null);
            Long srcInstanceId = task.getSourceInstanceId();
            if (srcInstanceId != null) {
                Optional<WfInstance> opt = instanceRepository.findById(srcInstanceId);
                if (opt.isPresent()) {
                    WfInstance inst = opt.get();
                    inst.setPostProcessStatus(TaskflowStatus.PostProcess.MANUAL_FIX);
                    inst.setPostProcessMsg("连续 " + retry + " 次失败，需人工处理：" + truncate(e.getMessage(), 400));
                    inst.setPostRetryCount(retry);
                    inst.setUpdatedAt(LocalDateTime.now());
                    instanceRepository.save(inst);
                }
            }
        } else {
            task.setTxStatus(TaskflowStatus.Execution.FAILED);
            task.setNextRetryAt(LocalDateTime.now().plusMinutes((long) Math.pow(2, retry - 1)));
        }
        taskRepository.save(task);
    }

    private static String truncate(String v, int max) {
        if (v == null) return null;
        return v.length() <= max ? v : v.substring(0, max);
    }
}
