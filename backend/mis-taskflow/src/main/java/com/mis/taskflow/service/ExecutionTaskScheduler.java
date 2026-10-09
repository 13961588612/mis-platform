package com.mis.taskflow.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 后置执行扫描器（P6）。
 *
 * <p>定期拉取 {@code biz_execution_task} 中可运行的任务（WAITING，或 FAILED 且已到重试时间），
 * 经分布式锁执行。多实例部署时由 {@code biz_exec_lock} 保证同一业务不并发执行。
 */
@Component
public class ExecutionTaskScheduler {

    private static final Logger log = LoggerFactory.getLogger(ExecutionTaskScheduler.class);

    private final ExecutionTaskService executionTaskService;

    public ExecutionTaskScheduler(ExecutionTaskService executionTaskService) {
        this.executionTaskService = executionTaskService;
    }

    /** 每 15 秒扫描一次（可通过 mis.taskflow.scan.enabled=false 关闭）。 */
    @Scheduled(fixedDelayString = "${mis.taskflow.scan.fixed-delay-ms:15000}")
    public void scan() {
        try {
            int n = executionTaskService.scanAndExecute();
            if (n > 0) {
                log.info("后置执行扫描：本次执行 {} 条任务", n);
            }
        } catch (Exception e) {
            log.error("后置执行扫描异常", e);
        }
    }
}
