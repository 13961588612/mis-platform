package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.taskflow.domain.entity.SysAuditOp;
import com.mis.taskflow.domain.entity.WfInstance;
import com.mis.taskflow.domain.repository.SysAuditOpRepository;
import com.mis.taskflow.domain.repository.SysTaskRepository;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.dto.CompleteWfTaskRequest;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.CreateTaskRequest;
import com.mis.taskflow.dto.ProcessDetailVO;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.dto.TransferTaskRequest;
import com.mis.taskflow.dto.WfNodeDTO;
import com.mis.taskflow.support.FormTestFixtures;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
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
    @Autowired private FormDefinitionService formDefinitionService;
    @Autowired private ProcessService processService;
    @Autowired private TaskService taskService;
    @Autowired private WfInstanceRepository instanceRepository;
    @Autowired private WfTaskRepository wfTaskRepository;
    @Autowired private SysTaskRepository sysTaskRepository;
    @Autowired private SysAuditOpRepository auditRepository;

    private String uniqueCode() {
        return "P5_" + System.nanoTime();
    }

    private long nextUser() {
        return 700100L + (System.nanoTime() % 100_000);
    }

    /**
     * 审计切面在无 {@code LoginUser} 上下文时把 tenantId 兜底为 1
     * （见 {@code BusinessOperationAspect.record}），测试环境即此情形。
     */
    private static final long AUDIT_TENANT = 1L;

    /**
     * 建一个单级审批流程：START → APPROVAL(FIXED) → END。
     */
    private String createSingleApprovalFlow(String formCode, long approver) {
        String code = uniqueCode();
        FormTestFixtures.register(formDefinitionService, TENANT, formCode, "单级审批表单");
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
        FormTestFixtures.register(formDefinitionService, TENANT, formCode, "两级审批表单");
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
                code, "PURCHASE_ORDER", bizId, formCode, "{}", 100L, "发起人", null, null, "测试标题", null, null));
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
    @DisplayName("B2：驳回时同步关闭用户视角代办——sys_task 置 REJECTED（回归：曾恒为 PENDING）")
    void rejectSyncsLinkedSysTask() {
        long approver = 700011L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());

        var pending = wfTaskRepository.findPendingByInstance(instId);
        Long sysTaskId = pending.get(0).getSysTaskId();
        assertNotNull(sysTaskId, "应关联用户视角代办");
        assertEquals("PENDING", sysTaskRepository.findById(sysTaskId).orElseThrow().getStatus());

        processService.completeTask(TENANT, pending.get(0).getId(),
                new CompleteWfTaskRequest("REJECT", "不同意"), approver);

        assertEquals("REJECTED", sysTaskRepository.findById(sysTaskId).orElseThrow().getStatus(),
                "驳回后关联代办必须同步为 REJECTED，不能停留在 PENDING");
    }

    @Test
    @DisplayName("P1：completeTask(operatorId=null) 驳回——sys_task 不得停留在 PENDING（回归：曾重新引入 B-2）")
    void rejectWithoutOperatorStillSyncsLinkedSysTask() {
        long approver = 700013L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());

        var pending = wfTaskRepository.findPendingByInstance(instId);
        Long sysTaskId = pending.get(0).getSysTaskId();
        assertEquals(approver, pending.get(0).getAssigneeId(), "前置：wf_task 处理人应为定岗审批人");
        assertEquals("PENDING", sysTaskRepository.findById(sysTaskId).orElseThrow().getStatus());

        // operatorId=null：completeTask 的守卫将其视为系统调用放行（既有语义，不改）
        processService.completeTask(TENANT, pending.get(0).getId(),
                new CompleteWfTaskRequest("REJECT", "不同意"), null);

        assertEquals("TERMINATED", instanceRepository.findById(instId).orElseThrow().getStatus(),
                "流程应已终止");
        assertNotEquals("PENDING", sysTaskRepository.findById(sysTaskId).orElseThrow().getStatus(),
                "operatorId 为 null 时 sys_task 仍必须同步为终态，否则用户永远看到一条待办（B-2）");
        assertEquals("REJECTED", sysTaskRepository.findById(sysTaskId).orElseThrow().getStatus(),
                "回填 wf_task.assigneeId 后应同步为 REJECTED");
    }

    @Test
    @DisplayName("P1：completeTask(operatorId=null) 同意——sys_task 同步为 APPROVED（回归：曾重新引入 B-2）")
    void approveWithoutOperatorStillSyncsLinkedSysTask() {
        long approver = 700014L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());

        var pending = wfTaskRepository.findPendingByInstance(instId);
        Long sysTaskId = pending.get(0).getSysTaskId();

        processService.completeTask(TENANT, pending.get(0).getId(),
                new CompleteWfTaskRequest("APPROVE", "同意"), null);

        assertEquals("COMPLETED", instanceRepository.findById(instId).orElseThrow().getStatus());
        assertEquals("APPROVED", sysTaskRepository.findById(sysTaskId).orElseThrow().getStatus(),
                "operatorId 为 null 时同意路径同样必须同步代办，不能停留在 PENDING（B-2）");
    }

    @Test
    @DisplayName("P1：正常 assignee 处理——sys_task 状态随 action 正确落为 APPROVED")
    void approveByAssigneeSyncsLinkedSysTaskToApproved() {
        long approver = 700015L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime());

        var pending = wfTaskRepository.findPendingByInstance(instId);
        Long sysTaskId = pending.get(0).getSysTaskId();

        processService.completeTask(TENANT, pending.get(0).getId(),
                new CompleteWfTaskRequest("APPROVE", "同意"), approver);

        assertEquals("APPROVED", sysTaskRepository.findById(sysTaskId).orElseThrow().getStatus(),
                "正常处理人同意后关联代办应为 APPROVED");
    }

    @Test
    @DisplayName("B4：审批动作落审计，且 before/after diff 非空（回归：曾无审计记录）")
    void completeTaskWritesAuditWithDiff() {
        long approver = 700012L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        String bizId = "PO-" + System.nanoTime();
        Long instId = start(code, formCode, bizId);

        processService.completeTask(TENANT, wfTaskRepository.findPendingByInstance(instId).get(0).getId(),
                new CompleteWfTaskRequest("APPROVE", "同意"), approver);

        var ops = auditRepository.findByTenantIdAndBusinessTypeAndBusinessIdOrderByOperTimeAsc(
                AUDIT_TENANT, "WF_INSTANCE", "PURCHASE_ORDER/" + bizId);
        assertEquals(1, ops.size(), "流程审批应恰好记录 1 条审计");
        SysAuditOp op = ops.get(0);
        assertEquals(SysAuditOp.SUCCESS, op.getResultStatus());
        assertEquals("流程审批", op.getModule());
        assertTrue(op.getBeforeData().contains("RUNNING"), "before 应含审批前实例状态: " + op.getBeforeData());
        assertTrue(op.getAfterData().contains("COMPLETED"), "after 应含审批后实例状态: " + op.getAfterData());
        assertTrue(op.getDiffSummary().contains("status"), "diff 不应为空: " + op.getDiffSummary());
    }

    @Test
    @DisplayName("B4：转办落审计，before/after 记录处理人变更")
    void transferWritesAuditWithAssigneeDiff() {
        long from = nextUser();
        long to = nextUser();
        String bizRefId = "PO-" + System.nanoTime();
        Long taskId = taskService.createTask(TENANT, 1L, new CreateTaskRequest(
                "PURCHASE_APPROVAL", "PURCHASE_ORDER", bizRefId, "转办审计",
                "PURCHASE_ORDER", from, "原处理人", (short) 2, null, "{}", null, null, null));

        taskService.transferTask(TENANT, taskId, new TransferTaskRequest(to, "新处理人", "请接手"), from);

        var ops = auditRepository.findByTenantIdAndBusinessTypeAndBusinessIdOrderByOperTimeAsc(
                AUDIT_TENANT, "SYS_TASK", "PURCHASE_ORDER/" + bizRefId);
        assertEquals(1, ops.size(), "转办应恰好记录 1 条审计");
        SysAuditOp op = ops.get(0);
        assertEquals("ASSIGN", op.getOperationType());
        assertTrue(op.getBeforeData().contains(String.valueOf(from)), "before 应含原处理人: " + op.getBeforeData());
        assertTrue(op.getAfterData().contains(String.valueOf(to)), "after 应含新处理人: " + op.getAfterData());
        assertTrue(op.getDiffSummary().contains("assigneeId"), "diff 应含 assigneeId 变更: " + op.getDiffSummary());
    }

    @Test
    @DisplayName("B4：内层 handleTask 的审计不得污染外层 completeTask 的 before/after")
    void nestedAuditContextsAreIsolated() {
        long approver = 700013L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        String bizId = "PO-" + System.nanoTime();
        Long instId = start(code, formCode, bizId);

        processService.completeTask(TENANT, wfTaskRepository.findPendingByInstance(instId).get(0).getId(),
                new CompleteWfTaskRequest("APPROVE", "同意"), approver);

        // 外层（流程审批）与内层（代办处理）各一条，且都带非空 diff
        var outer = auditRepository.findByTenantIdAndBusinessTypeAndBusinessIdOrderByOperTimeAsc(
                AUDIT_TENANT, "WF_INSTANCE", "PURCHASE_ORDER/" + bizId);
        assertEquals(1, outer.size());
        assertTrue(outer.get(0).getBeforeData().contains("RUNNING"),
                "外层 before 不应被内层覆盖成代办状态: " + outer.get(0).getBeforeData());
        assertTrue(outer.get(0).getDiffSummary().contains("status"), "外层 diff 不应为空");

        var inner = auditRepository.findByTenantIdAndBusinessTypeAndBusinessIdOrderByOperTimeAsc(
                AUDIT_TENANT, "SYS_TASK", "PURCHASE_ORDER/" + bizId);
        assertEquals(1, inner.size(), "内层代办审计应恰好 1 条");
        assertTrue(inner.get(0).getBeforeData().contains("PENDING"), "内层 before 应为代办原状态");
        assertTrue(inner.get(0).getAfterData().contains("APPROVED"), "内层 after 应为代办终态");
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

    @Test
    @DisplayName("TITLE：显式 title 写入实例，待办 biz_title 对齐")
    void explicitTitleWrittenAndAssigned() {
        long approver = 700101L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = processService.startProcess(TENANT, new StartProcessRequest(
                code, "PURCHASE_ORDER", "PO-T1", formCode, "{}", 100L, "发起人",
                null, null, "采购审批标题", (short) 3, null));

        assertEquals("采购审批标题", instanceRepository.findById(instId).orElseThrow().getTitle());
        var pending = wfTaskRepository.findPendingByInstance(instId);
        assertEquals(1, pending.size());
        Long sysTaskId = pending.get(0).getSysTaskId();
        assertNotNull(sysTaskId);
        var sysTask = sysTaskRepository.findById(sysTaskId).orElseThrow();
        assertEquals("采购审批标题", sysTask.getBizTitle());
        assertEquals((short) 3, sysTask.getPriority());
    }

    @Test
    @DisplayName("TITLE：config.titleField + formData 取值；缺标题失败")
    void titleFromFormFieldOrReject() {
        long approver = 700102L;
        String formCode = "FORM_TF_" + System.nanoTime();
        formDefinitionService.create(TENANT, 1L, new com.mis.taskflow.dto.UpsertFormDefinitionRequest(
                null, formCode, "带标题字段表单", null, "ENABLED", 0, "{\"titleField\":\"orderNo\"}"));
        String code = uniqueCode();
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "标题字段流", "APPROVAL", null, List.of(formCode), "{}",
                List.of(
                        new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("approve", "主管审批", "APPROVAL", 1, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + approver + "}", 24, "{}"),
                        new WfNodeDTO("end", "归档", "END", 2, null, null, null, "{}", null, "{}")
                )));
        definitionService.activate(defId, TENANT);

        Long instId = processService.startProcess(TENANT, new StartProcessRequest(
                code, "PURCHASE_ORDER", "PO-T2", formCode,
                "{\"orderNo\":\"PO-2026-TITLE\"}", 100L, "发起人", null, null, null, null, null));
        assertEquals("PO-2026-TITLE", instanceRepository.findById(instId).orElseThrow().getTitle());

        BusinessException ex = assertThrows(BusinessException.class, () -> processService.startProcess(TENANT,
                new StartProcessRequest(code, "PURCHASE_ORDER", "PO-T3", formCode, "{}", 100L, "发起人",
                        null, null, null, null, null)));
        assertEquals(ProcessService.TITLE_REQUIRED_MESSAGE, ex.getMessage());
    }

    @Test
    @DisplayName("CC：抄送节点分发后自动推进；抄送 biz_title 带实例标题")
    void ccAutoAdvanceAndTitle() {
        long approver = 700103L;
        long ccUser = 700104L;
        String formCode = "FORM_CC_" + System.nanoTime();
        FormTestFixtures.register(formDefinitionService, TENANT, formCode, "抄送后审批表单");
        String code = uniqueCode();
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "抄送后审批", "APPROVAL", null, List.of(formCode), "{}",
                List.of(
                        new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("cc1", "抄送知会", "CC", 1, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + ccUser + "}", null, "{}"),
                        new WfNodeDTO("approve", "主管审批", "APPROVAL", 2, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + approver + "}", 24, "{}"),
                        new WfNodeDTO("end", "归档", "END", 3, null, null, null, "{}", null, "{}")
                )));
        definitionService.activate(defId, TENANT);

        Long instId = processService.startProcess(TENANT, new StartProcessRequest(
                code, "PURCHASE_ORDER", "PO-CC", formCode, "{}", 100L, "发起人",
                null, null, "抄送流程标题", null, null));

        var pendingWf = wfTaskRepository.findPendingByInstance(instId);
        assertEquals(1, pendingWf.size(), "抄送不阻塞，应只剩审批待办");
        assertEquals("approve", pendingWf.get(0).getNodeCode());

        var ccPage = taskService.ccTasks(TENANT, ccUser, null, 1, 20);
        assertTrue(ccPage.getTotal() >= 1, "被抄送人应在「抄送我的」看到记录");
        assertTrue(ccPage.getList().stream().anyMatch(t -> "抄送 · 抄送流程标题".equals(t.bizTitle())));
    }
}
