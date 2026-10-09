package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.taskflow.domain.entity.BizExecutionTask;
import com.mis.taskflow.domain.entity.WfDefinition;
import com.mis.taskflow.domain.entity.WfInstance;
import com.mis.taskflow.domain.repository.BizExecutionTaskRepository;
import com.mis.taskflow.domain.repository.WfDefinitionRepository;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Outbox 后置执行闭环集成测试（P6）—— 真实库，显式清理。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class ExecutionTaskServiceIntegrationTest {

    private static final long TENANT = 900001L;

    @Autowired private ExecutionTaskService executionTaskService;
    @Autowired private BizExecutionTaskRepository taskRepository;
    @Autowired private WfInstanceRepository instanceRepository;
    @Autowired private WfDefinitionRepository definitionRepository;
    @Autowired private LockStore lockStore;

    private Long enqueueFinalize(String bizId) {
        return executionTaskService.enqueue(TENANT, null, "FINALIZE_BIZ", "P6_BIZ", bizId, "{}");
    }

    @Test
    @DisplayName("P6：enqueue 写入 WAITING 任务")
    void enqueueWritesWaiting() {
        Long taskId = enqueueFinalize("enqueue-" + System.nanoTime());
        try {
            BizExecutionTask task = taskRepository.findById(taskId).orElseThrow();
            assertEquals("WAITING", task.getTxStatus());
            assertEquals(0, task.getRetryCount());
        } finally {
            cleanup(taskId, null);
        }
    }

    @Test
    @DisplayName("P6：扫描执行成功后任务置 SUCCESS，实例后处理置 SUCCESS")
    void scanExecutesAndArchives() {
        Long instanceId = createInstance("archive-" + System.nanoTime());
        Long taskId = executionTaskService.enqueue(TENANT, instanceId, "FINALIZE_BIZ", "P6_BIZ",
                "archive-biz-" + System.nanoTime(), "{}");
        try {
            int executed = executionTaskService.scanAndExecute();
            assertTrue(executed >= 1, "应至少执行一条任务");

            assertEquals("SUCCESS", taskRepository.findById(taskId).orElseThrow().getTxStatus());
            assertEquals("SUCCESS", instanceRepository.findById(instanceId).orElseThrow().getPostProcessStatus());
        } finally {
            cleanup(taskId, instanceId);
        }
    }

    @Test
    @DisplayName("P6：执行幂等——实例已 SUCCESS 时重复执行不改状态、不报错")
    void executeIdempotent() {
        Long instanceId = createInstance("idem-" + System.nanoTime());
        Long taskId = executionTaskService.enqueue(TENANT, instanceId, "FINALIZE_BIZ", "P6_BIZ",
                "idem-biz-" + System.nanoTime(), "{}");
        try {
            executionTaskService.executeOne(taskId);
            // 第二次（若锁已 SUCCESS 则跳过；即便重放也应幂等）
            executionTaskService.executeOne(taskId);
            assertEquals("SUCCESS", instanceRepository.findById(instanceId).orElseThrow().getPostProcessStatus());
            assertEquals("SUCCESS", taskRepository.findById(taskId).orElseThrow().getTxStatus());
        } finally {
            cleanup(taskId, instanceId);
        }
    }

    @Test
    @DisplayName("P6：手动重试把 MANUAL_FIX 重置为 WAITING")
    void manualRetry() {
        Long taskId = enqueueFinalize("retry-" + System.nanoTime());
        try {
            BizExecutionTask task = taskRepository.findById(taskId).orElseThrow();
            task.setTxStatus("MANUAL_FIX");
            task.setRetryCount(5);
            taskRepository.save(task);

            executionTaskService.manualRetry(taskId, TENANT);
            BizExecutionTask after = taskRepository.findById(taskId).orElseThrow();
            assertEquals("WAITING", after.getTxStatus());
        } finally {
            cleanup(taskId, null);
        }
    }

    @Test
    @DisplayName("P6：强制归档直接置 SUCCESS 并回写实例")
    void forceArchive() {
        Long instanceId = createInstance("force-" + System.nanoTime());
        Long taskId = executionTaskService.enqueue(TENANT, instanceId, "FINALIZE_BIZ", "P6_BIZ",
                "force-biz-" + System.nanoTime(), "{}");
        try {
            BizExecutionTask task = taskRepository.findById(taskId).orElseThrow();
            task.setTxStatus("MANUAL_FIX");
            taskRepository.save(task);

            executionTaskService.forceArchive(taskId, TENANT);
            assertEquals("SUCCESS", taskRepository.findById(taskId).orElseThrow().getTxStatus());
            assertEquals("SUCCESS", instanceRepository.findById(instanceId).orElseThrow().getPostProcessStatus());
        } finally {
            cleanup(taskId, instanceId);
        }
    }

    @Test
    @DisplayName("P6：跨租户访问被拒")
    void crossTenantForbidden() {
        Long taskId = enqueueFinalize("xt-" + System.nanoTime());
        try {
            assertThrows(BusinessException.class, () -> executionTaskService.taskDetail(taskId, 999999L));
        } finally {
            cleanup(taskId, null);
        }
    }

    // ------------------------------------------------------------------

    private Long createDefinition() {
        WfDefinition def = new WfDefinition();
        def.setId(com.mis.taskflow.support.IdGenerator.nextId());
        def.setTenantId(TENANT);
        def.setCode("P6_DEF_" + System.nanoTime());
        def.setName("P6 测试定义");
        def.setStatus(WfDefinition.STATUS_ACTIVE);
        def.setSupportedFormCodes(new String[]{"F"});
        def.setCreatedAt(java.time.LocalDateTime.now());
        def.setUpdatedAt(java.time.LocalDateTime.now());
        return definitionRepository.save(def).getId();
    }

    private Long createInstance(String bizId) {
        Long defId = createDefinition();
        WfInstance inst = new WfInstance();
        inst.setId(com.mis.taskflow.support.IdGenerator.nextId());
        inst.setTenantId(TENANT);
        inst.setDefinitionId(defId);
        inst.setDefinitionCode("P6_TEST");
        inst.setStartedFormCode("F");
        inst.setBusinessType("P6_BIZ");
        inst.setBusinessId(bizId);
        inst.setStatus("COMPLETED");
        inst.setInitiatorId(100L);
        inst.setPostProcessStatus("WAITING");
        inst.setCreatedAt(java.time.LocalDateTime.now());
        inst.setUpdatedAt(java.time.LocalDateTime.now());
        return instanceRepository.save(inst).getId();
    }

    private void cleanup(Long taskId, Long instanceId) {
        taskRepository.findById(taskId).ifPresent(t -> {
            lockStore.deleteByStatus(t.getBizType() == null ? "EXEC_TASK" : t.getBizType(),
                    t.getBizRefId() == null ? String.valueOf(t.getId()) : t.getBizRefId(), "RUNNING");
            lockStore.deleteByStatus(t.getBizType() == null ? "EXEC_TASK" : t.getBizType(),
                    t.getBizRefId() == null ? String.valueOf(t.getId()) : t.getBizRefId(), "SUCCESS");
            lockStore.deleteByStatus(t.getBizType() == null ? "EXEC_TASK" : t.getBizType(),
                    t.getBizRefId() == null ? String.valueOf(t.getId()) : t.getBizRefId(), "FAILED");
            taskRepository.deleteById(taskId);
        });
        Optional.ofNullable(instanceId).ifPresent(id -> {
            instanceRepository.findById(id).ifPresent(inst -> {
                Long defId = inst.getDefinitionId();
                instanceRepository.deleteById(id);
                definitionRepository.findById(defId).ifPresent(definitionRepository::delete);
            });
        });
    }
}
