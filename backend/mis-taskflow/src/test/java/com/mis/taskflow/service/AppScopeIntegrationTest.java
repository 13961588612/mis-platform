package com.mis.taskflow.service;

import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.FormDefinition;
import com.mis.taskflow.domain.repository.SysMessageRepository;
import com.mis.taskflow.domain.repository.SysTaskRepository;
import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.CreateTaskRequest;
import com.mis.taskflow.dto.HandleTaskRequest;
import com.mis.taskflow.dto.MarkReadRequest;
import com.mis.taskflow.dto.MessageVO;
import com.mis.taskflow.dto.PublishMessageRequest;
import com.mis.taskflow.dto.TaskVO;
import com.mis.taskflow.dto.TransferTaskRequest;
import com.mis.taskflow.dto.UpsertFormDefinitionRequest;
import com.mis.taskflow.dto.WfNodeDTO;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import jakarta.persistence.EntityManager;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 应用级 vs 平台级归属「读写闭环」集成测试（返工后：app_code 显式化）。
 *
 * <p>返工要点（对齐 docs/design/biz-category-unification-design.md §2）：删除
 * {@code sys_app_biz_binding} / {@code AppScopeResolver} 后，「由业务类型推导 APP」的用例全部移除；
 * {@code app_code} 改为**显式写入**（{@code wf_instance.app_code} 为真实列，不再是派生）。
 *
 * <p>启用：{@code MIS_DB_TEST=true}（与既有集成测试同口径）。事务回滚，不污染数据。
 *
 * <p>覆盖：
 * <ul>
 *   <li>读侧 scope：{@code APP}/{@code PLATFORM}/{@code ALL} 在 message / task / wf_instance 三处一致；</li>
 *   <li>写入侧：显式 appCode 落库；空白归一为 NULL（平台级）；</li>
 *   <li>继承链：{@code startProcess(appCode='kb')} → 实例 app_code='kb' → 其 sys_task / sys_message 同为 'kb'；</li>
 *   <li>UPDATE 保留：handleTask / transferTask / markRead 后 app_code 不变。</li>
 * </ul>
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class AppScopeIntegrationTest {

    private static final long TENANT = 900001L;

    @Autowired
    private MessageService messageService;

    @Autowired
    private TaskService taskService;

    @Autowired
    private ProcessService processService;

    @Autowired
    private FormDefinitionService formService;

    @Autowired
    private WfDefinitionService definitionService;

    @Autowired
    private SysTaskRepository taskRepository;

    @Autowired
    private SysMessageRepository messageRepository;

    @Autowired
    private WfTaskRepository wfTaskRepository;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private EntityManager em;

    private long nextUser() {
        return 900001L + (System.nanoTime() % 100_000);
    }

    private Long publish(long receiver, String title, String appCode) {
        return messageService.publish(TENANT, new PublishMessageRequest(
                "APPROVAL", "TASK", title, "s", null, null, 1L, "系统",
                List.of(receiver), null, null, appCode, null));
    }

    private Long createTask(long assignee, String bizType, String appCode) {
        return taskService.createTask(TENANT, 1L, new CreateTaskRequest(
                "QA_TASK", bizType, "REF-" + System.nanoTime(), "QA待办-" + bizType,
                null, assignee, "受理人", (short) 1, null, "{}",
                "待办通知", "请及时处理", appCode));
    }

    // ------------------------------------------------------------------
    // 1) 读侧 scope 过滤（消息）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("收件箱 scope=APP 只返该 app_code、PLATFORM 只返 NULL、ALL 含二者")
    void inboxScopeFiltering() {
        long u = nextUser();
        Long kbMsg = publish(u, "QA-APP消息", "kb");
        Long platMsg = publish(u, "QA-平台消息", null);

        PageResult<MessageVO> app = messageService.inbox(TENANT, u, null, "kb", "APP", 1, 50);
        List<String> appIds = app.getList().stream().map(MessageVO::id).toList();
        assertTrue(appIds.contains(String.valueOf(kbMsg)), "scope=APP 应包含 kb 行");
        assertFalse(appIds.contains(String.valueOf(platMsg)), "scope=APP 不应包含平台级行");
        assertTrue(app.getList().stream().allMatch(v -> "kb".equals(v.appCode())), "scope=APP 结果 appCode 应全为 kb");

        PageResult<MessageVO> plat = messageService.inbox(TENANT, u, null, null, "PLATFORM", 1, 50);
        List<String> platIds = plat.getList().stream().map(MessageVO::id).toList();
        assertTrue(platIds.contains(String.valueOf(platMsg)), "scope=PLATFORM 应包含 NULL 行");
        assertFalse(platIds.contains(String.valueOf(kbMsg)), "scope=PLATFORM 不应包含 kb 行");
        assertTrue(plat.getList().stream().allMatch(v -> v.appCode() == null), "PLATFORM 结果 appCode 应全为 null");

        PageResult<MessageVO> all = messageService.inbox(TENANT, u, null, null, "ALL", 1, 50);
        List<String> allIds = all.getList().stream().map(MessageVO::id).toList();
        assertTrue(allIds.contains(String.valueOf(kbMsg)) && allIds.contains(String.valueOf(platMsg)),
                "scope=ALL 应同时含 kb 行与平台级行");
    }

    @Test
    @DisplayName("检索 scope=APP 只返该 app_code 命中")
    void searchScopeFiltering() {
        long u = nextUser();
        String mark = "ZQA" + System.nanoTime();
        Long kb = publish(u, mark + "-kb命中", "kb");
        Long plat = publish(u, mark + "-平台命中", null);

        PageResult<MessageVO> app = messageService.search(TENANT, u, null, mark, "kb", "APP", 1, 50);
        List<String> ids = app.getList().stream().map(MessageVO::id).toList();
        assertTrue(ids.contains(String.valueOf(kb)));
        assertFalse(ids.contains(String.valueOf(plat)));
    }

    // ------------------------------------------------------------------
    // 2) 写入侧：显式 app_code（不再推导）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("待办写入：显式 appCode 落库；空白 → NULL（平台级）")
    void taskWriteSideExplicit() {
        long a = nextUser();
        Long explicit = createTask(a, "QA_BIZ_X", "kb");
        Long blank = createTask(a, "QA_BIZ_X", "   ");

        assertEquals("kb", taskRepository.findById(explicit).orElseThrow().getAppCode(), "显式 appCode 应落库");
        assertNull(taskRepository.findById(blank).orElseThrow().getAppCode(), "空白应落 NULL（平台级）");
    }

    @Test
    @DisplayName("M2：任务关联通知继承同任务的 app_code")
    void notificationInheritsTaskAppCode() {
        long a = nextUser();
        Long t = createTask(a, "QA_BIZ_X", "kb");
        var messages = messageRepository.findByReferenceTaskIdAndDeleted(t, 0);
        assertEquals(1, messages.size(), "应生成一条关联通知");
        assertEquals("kb", messages.get(0).getAppCode(), "M2 通知应继承任务的 app_code");
    }

    @Test
    @DisplayName("待办 scope 过滤：APP 只返该 appCode、PLATFORM 只返 NULL、ALL 含全部")
    void myTasksScopeFiltering() {
        long a = nextUser();
        Long kbTask = createTask(a, "QA_BIZ_X", "kb");
        Long platTask = createTask(a, "QA_BIZ_X", null);

        PageResult<TaskVO> app = taskService.myTasks(TENANT, a, null, null, "kb", "APP", 1, 50);
        List<String> appIds = app.getList().stream().map(TaskVO::id).toList();
        assertTrue(appIds.contains(String.valueOf(kbTask)));
        assertFalse(appIds.contains(String.valueOf(platTask)));
        assertTrue(app.getList().stream().allMatch(v -> "kb".equals(v.appCode())));

        PageResult<TaskVO> plat = taskService.myTasks(TENANT, a, null, null, null, "PLATFORM", 1, 50);
        List<String> platIds = plat.getList().stream().map(TaskVO::id).toList();
        assertTrue(platIds.contains(String.valueOf(platTask)));
        assertFalse(platIds.contains(String.valueOf(kbTask)));
        assertTrue(plat.getList().stream().allMatch(v -> v.appCode() == null));

        PageResult<TaskVO> all = taskService.myTasks(TENANT, a, null, null, null, "ALL", 1, 50);
        List<String> allIds = all.getList().stream().map(TaskVO::id).toList();
        assertTrue(allIds.contains(String.valueOf(kbTask)) && allIds.contains(String.valueOf(platTask)));
    }

    // ------------------------------------------------------------------
    // 3) 继承链：启动流程 → 实例 / 待办 / 通知 同源
    // ------------------------------------------------------------------

    @Test
    @DisplayName("继承链：startProcess(appCode='kb') → 实例 app_code='kb' → 其分派待办继承 'kb'")
    void startProcessInheritsAppCode() {
        String formCode = "QA_FORM_" + System.nanoTime();
        formService.create(TENANT, 1L, new UpsertFormDefinitionRequest(
                null, formCode, "QA表单", null, FormDefinition.STATUS_ENABLED, 0, "{}"));
        String flowCode = "QA_FLOW_" + System.nanoTime();
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                flowCode, "QA流程", "APPROVAL", null, List.of(formCode), "{}", List.of(
                new WfNodeDTO("start", "提交", "START", 0, null, null, null, "{}", null, "{}"),
                new WfNodeDTO("approve", "主管审批", "APPROVAL", 1, null, null, null,
                        "{\"type\":\"FIXED\",\"value\":700001}", 24, "{}"),
                new WfNodeDTO("end", "归档", "END", 2, null, null, null, "{}", null, "{}"))));
        definitionService.activate(defId, TENANT);

        Long instId = processService.startProcess(TENANT, new com.mis.taskflow.dto.StartProcessRequest(
                flowCode, "PURCHASE_ORDER", "QA-" + System.nanoTime(), formCode,
                "{}", 100L, "发起人", "kb", null, "测试标题", null, null));

        // A1：实例显式落库
        // QA 修复（测试代码缺陷，非功能缺陷）：startProcess 的 wf_instance INSERT 在本测试事务内
        // 仍是挂起写，JdbcTemplate 虽复用同一连接但看不到未 flush 的行；先 flush 再读。
        em.flush();
        assertEquals("kb", jdbc.queryForObject(
                "select app_code from wf_instance where id = ?", String.class, instId),
                "实例 app_code 应由发起方显式写入");

        // A2：分派待办继承实例 app_code
        var tasks = wfTaskRepository.findPendingByInstance(instId);
        assertFalse(tasks.isEmpty(), "应分派待办");
        Long sysTaskId = tasks.get(0).getSysTaskId();
        assertEquals("kb", taskRepository.findById(sysTaskId).orElseThrow().getAppCode(),
                "分派待办应继承实例的 app_code");
    }

    // ------------------------------------------------------------------
    // 4) UPDATE 路径不清空（回归红线）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("handleTask 后 app_code 保持原值")
    void handleTaskPreservesAppCode() {
        long a = nextUser();
        Long t = createTask(a, "QA_BIZ_X", "kb");
        taskService.handleTask(TENANT, t, new HandleTaskRequest("APPROVE", "同意", null), a);
        assertEquals("kb", taskRepository.findById(t).orElseThrow().getAppCode(), "处理不得清空 app_code");
    }

    @Test
    @DisplayName("transferTask 后 app_code 保持原值，且转办提醒沿用原值（M3）")
    void transferTaskPreservesAppCode() {
        long a = nextUser();
        long b = nextUser();
        Long t = createTask(a, "QA_BIZ_X", "kb");
        taskService.transferTask(TENANT, t, new TransferTaskRequest(b, "新人", "请处理"), a);

        assertEquals("kb", taskRepository.findById(t).orElseThrow().getAppCode(), "转办不得清空 app_code");
        var messages = messageRepository.findByReferenceTaskIdAndDeleted(t, 0);
        assertTrue(messages.stream().allMatch(m -> "kb".equals(m.getAppCode())),
                "M2/M3 关联通知的 app_code 应全部沿用 kb");
    }

    @Test
    @DisplayName("markRead 后消息 app_code 保持原值")
    void markReadPreservesAppCode() {
        long u = nextUser();
        Long m = publish(u, "QA-已读保持", "kb");
        messageService.markRead(new MarkReadRequest(List.of(m)), u);
        assertEquals("kb", messageRepository.findById(m).orElseThrow().getAppCode(), "标已读不得清空 app_code");
    }
}
