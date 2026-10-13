package com.mis.taskflow.service;

import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
import com.mis.taskflow.domain.repository.WfDefinitionRepository;
import com.mis.taskflow.domain.repository.WfHistoryRepository;
import com.mis.taskflow.domain.repository.WfNodeRepository;
import com.mis.taskflow.dto.CompleteWfTaskRequest;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.dto.WfEdgeDTO;
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
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 图式流转集成测试（P7 遗留项）：条件分支按 wf_edge + conditionExpr 分流。
 *
 * <p>流程：START → 金额判断(CONDITIONAL) →〔>= 5万〕总经理审批 /〔< 5万〕部门审批 → END。
 * 用真实库，事务回滚。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class WorkflowEdgeFlowIntegrationTest {

    private static final long TENANT = 900003L;

    @Autowired private WfDefinitionService definitionService;
    @Autowired private FormDefinitionService formDefinitionService;
    @Autowired private ProcessService processService;
    @Autowired private WfTaskRepository wfTaskRepository;

    private String createBranchFlow(String formCode, long gm, long dept) {
        String code = "EDGE_" + System.nanoTime();
        FormTestFixtures.register(formDefinitionService, TENANT, formCode, "条件分支表单");
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "条件分支流程", "APPROVAL", null, List.of(formCode), "{}",
                List.of(
                        new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("cond", "金额判断", "CONDITIONAL", 1, null, null,
                                "${amount >= 50000}", "{}", null, "{}"),
                        new WfNodeDTO("gm", "总经理审批", "APPROVAL", 2, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + gm + "}", 24, "{}"),
                        new WfNodeDTO("dept", "部门审批", "APPROVAL", 3, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + dept + "}", 24, "{}"),
                        new WfNodeDTO("end", "归档", "END", 4, null, null, null, "{}", null, "{}")
                ),
                List.of(
                        new WfEdgeDTO("start", "cond", "DEFAULT", null, null, 0),
                        new WfEdgeDTO("cond", "gm", "CONDITION_YES", "是", "${amount >= 50000}", 1),
                        new WfEdgeDTO("cond", "dept", "CONDITION_NO", "否", "${amount < 50000}", 2),
                        new WfEdgeDTO("gm", "end", "DEFAULT", null, null, 3),
                        new WfEdgeDTO("dept", "end", "DEFAULT", null, null, 4)
                )));
        definitionService.activate(defId, TENANT);
        return code;
    }

    @Test
    @DisplayName("P7：金额 >= 5万 走总经理审批分支")
    void highAmountGoesToGm() {
        long gm = 910001L;
        long dept = 910002L;
        String formCode = "EDGE_HIGH";
        String code = createBranchFlow(formCode, gm, dept);

        Long instId = processService.startProcess(TENANT, new StartProcessRequest(
                code, "PURCHASE_ORDER", "EDGE-HIGH-" + System.nanoTime(), formCode,
                "{\"amount\":80000}", 100L, "发起人", null, null, "测试标题", null, null));

        var pending = wfTaskRepository.findPendingByInstance(instId);
        assertEquals(1, pending.size(), "应只生成一个分支的审批任务");
        assertEquals("gm", pending.get(0).getNodeCode(), "高金额应走总经理审批");
        assertEquals(gm, pending.get(0).getAssigneeId());
    }

    @Test
    @DisplayName("P7：金额 < 5万 走部门审批分支")
    void lowAmountGoesToDept() {
        long gm = 910003L;
        long dept = 910004L;
        String formCode = "EDGE_LOW";
        String code = createBranchFlow(formCode, gm, dept);

        Long instId = processService.startProcess(TENANT, new StartProcessRequest(
                code, "PURCHASE_ORDER", "EDGE-LOW-" + System.nanoTime(), formCode,
                "{\"amount\":30000}", 100L, "发起人", null, null, "测试标题", null, null));

        var pending = wfTaskRepository.findPendingByInstance(instId);
        assertEquals(1, pending.size());
        assertEquals("dept", pending.get(0).getNodeCode(), "低金额应走部门审批");
        assertEquals(dept, pending.get(0).getAssigneeId());
    }

    @Test
    @DisplayName("P7：分支通过后经各自边汇合到 END，实例 COMPLETED")
    void branchConvergesToEnd() {
        long gm = 910005L;
        long dept = 910006L;
        String formCode = "EDGE_CONV";
        String code = createBranchFlow(formCode, gm, dept);

        Long instId = processService.startProcess(TENANT, new StartProcessRequest(
                code, "PURCHASE_ORDER", "EDGE-CONV-" + System.nanoTime(), formCode,
                "{\"amount\":80000}", 100L, "发起人", null, null, "测试标题", null, null));

        var task = wfTaskRepository.findPendingByInstance(instId).get(0);
        processService.completeTask(TENANT, task.getId(), new CompleteWfTaskRequest("APPROVE", "同意"), gm);

        // 通过后经 gm→end 边汇合结束
        assertTrue(wfTaskRepository.findPendingByInstance(instId).isEmpty(), "结束后不应有遗留待办");
    }
}
