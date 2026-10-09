package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.taskflow.domain.entity.WfInstance;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.dto.CompleteWfTaskRequest;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.ProcessDetailVO;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.dto.WfNodeDTO;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 工作流引擎集成测试（P5）—— 真实库，事务回滚。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class ProcessServiceIntegrationTest {

    private static final long TENANT = 900001L;

    @Autowired private WfDefinitionService definitionService;
    @Autowired private ProcessService processService;
    @Autowired private WfInstanceRepository instanceRepository;
    @Autowired private WfTaskRepository wfTaskRepository;

    private String uniqueCode() {
        return "P5_" + System.nanoTime();
    }

    /**
     * 建一个单级审批流程：START → APPROVAL(FIXED) → END。
     */
    private String createSingleApprovalFlow(String formCode, long approver) {
        String code = uniqueCode();
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "单级审批", "APPROVAL", null, List.of(formCode), "{}",
                List.of(
                        new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("approve", "主管审批", "APPROVAL", 1, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + approver + "}", 24, "{}"),
                        new WfNodeDTO("end", "归档", "END", 2, null, null, null, "{}", null, "{}")
                )));
        definitionService.activate(defId, TENANT);
        return code;
    }

    private String createTwoLevelFlow(String formCode, long a1, long a2) {
        String code = uniqueCode();
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "两级审批", "APPROVAL", null, List.of(formCode), "{}",
                List.of(
                        new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("l1", "一级审批", "APPROVAL", 1, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + a1 + "}", 24, "{}"),
                        new WfNodeDTO("l2", "二级审批", "APPROVAL", 2, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + a2 + "}", 24, "{}"),
                        new WfNodeDTO("end", "归档", "END", 3, null, null, null, "{}", null, "{}")
                )));
        definitionService.activate(defId, TENANT);
        return code;
    }

    private Long start(String code, String formCode, String bizId) {
        return processService.startProcess(TENANT, new StartProcessRequest(
                code, "PURCHASE_ORDER", bizId, formCode, "{}", 100L, "发起人"));
    }

    @Test
    @DisplayName("P5：启动流程校验表单白名单；合法表单通过")
    void startValidatesWhitelist() {
        long approver = 700001L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);

        Long instId = start(code, formCode, "PO-" + System.nanoTime());
        assertTrue(instanceRepository.findById(instId).isPresent(), "实例应已创建");
        assertEquals(formCode, instanceRepository.findById(instId).orElseThrow().getStartedFormCode());

        // 非白名单表单被拒
        assertThrows(BusinessException.class, () -> start(code, "OTHER_FORM", "PO-BAD"));
    }

    @Test
    @DisplayName("P5：启动后为审批节点生成 wf_task 与用户视角 sys_task")
    void startCreatesTask() {
        long approver = 700002L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());

        var pending = wfTaskRepository.findPendingByInstance(instId);
        assertEquals(1, pending.size(), "应生成 1 个待处理流程任务");
        assertEquals(approver, pending.get(0).getAssigneeId());
        assertNotNull(pending.get(0).getSysTaskId(), "应关联用户视角代办");
        assertEquals("approve", pending.get(0).getNodeCode());
    }

    @Test
    @DisplayName("P5：单级审批通过后实例 COMPLETED，写入后处理任务")
    void approveCompletes() {
        long approver = 700003L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());

        Long wfTaskId = wfTaskRepository.findPendingByInstance(instId).get(0).getId();
        processService.completeTask(TENANT, wfTaskId, new CompleteWfTaskRequest("APPROVE", "同意"), approver);

        WfInstance inst = instanceRepository.findById(instId).orElseThrow();
        assertEquals("COMPLETED", inst.getStatus());
        assertEquals("WAITING", inst.getPostProcessStatus(), "应写入待后处理状态");
        assertNotNull(inst.getCompletedAt());
    }

    @Test
    @DisplayName("P5：驳回终止实例，不进入后处理")
    void rejectTerminates() {
        long approver = 700004L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());

        Long wfTaskId = wfTaskRepository.findPendingByInstance(instId).get(0).getId();
        processService.completeTask(TENANT, wfTaskId, new CompleteWfTaskRequest("REJECT", "不同意"), approver);

        assertEquals("TERMINATED", instanceRepository.findById(instId).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("P5：多级审批逐级推进，一级通过后生成二级任务")
    void multiLevelAdvance() {
        long a1 = 700005L;
        long a2 = 700006L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createTwoLevelFlow(formCode, a1, a2);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());

        var level1 = wfTaskRepository.findPendingByInstance(instId);
        assertEquals(1, level1.size());
        assertEquals(a1, level1.get(0).getAssigneeId());

        processService.completeTask(TENANT, level1.get(0).getId(), new CompleteWfTaskRequest("APPROVE", "一级同意"), a1);

        var level2 = wfTaskRepository.findPendingByInstance(instId);
        assertEquals(1, level2.size(), "应生成二级审批任务");
        assertEquals(a2, level2.get(0).getAssigneeId());
        assertEquals("l2", level2.get(0).getNodeCode());

        processService.completeTask(TENANT, level2.get(0).getId(), new CompleteWfTaskRequest("APPROVE", "二级同意"), a2);
        assertEquals("COMPLETED", instanceRepository.findById(instId).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("P5：非处理人处理被拒")
    void wrongAssigneeForbidden() {
        long approver = 700007L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());
        Long wfTaskId = wfTaskRepository.findPendingByInstance(instId).get(0).getId();

        assertThrows(BusinessException.class,
                () -> processService.completeTask(TENANT, wfTaskId, new CompleteWfTaskRequest("APPROVE", null), 999999L));
    }

    @Test
    @DisplayName("P5：重复处理被拒（幂等保护）")
    void doubleCompleteRejected() {
        long approver = 700008L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());
        Long wfTaskId = wfTaskRepository.findPendingByInstance(instId).get(0).getId();

        processService.completeTask(TENANT, wfTaskId, new CompleteWfTaskRequest("APPROVE", "同意"), approver);
        assertThrows(BusinessException.class,
                () -> processService.completeTask(TENANT, wfTaskId, new CompleteWfTaskRequest("APPROVE", "再次"), approver));
    }

    @Test
    @DisplayName("P5：实例详情含任务与历史，历史顺序为 SUBMIT→APPROVE")
    void detailHasHistory() {
        long approver = 700009L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());
        Long wfTaskId = wfTaskRepository.findPendingByInstance(instId).get(0).getId();
        processService.completeTask(TENANT, wfTaskId, new CompleteWfTaskRequest("APPROVE", "同意"), approver);

        ProcessDetailVO detail = processService.detail(instId, TENANT);
        assertEquals(formCode, detail.instance().startedFormCode());
        assertTrue(detail.history().size() >= 2, "应含 SUBMIT 与 APPROVE 历史");
        assertEquals("SUBMIT", detail.history().get(0).operation());
        assertTrue(detail.history().stream().anyMatch(h -> "APPROVE".equals(h.operation())));
    }

    @Test
    @DisplayName("P5：我发起的流程查询")
    void myInitiated() {
        long approver = 700010L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());

        var page = processService.myInitiated(TENANT, 100L, null, 1, 50);
        assertTrue(page.getList().stream().anyMatch(v -> v.id().equals(String.valueOf(instId))));
    }

    @Test
    @DisplayName("P5：定义必须恰好一个 START 且审批节点需配置审批人")
    void definitionValidation() {
        assertThrows(BusinessException.class, () -> definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqueCode(), "无开始", "APPROVAL", null, List.of("F"), "{}",
                        List.of(new WfNodeDTO("end", "归档", "END", 0, null, null, null, "{}", null, "{}")))));

        assertThrows(BusinessException.class, () -> definitionService.create(TENANT, 1L,
                new CreateDefinitionRequest(uniqueCode(), "审批人缺失", "APPROVAL", null, List.of("F"), "{}",
                        List.of(
                                new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                                new WfNodeDTO("approve", "审批", "APPROVAL", 1, null, null, null, "{}", null, "{}"),
                                new WfNodeDTO("end", "归档", "END", 2, null, null, null, "{}", null, "{}")))));
    }
}
