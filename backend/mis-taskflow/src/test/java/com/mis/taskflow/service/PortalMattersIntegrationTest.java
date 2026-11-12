package com.mis.taskflow.service;

import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.CreateTaskRequest;
import com.mis.taskflow.dto.PortalMatterVO;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.dto.WfNodeDTO;
import com.mis.taskflow.support.AppScope;
import com.mis.taskflow.support.FormTestFixtures;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 门户「待办事项 · 全部」聚合（{@code GET /internal/v1/tasks/matters}）集成测试 —— 真实库，事务回滚。
 *
 * <p>对应设计 tasks 文档 T02 验收点：
 * <ul>
 *   <li>三源各造 1 行 + 交集 1 行，「全部」返回行数与组成符合预期；</li>
 *   <li>{@code wf_task.sys_task_id} 非唯一导致的「同实例多 {@code wf_task}」不引起行数膨胀；</li>
 *   <li>发起人/参与人过滤生效；</li>
 *   <li>{@code scope=ALL/PLATFORM} 三态正确；</li>
 *   <li>分页 {@code total} 与逐页一致；</li>
 *   <li>既有端点不传新参数时与传 null 逐字等价（零回归）。</li>
 * </ul>
 *
 * <p><b>为什么是本仓「首次」重点</b>：{@code SysTaskRepository}/{@code WfInstanceRepository}
 * 本轮新增的 JPQL「跨实体相关子查询」在全仓无先例，且 {@code /matters} 用的是 native 动态 SQL；
 * 二者只有在真实 Hibernate/PG 上引导上下文时才会被真正解析、校验。本测试启动完整 Spring
 * 上下文（触发全部仓储查询方法初始化）并跑通聚合链路，是这两类风险的唯一有效验证。
 *
 * <p>与既有集成测试同范式：{@code @SpringBootTest @Transactional} +
 * {@code @EnabledIfEnvironmentVariable(MIS_DB_TEST=true)}（未显式提供库环境则静默跳过）。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class PortalMattersIntegrationTest {

    private static final long TENANT = 900001L;

    @Autowired private PortalMattersService portalMattersService;
    @Autowired private TaskService taskService;
    @Autowired private ProcessService processService;
    @Autowired private WfDefinitionService definitionService;
    @Autowired private FormDefinitionService formDefinitionService;

    private long nextUser() {
        // 与既有集成测试同口径：为每个用例造一个几乎不可能与其它用例/租户冲突的 userId。
        return 900001L + (System.nanoTime() % 100_000);
    }

    /** 单级审批流程（START → APPROVAL(FIXED) → END）；返回 {@code "流程编码|表单编码"}。 */
    private String[] createSingleApprovalFlow(String label, long approver) {
        String code = "MAT_" + label + "_" + System.nanoTime();
        String formCode = "FORM_" + System.nanoTime();
        FormTestFixtures.register(formDefinitionService, TENANT, formCode, "聚合测试表单");
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "聚合测试流程", "APPROVAL", null, List.of(formCode), "{}",
                List.of(
                        new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                        new WfNodeDTO("approve", "主管审批", "APPROVAL", 1, null, null, null,
                                "{\"type\":\"FIXED\",\"value\":" + approver + "}", 24, "{}"),
                        new WfNodeDTO("end", "归档", "END", 2, null, null, null, "{}", null, "{}")
                )));
        definitionService.activate(defId, TENANT);
        return new String[] { code, formCode };
    }

    private Long start(String code, String formCode, String bizId, long initiator) {
        return processService.startProcess(TENANT, new StartProcessRequest(
                code, "PURCHASE_ORDER", bizId, formCode, "{}", initiator, "发起人", null, null, "测试标题", null, null));
    }

    private Long createTask(long assignee, String title) {
        return taskService.createTask(TENANT, 1L, new CreateTaskRequest(
                "PURCHASE_APPROVAL", "PURCHASE_ORDER", "PO-" + System.nanoTime(),
                title, "PURCHASE_ORDER", assignee, "受理人", (short) 2, null, "{}", null, null, null));
    }

    /** 造场景：① 独立待办（仅 TASK 行）；② 我发起且审批人=我的实例（INSTANCE 行 + 其审批 TASK 行的重叠）；③ 我发起但审批人=他人（仅 INSTANCE 行）。 */
    private record Scene(long mine, long other, Long taskOnly, Long instSelf, Long instOther) {
    }

    private Scene buildScene() {
        long mine = nextUser();
        long other = nextUser();
        // ① 独立待办：assignee=mine，无关联实例 ⇒ 分支 A 的「无实例退化」路径。
        Long taskOnly = createTask(mine, "独立待办-" + System.nanoTime());
        // ② 审批人=我：实例 initiator=mine（分支 B）且引擎为其生成 assignee=mine 的审批 sys_task（分支 A）⇒ 重叠。
        String[] selfFlow = createSingleApprovalFlow("SELF", mine);
        Long instSelf = start(selfFlow[0], selfFlow[1], "PO-SELF-" + System.nanoTime(), mine);
        // ③ 审批人=他人：仅分支 B。
        String[] otherFlow = createSingleApprovalFlow("OTHER", other);
        Long instOther = start(otherFlow[0], otherFlow[1], "PO-OTHER-" + System.nanoTime(), mine);
        return new Scene(mine, other, taskOnly, instSelf, instOther);
    }

    private static boolean has(List<PortalMatterVO> rows, String kind, String id) {
        return rows.stream().anyMatch(v -> kind.equals(v.kind()) && id.equals(v.id()));
    }

    @Test
    @DisplayName("T02：三源各 1 行 + 交集 1 行 —— 「全部」返回 4 行且重叠实例字面保留 TASK/INSTANCE 两行")
    void aggregatesThreeSourcesWithOverlap() {
        Scene s = buildScene();

        var page = portalMattersService.matters(TENANT, s.mine(), null, null, null, null, null, 1, 100);
        List<PortalMatterVO> rows = page.getList();

        // 总数为 (分支 A: taskOnly + instSelf 的审批 sys_task) + (分支 B: instSelf + instOther) = 4。
        assertEquals(4L, page.getTotal(), "「全部」应为 4 行：" + rows);
        assertEquals(4, rows.size(), "size=100 时单页应取回全部 4 行");
        // 发起时间：native 时间列类型转换不得静默丢空（前端「全部」Tab 发起时间列依赖此字段）。
        assertTrue(rows.stream().allMatch(v -> v.createdAt() != null),
                "每行 createdAt 非空：" + rows);

        // 独立待办：kind=TASK，无实例（instanceId=null）。
        assertTrue(has(rows, "TASK", String.valueOf(s.taskOnly())), "应含独立待办 TASK 行");
        assertTrue(rows.stream().anyMatch(v -> "TASK".equals(v.kind())
                        && String.valueOf(s.taskOnly()).equals(v.id()) && v.instanceId() == null),
                "独立待办应无关联实例（instanceId=null）");

        // 两个实例：均以 kind=INSTANCE 出现（我发起的）。
        assertTrue(has(rows, "INSTANCE", String.valueOf(s.instSelf())), "应含我发起且我审批的实例 INSTANCE 行");
        assertTrue(has(rows, "INSTANCE", String.valueOf(s.instOther())), "应含我发起但他人审批的实例 INSTANCE 行");

        // 重叠（主理人裁定#1）：instSelf 同时以 INSTANCE 行与 TASK 行出现，字面两行，不做语义去重。
        long rowsOfInstSelf = rows.stream()
                .filter(v -> String.valueOf(s.instSelf()).equals(v.instanceId()))
                .count();
        assertEquals(2L, rowsOfInstSelf, "重叠实例应字面保留 TASK + INSTANCE 两行");

        // 他人审批的实例不应在分支 A 出现（其审批 sys_task 的 assignee=other，不属于「我」）。
        assertFalse(rows.stream().anyMatch(v -> "TASK".equals(v.kind())
                        && String.valueOf(s.instOther()).equals(v.instanceId())),
                "他人审批的实例的分支 A 任务不应算作我的待办");
    }

    @Test
    @DisplayName("T02：发起人过滤 —— 命中实例 initiator_name，TASK 行随其所属实例一并命中；无实例的独立待办被排除")
    void initiatorFilterMatchesInstanceInitiator() {
        Scene s = buildScene();

        var page = portalMattersService.matters(TENANT, s.mine(), null, "发起人", null, null, null, 1, 100);
        List<PortalMatterVO> rows = page.getList();

        assertTrue(has(rows, "INSTANCE", String.valueOf(s.instSelf())), "发起人「发起人」应命中我发起的实例");
        assertTrue(has(rows, "INSTANCE", String.valueOf(s.instOther())), "发起人「发起人」应命中另一实例");
        // instSelf 的审批 TASK 行，其所属实例发起人也是「发起人」⇒ 一并命中。
        assertTrue(rows.stream().anyMatch(v -> "TASK".equals(v.kind())
                        && String.valueOf(s.instSelf()).equals(v.instanceId())),
                "有实例的 TASK 行应随所属实例的发起人过滤命中");
        // 独立待办无实例 ⇒ 发起人过滤应排除它（COALESCE(NULL,'') 不匹配）。
        assertFalse(has(rows, "TASK", String.valueOf(s.taskOnly())), "无实例的独立待办不应命中发起人过滤");
    }

    @Test
    @DisplayName("T02：参与人过滤 —— 无实例行按 assignee_name 命中（覆盖「退化分支」）")
    void participantFilterMatchesTaskAssignee() {
        Scene s = buildScene();

        // 独立待办的 sys_task.assignee_name = 「受理人」；无实例 ⇒ 参与人过滤退化为 m.assignee_name。
        var page = portalMattersService.matters(TENANT, s.mine(), null, null, "受理人", null, null, 1, 100);
        List<PortalMatterVO> rows = page.getList();
        assertTrue(has(rows, "TASK", String.valueOf(s.taskOnly())),
                "参与人「受理人」应命中独立待办（无实例退化分支）");
    }

    @Test
    @DisplayName("T02：scope=PLATFORM 与 ALL 一致（本场景 app_code 均为 null）；scope=APP+appCode=null 不加过滤")
    void appScopeThreeState() {
        Scene s = buildScene();

        long allTotal = portalMattersService.matters(TENANT, s.mine(), null, null, null, null, AppScope.SCOPE_ALL, 1, 100).getTotal();
        long platformTotal = portalMattersService.matters(TENANT, s.mine(), null, null, null, null, AppScope.SCOPE_PLATFORM, 1, 100).getTotal();
        assertEquals(allTotal, platformTotal, "本场景 app_code 全为 null ⇒ PLATFORM 与 ALL 结果一致");
        assertEquals(4L, platformTotal, "PLATFORM 应含全部 4 行");

        // scope=APP 但 appCode 缺省 ⇒ 由 Service 归一为「不加 app_code 条件」（与既有 myTasks 口径一致）。
        long appNullTotal = portalMattersService.matters(TENANT, s.mine(), null, null, null, null, AppScope.SCOPE_APP, 1, 100).getTotal();
        assertEquals(allTotal, appNullTotal, "APP 但 appCode 缺省 ⇒ 不加过滤，应与 ALL 一致");
    }

    @Test
    @DisplayName("T02：分页 total 与逐页一致（size=2 时两页恰好覆盖 4 行且无重复）")
    void paginationConsistent() {
        Scene s = buildScene();

        var p1 = portalMattersService.matters(TENANT, s.mine(), null, null, null, null, null, 1, 2);
        var p2 = portalMattersService.matters(TENANT, s.mine(), null, null, null, null, null, 2, 2);
        assertEquals(4L, p1.getTotal(), "total 不受页大小影响");
        assertEquals(4L, p2.getTotal(), "total 跨页稳定");
        assertEquals(2, p1.getList().size(), "第 1 页应为 2 行");
        assertEquals(2, p2.getList().size(), "第 2 页应为 2 行");

        var idsPage1 = p1.getList().stream().map(v -> v.kind() + "#" + v.id()).toList();
        var idsPage2 = p2.getList().stream().map(v -> v.kind() + "#" + v.id()).toList();
        assertTrue(java.util.Collections.disjoint(idsPage1, idsPage2), "两页不得有重复行");
        assertEquals(4, idsPage1.size() + idsPage2.size(), "两页合计应恰为 4 行");
    }

    @Test
    @DisplayName("T02 零回归：既有 /tasks/my 不传新参数与显式 null 逐字等价")
    void myTasksZeroRegression() {
        long mine = nextUser();
        createTask(mine, "回归A-" + System.nanoTime());
        createTask(mine, "回归B-" + System.nanoTime());

        long withoutParams = taskService.myTasks(TENANT, mine, null, 1, 100).getTotal();
        long withNullParams = taskService.myTasks(TENANT, mine, null, null, null, null, null, null, 1, 100).getTotal();
        assertTrue(withoutParams >= 2, "前置：应至少 2 条待办");
        assertEquals(withoutParams, withNullParams, "不传/传 null 发起人·参与人应与原查询逐字等价");
    }

    @Test
    @DisplayName("T02 零回归：既有 /workflow/instances/my 不传新参数与显式 null 逐字等价")
    void myProcessesZeroRegression() {
        long mine = nextUser();
        long approver = nextUser();
        String[] flow = createSingleApprovalFlow("REG", approver);
        start(flow[0], flow[1], "PO-REG-" + System.nanoTime(), mine);

        long withoutParams = processService.myInitiated(TENANT, mine, null, 1, 100).getTotal();
        long withNullParams = processService.myInitiated(TENANT, mine, null, null, null, null, null, null, 1, 100).getTotal();
        assertTrue(withoutParams >= 1, "前置：应至少 1 个实例");
        assertEquals(withoutParams, withNullParams, "不传/传 null 发起人·参与人应与原查询逐字等价");
    }
}
