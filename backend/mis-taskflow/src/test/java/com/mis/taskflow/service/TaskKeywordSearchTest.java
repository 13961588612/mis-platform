package com.mis.taskflow.service;

import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.CreateTaskRequest;
import com.mis.taskflow.dto.HandleTaskRequest;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.dto.TaskVO;
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
 * PR-04 三处列表 keyword 搜索集成测试 —— 真实库，事务回滚。
 *
 * <p>验签：{@code /tasks/my}、{@code /tasks/handled}、{@code /workflow/instances/my}
 * 的 keyword 模糊过滤生效；空 keyword 行为与现状完全一致（退化原查询）。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class TaskKeywordSearchTest {

    private static final long TENANT = 900001L;

    @Autowired private TaskService taskService;
    @Autowired private ProcessService processService;
    @Autowired private WfDefinitionService definitionService;
    @Autowired private FormDefinitionService formDefinitionService;

    private long nextUser() {
        return 900001L + (System.nanoTime() % 100_000);
    }

    private Long create(long assignee, String title) {
        return taskService.createTask(TENANT, 1L, new CreateTaskRequest(
                "PURCHASE_APPROVAL", "PURCHASE_ORDER", "PO-" + System.nanoTime(),
                title, "PURCHASE_ORDER", assignee, "受理人", (short) 2, null, "{}", null, null, null));
    }

    private String createSingleApprovalFlow(String formCode, long approver) {
        String code = "KW_" + System.nanoTime();
        FormTestFixtures.register(formDefinitionService, TENANT, formCode, "关键词测试表单");
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "关键词测试流程", "APPROVAL", null, List.of(formCode), "{}",
                List.of(
                        new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("approve", "主管审批", "APPROVAL", 1, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + approver + "}", 24, "{}"),
                        new WfNodeDTO("end", "归档", "END", 2, null, null, null, "{}", null, "{}")
                )));
        definitionService.activate(defId, TENANT);
        return code;
    }

    private Long start(String code, String formCode, String bizId, long initiator) {
        return processService.startProcess(TENANT, new StartProcessRequest(
                code, "PURCHASE_ORDER", bizId, formCode, "{}", initiator, "发起人", null, null, "测试标题", null, null));
    }

    @Test
    @DisplayName("PR-04：/tasks/my 的 keyword 按标题过滤，仅命中匹配项")
    void myTasksKeywordFilters() {
        long assignee = nextUser();
        String marker = "ZKW" + System.nanoTime();
        Long hit = create(assignee, marker + "-命中");
        create(assignee, "无关标题-" + System.nanoTime());

        List<String> ids = taskService.myTasks(TENANT, assignee, null, 1, 100, marker)
                .getList().stream().map(TaskVO::id).toList();
        assertTrue(ids.contains(String.valueOf(hit)), "应命中标题含关键词的待办");
        assertEquals(1, ids.size(), "仅应命中 1 条（另一条标题不含关键词）: " + ids);
    }

    @Test
    @DisplayName("PR-04：/tasks/my 空 keyword 与不传 keyword 行为一致（零回归）")
    void myTasksEmptyKeywordSameAsNone() {
        long assignee = nextUser();
        create(assignee, "空A-" + System.nanoTime());
        create(assignee, "空B-" + System.nanoTime());

        var withEmpty = taskService.myTasks(TENANT, assignee, null, 1, 100, "");
        var withoutKw = taskService.myTasks(TENANT, assignee, null, 1, 100);
        assertTrue(withoutKw.getTotal() >= 2, "前置：应至少 2 条待办");
        assertEquals(withoutKw.getTotal(), withEmpty.getTotal(), "空关键词应与不传一致");
    }

    @Test
    @DisplayName("PR-04：/tasks/handled 的 keyword 按标题过滤")
    void handledTasksKeywordFilters() {
        long assignee = nextUser();
        String marker = "HKW" + System.nanoTime();
        Long hit = create(assignee, marker + "-已办");
        Long other = create(assignee, "其他已办-" + System.nanoTime());
        taskService.handleTask(TENANT, hit, new HandleTaskRequest("APPROVE", "同意", null), assignee);
        taskService.handleTask(TENANT, other, new HandleTaskRequest("APPROVE", "同意", null), assignee);

        List<String> ids = taskService.handledTasks(TENANT, assignee, 1, 100, marker)
                .getList().stream().map(TaskVO::id).toList();
        assertTrue(ids.contains(String.valueOf(hit)), "应命中已办中包含关键词的一条");
        assertEquals(1, ids.size(), "仅应命中 1 条: " + ids);
    }

    @Test
    @DisplayName("PR-04：/workflow/instances/my 的 keyword 按 businessId 过滤")
    void myInitiatedKeywordFilters() {
        long approver = 700701L;
        long initiator = nextUser();
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);

        String bizId = "PO-KW-" + System.nanoTime();
        Long mine = start(code, formCode, bizId, initiator);
        Long other = start(code, formCode, "PO-OTHER-" + System.nanoTime(), initiator);

        var page = processService.myInitiated(TENANT, initiator, null, 1, 100, bizId);
        List<String> ids = page.getList().stream().map(v -> v.id()).toList();
        assertTrue(ids.contains(String.valueOf(mine)), "应命中 businessId 含关键词的实例");
        assertTrue(!ids.contains(String.valueOf(other)), "不应命中其它实例");
    }

    @Test
    @DisplayName("PR-04：/workflow/instances/my 空 keyword 与不传一致（零回归）")
    void myInitiatedEmptyKeywordSameAsNone() {
        long approver = 700702L;
        long initiator = nextUser();
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        start(code, formCode, "PO-" + System.nanoTime(), initiator);

        var withEmpty = processService.myInitiated(TENANT, initiator, null, 1, 100, "");
        var withoutKw = processService.myInitiated(TENANT, initiator, null, 1, 100);
        assertEquals(withoutKw.getTotal(), withEmpty.getTotal(), "空关键词应与不传一致");
    }

    @Test
    @DisplayName("PR-04：/workflow/instances/my 显式 null keyword 与不传一致（回归防护：曾触发 lower(bytea)）")
    void myInitiatedNullKeywordSameAsNone() {
        long approver = 700703L;
        long initiator = nextUser();
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        start(code, formCode, "PO-" + System.nanoTime(), initiator);

        var withNull = processService.myInitiated(TENANT, initiator, null, 1, 100, (String) null);
        var withoutKw = processService.myInitiated(TENANT, initiator, null, 1, 100);
        assertEquals(withoutKw.getTotal(), withNull.getTotal(), "显式 null 关键词应与不传一致");
    }

    @Test
    @DisplayName("PR-04：/tasks/my 带 status 且 keyword=null 时退化为原查询（覆盖 findByAssignee 分支）")
    void myTasksWithStatusNullKeywordSameAsNone() {
        long assignee = nextUser();
        create(assignee, "带状态A-" + System.nanoTime());
        create(assignee, "带状态B-" + System.nanoTime());

        var withNull = taskService.myTasks(TENANT, assignee, "PENDING", 1, 100, (String) null);
        var withoutKw = taskService.myTasks(TENANT, assignee, "PENDING", 1, 100);
        assertTrue(withoutKw.getTotal() >= 2, "前置：应至少 2 条 PENDING 待办");
        assertEquals(withoutKw.getTotal(), withNull.getTotal(), "带 status、keyword=null 应与不传一致");
    }
}
