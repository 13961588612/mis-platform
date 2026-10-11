package com.mis.taskflow.service;

import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.domain.repository.WfInstanceRepository;
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
 * 会签/并行聚合集成测试（P7 遗留项）：ROUTING 节点多处理人聚合。
 *
 * <p>流程：START → 会签(三人) → END。真实库，事务回滚。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class CountersignIntegrationTest {

    private static final long TENANT = 900004L;

    @Autowired private WfDefinitionService definitionService;
    @Autowired private FormDefinitionService formDefinitionService;
    @Autowired private ProcessService processService;
    @Autowired private WfTaskRepository wfTaskRepository;
    @Autowired private WfInstanceRepository instanceRepository;

    private String createCountersign(String strategy) {
        String code = "CS_" + System.nanoTime();
        FormTestFixtures.register(formDefinitionService, TENANT, "CS_FORM", "会签表单");
        String rule = "{\"type\":\"USER_LIST\",\"value\":[920001,920002,920003]}";
        String config = "{\"routingStrategy\":\"" + strategy + "\"}";
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "会签流程", "APPROVAL", null, List.of("CS_FORM"), "{}",
                List.of(
                        new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("sign", "三人会签", "ROUTING", 1, null, null, null, rule, 24, config),
                        new WfNodeDTO("end", "归档", "END", 2, null, null, null, "{}", null, "{}")
                ),
                List.of(
                        new WfEdgeDTO("start", "sign", "DEFAULT", null, null, 0),
                        new WfEdgeDTO("sign", "end", "DEFAULT", null, null, 1)
                )));
        definitionService.activate(defId, TENANT);
        return code;
    }

    private Long start(String code, String bizId) {
        return processService.startProcess(TENANT, new StartProcessRequest(
                code, "CONTRACT", bizId, "CS_FORM", "{}", 100L, "发起人", null));
    }

    @Test
    @DisplayName("P7：会签节点按 USER_LIST 为 3 人各生成一个任务")
    void countersignFansOut() {
        String code = createCountersign("ALL_PASS");
        Long instId = start(code, "CS-FAN-" + System.nanoTime());

        assertEquals(3, wfTaskRepository.countByNode(instId, "sign"), "三人会签应各生成一个任务");
        assertEquals(3, wfTaskRepository.findPendingByInstance(instId).size());
    }

    @Test
    @DisplayName("P7：ALL_PASS 会签——前两人通过不推进，第三人通过后才结束")
    void allPassWaitsForEveryone() {
        String code = createCountersign("ALL_PASS");
        Long instId = start(code, "CS-ALL-" + System.nanoTime());

        var tasks = wfTaskRepository.findPendingByInstance(instId);
        processService.completeTask(TENANT, tasks.get(0).getId(), new CompleteWfTaskRequest("APPROVE", "同意"), 920001L);
        processService.completeTask(TENANT, tasks.get(1).getId(), new CompleteWfTaskRequest("APPROVE", "同意"), 920002L);

        // 仍有一人未处理 → 实例仍在 RUNNING，且有 1 个待办
        assertEquals("RUNNING", instanceRepository.findById(instId).orElseThrow().getStatus(), "会签未满不应结束");
        assertEquals(1, wfTaskRepository.findPendingByInstance(instId).size());

        processService.completeTask(TENANT, tasks.get(2).getId(), new CompleteWfTaskRequest("APPROVE", "同意"), 920003L);
        assertEquals("COMPLETED", instanceRepository.findById(instId).orElseThrow().getStatus(), "全部通过后应结束");
    }

    @Test
    @DisplayName("P7：ANY_PASS 或签——任一人通过即结束，其余任务作废")
    void anyPassProceedsOnFirst() {
        String code = createCountersign("ANY_PASS");
        Long instId = start(code, "CS-ANY-" + System.nanoTime());

        var tasks = wfTaskRepository.findPendingByInstance(instId);
        processService.completeTask(TENANT, tasks.get(0).getId(), new CompleteWfTaskRequest("APPROVE", "同意"), 920001L);

        assertEquals("COMPLETED", instanceRepository.findById(instId).orElseThrow().getStatus(), "或签一人通过即结束");
        assertTrue(wfTaskRepository.findPendingByInstance(instId).isEmpty(), "其余待办应作废");
    }

    @Test
    @DisplayName("P7：会签任一人驳回，实例终止")
    void anyRejectTerminates() {
        String code = createCountersign("ALL_PASS");
        Long instId = start(code, "CS-REJ-" + System.nanoTime());

        var tasks = wfTaskRepository.findPendingByInstance(instId);
        processService.completeTask(TENANT, tasks.get(0).getId(), new CompleteWfTaskRequest("REJECT", "不同意"), 920001L);

        assertEquals("TERMINATED", instanceRepository.findById(instId).orElseThrow().getStatus(), "会签驳回应终止实例");
    }
}
