package com.mis.taskflow.service;

import com.mis.taskflow.domain.entity.WfInstance;
import com.mis.taskflow.domain.repository.WfDefinitionRepository;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
import com.mis.taskflow.domain.repository.WfHistoryRepository;
import com.mis.taskflow.domain.repository.WfNodeRepository;
import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.domain.repository.SysTaskRepository;
import com.mis.taskflow.domain.repository.BizExecutionTaskRepository;
import com.mis.taskflow.dto.CompleteWfTaskRequest;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.dto.WfNodeDTO;
import com.mis.taskflow.support.FormTestFixtures;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * P8 端到端：表单提交 → 生成代办+消息 → 审批通过 → 流程结束 → Outbox 后处理 → 业务归档。
 *
 * <p>真实库执行，显式清理。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class TaskflowEndToEndTest {

    private static final long TENANT = 900002L;

    @Autowired private WfDefinitionService definitionService;
    @Autowired private FormDefinitionService formDefinitionService;
    @Autowired private ProcessService processService;
    @Autowired private ExecutionTaskService executionTaskService;
    @Autowired private WfDefinitionRepository definitionRepository;
    @Autowired private WfInstanceRepository instanceRepository;
    @Autowired private WfTaskRepository wfTaskRepository;
    @Autowired private WfHistoryRepository wfHistoryRepository;
    @Autowired private WfNodeRepository wfNodeRepository;
    @Autowired private org.springframework.transaction.support.TransactionTemplate txTemplate;
    @Autowired private SysTaskRepository sysTaskRepository;
    @Autowired private BizExecutionTaskRepository executionTaskRepository;
    @Autowired private LockStore lockStore;

    @Test
    @DisplayName("P8 E2E：提交→代办+消息→审批→结束→归档成功")
    void fullHappyPath() {
        long approver = 900200L;
        String formCode = "E2E_FORM";
        String bizId = "E2E-PO-" + System.nanoTime();

        String code = "E2E_" + System.nanoTime();
        FormTestFixtures.register(formDefinitionService, TENANT, formCode, "E2E 表单");
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "E2E 单级审批", "APPROVAL", null, List.of(formCode), "{}",
                List.of(
                        new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("approve", "主管审批", "APPROVAL", 1, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + approver + "}", 24, "{}"),
                        new WfNodeDTO("end", "归档", "END", 2, null, null, null, "{}", null, "{}")
                )));
        definitionService.activate(defId, TENANT);

        Long instId = null;
        Long taskId = null;
        try {
            // 1. 提交（启动流程）
            instId = processService.startProcess(TENANT, new StartProcessRequest(
                    code, "PURCHASE_ORDER", bizId, formCode, "{\"amount\":50000}", 100L, "发起人", null));

            // 2. 生成 wf_task + 用户视角 sys_task
            var wfTasks = wfTaskRepository.findPendingByInstance(instId);
            assertEquals(1, wfTasks.size(), "应生成 1 个流程任务");
            taskId = wfTasks.get(0).getSysTaskId();
            assertNotNull(taskId, "应同时生成用户视角代办");
            assertTrue(sysTaskRepository.findById(taskId).isPresent(), "sys_task 应存在");

            // 3. 审批通过
            processService.completeTask(TENANT, wfTasks.get(0).getId(),
                    new CompleteWfTaskRequest("APPROVE", "同意"), approver);

            // 4. 流程结束
            WfInstance inst = instanceRepository.findById(instId).orElseThrow();
            assertEquals("COMPLETED", inst.getStatus());

            // 5. Outbox 生成后处理任务并扫描执行 → 归档成功
            assertEquals("WAITING", inst.getPostProcessStatus());
            executionTaskService.scanAndExecute();

            WfInstance archived = instanceRepository.findById(instId).orElseThrow();
            assertEquals("SUCCESS", archived.getPostProcessStatus(), "后处理应归档成功");
        } finally {
            cleanup(instId, taskId, defId, bizId);
        }
    }

    private void cleanup(Long instId, Long sysTaskId, Long defId, String bizId) {
        txTemplate.executeWithoutResult(status -> {
            executionTaskRepository.findBySourceInstanceId(instId == null ? -1L : instId).forEach(t -> {
                String bt = t.getBizType() == null ? "EXEC_TASK" : t.getBizType();
                String bid = t.getBizRefId() == null ? String.valueOf(t.getId()) : t.getBizRefId();
                lockStore.deleteByStatus(bt, bid, "RUNNING");
                lockStore.deleteByStatus(bt, bid, "SUCCESS");
                lockStore.deleteByStatus(bt, bid, "FAILED");
                executionTaskRepository.deleteById(t.getId());
            });
            if (instId != null) {
                wfHistoryRepository.findByInstanceIdOrderByCreatedAtAsc(instId)
                        .forEach(h -> wfHistoryRepository.deleteById(h.getId()));
                wfTaskRepository.findByInstanceIdOrderByCreatedAtAsc(instId)
                        .forEach(t -> wfTaskRepository.deleteById(t.getId()));
                instanceRepository.deleteById(instId);
            }
            if (sysTaskId != null) {
                sysTaskRepository.findById(sysTaskId).ifPresent(sysTaskRepository::delete);
            }
            definitionRepository.findByTenantIdAndDeletedOrderByUpdatedAtDesc(TENANT, 0).forEach(d -> {
                if (d.getCode().startsWith("E2E_")) {
                    wfNodeRepository.deleteByDefinitionId(d.getId());
                    definitionRepository.deleteById(d.getId());
                }
            });
            if (defId != null) {
                definitionRepository.findById(defId).ifPresent(d -> {
                    wfNodeRepository.deleteByDefinitionId(d.getId());
                    definitionRepository.deleteById(d.getId());
                });
            }
        });
    }
}
