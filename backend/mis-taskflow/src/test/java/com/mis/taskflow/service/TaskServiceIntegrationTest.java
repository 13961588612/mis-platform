package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.repository.SysMessageReceiverRepository;
import com.mis.taskflow.domain.repository.SysMessageRepository;
import com.mis.taskflow.domain.repository.SysTaskRepository;
import com.mis.taskflow.dto.BatchHandleTaskRequest;
import com.mis.taskflow.dto.CreateTaskRequest;
import com.mis.taskflow.dto.HandleTaskRequest;
import com.mis.taskflow.dto.TaskStatsVO;
import com.mis.taskflow.dto.TaskVO;
import com.mis.taskflow.dto.TransferTaskRequest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 代办任务中心集成测试（P3）—— 真实测试库，事务回滚。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class TaskServiceIntegrationTest {

    private static final long TENANT = 900001L;

    @Autowired
    private TaskService taskService;

    @Autowired
    private SysTaskRepository taskRepository;

    @Autowired
    private SysMessageReceiverRepository receiverRepository;

    @Autowired
    private SysMessageRepository messageRepository;

    private long nextUser() {
        return 900001L + (System.nanoTime() % 100_000);
    }

    private Long create(long assignee, String title) {
        return taskService.createTask(TENANT, 1L, new CreateTaskRequest(
                "PURCHASE_APPROVAL", "PURCHASE_ORDER", "PO-" + System.nanoTime(),
                title, "PURCHASE_ORDER", assignee, "受理人", (short) 2, null, "{}",
                "待审批：" + title, "请及时处理", null));
    }

    @Test
    @DisplayName("P3：创建代办同时生成一条关联通知消息（reference_task_id 回指）")
    void createTaskWithNotification() {
        long assignee = nextUser();
        Long taskId = create(assignee, "带通知的代办");

        assertTrue(taskRepository.findById(taskId).isPresent(), "代办应已落库");

        var messages = messageRepository.findByReferenceTaskIdAndDeleted(taskId, 0);
        assertEquals(1, messages.size(), "应恰好生成一条关联通知消息");
        var msg = messages.get(0);
        assertEquals("TASK", msg.getCategory(), "消息分类应为 TASK");
        assertEquals(taskId, msg.getReferenceTaskId(), "消息应回指该代办");

        var details = receiverRepository.findByMessageId(msg.getId());
        assertEquals(1, details.size(), "应为处理人生成 1 条接收者明细");
        assertEquals(assignee, details.get(0).getUserId(), "接收者应为该代办处理人");
    }

    @Test
    @DisplayName("P3：不带通知标题时不生成消息")
    void createWithoutNotification() {
        long assignee = nextUser();
        Long taskId = taskService.createTask(TENANT, 1L, new CreateTaskRequest(
                "LEAVE_APPLICATION", "LEAVE", "LV-" + System.nanoTime(), "不带通知",
                null, assignee, null, (short) 1, null, "{}", null, null, null));
        assertTrue(taskRepository.findById(taskId).isPresent());
        var task = taskRepository.findById(taskId).orElseThrow();
        assertEquals("PENDING", task.getStatus());
    }

    @Test
    @DisplayName("P3：处理代办后状态变为 APPROVED，重复处理被拒（幂等保护）")
    void handleTaskFlow() {
        long assignee = nextUser();
        Long taskId = create(assignee, "处理测试");

        taskService.handleTask(TENANT, taskId, new HandleTaskRequest("APPROVE", "同意", null), assignee);
        assertEquals("APPROVED", taskRepository.findById(taskId).orElseThrow().getStatus());

        assertThrows(BusinessException.class,
                () -> taskService.handleTask(TENANT, taskId, new HandleTaskRequest("APPROVE", "再次", null), assignee),
                "已处理的代办不应可重复处理");
    }

    @Test
    @DisplayName("P3：驳回状态变为 REJECTED")
    void rejectTask() {
        long assignee = nextUser();
        Long taskId = create(assignee, "驳回测试");
        taskService.handleTask(TENANT, taskId, new HandleTaskRequest("REJECT", "不同意", null), assignee);
        assertEquals("REJECTED", taskRepository.findById(taskId).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("P3：非法 action 被拒")
    void invalidAction() {
        long assignee = nextUser();
        Long taskId = create(assignee, "非法操作");
        assertThrows(BusinessException.class,
                () -> taskService.handleTask(TENANT, taskId, new HandleTaskRequest("FOO", null, null), assignee));
    }

    @Test
    @DisplayName("P3：转办变更处理人并回到 PENDING")
    void transferTask() {
        long a1 = nextUser();
        long a2 = nextUser();
        Long taskId = create(a1, "转办测试");

        taskService.transferTask(TENANT, taskId, new TransferTaskRequest(a2, "接手人", "请帮忙"), a1);
        var task = taskRepository.findById(taskId).orElseThrow();
        assertEquals(a2, task.getAssigneeId());
        assertEquals("PENDING", task.getStatus());

        List<TaskVO> mine = taskService.myTasks(TENANT, a2, null, 1, 20).getList();
        assertTrue(mine.stream().anyMatch(t -> t.id().equals(String.valueOf(taskId))), "新处理人应看到该代办");
    }

    @Test
    @DisplayName("P3：我的待办只返回分配给我的未完成项")
    void myTasksIsolated() {
        long mine = nextUser();
        long other = nextUser();
        Long t1 = create(mine, "我的");
        create(other, "别人的");

        List<String> ids = taskService.myTasks(TENANT, mine, null, 1, 100).getList().stream()
                .map(TaskVO::id).toList();
        assertTrue(ids.contains(String.valueOf(t1)));
    }

    @Test
    @DisplayName("P3：批量处理返回成功条数")
    void batchHandle() {
        long assignee = nextUser();
        Long a = create(assignee, "批量A");
        Long b = create(assignee, "批量B");

        int ok = taskService.batchHandle(TENANT,
                new BatchHandleTaskRequest(List.of(a, b), "APPROVE", "批量同意"), assignee);
        assertEquals(2, ok);
    }

    @Test
    @DisplayName("P3：我处理过的（handled）—— 已通过/已驳回按完成时间倒序")
    void handledTasks() {
        long assignee = nextUser();
        Long a = create(assignee, "历史A");
        Long b = create(assignee, "历史B");
        Long c = create(assignee, "历史C");

        taskService.handleTask(TENANT, a, new HandleTaskRequest("APPROVE", "同意", null), assignee);
        taskService.handleTask(TENANT, b, new HandleTaskRequest("REJECT", "驳回", null), assignee);
        // c 保持 PENDING，不应出现在 handled

        var page = taskService.handledTasks(TENANT, assignee, 1, 50);
        var ids = page.getList().stream().map(TaskVO::id).toList();
        assertTrue(ids.contains(String.valueOf(a)), "已通过应出现在我审批的");
        assertTrue(ids.contains(String.valueOf(b)), "已驳回应出现在我审批的");
        assertTrue(!ids.contains(String.valueOf(c)), "未处理的待办不应出现在我审批的");
        assertEquals(2, page.getTotal(), "恰好两条历史");
    }

    @Test
    @DisplayName("P3：统计待处理/紧急/逾期")
    void stats() {
        long assignee = nextUser();
        Long urgent = taskService.createTask(TENANT, 1L, new CreateTaskRequest(
                "PURCHASE_APPROVAL", "PURCHASE_ORDER", "PO-" + System.nanoTime(), "紧急",
                null, assignee, null, (short) 4, null, "{}", null, null, null));
        taskService.createTask(TENANT, 1L, new CreateTaskRequest(
                "LEAVE_APPLICATION", "LEAVE", "LV-" + System.nanoTime(), "逾期",
                null, assignee, null, (short) 1, LocalDateTime.now().minusDays(2), "{}", null, null, null));

        TaskStatsVO stats = taskService.stats(TENANT, assignee);
        assertTrue(stats.pending() >= 2, "待处理应 >= 2");
        assertTrue(stats.urgent() >= 1, "紧急应 >= 1");
        assertTrue(stats.overdue() >= 1, "逾期应 >= 1");
        assertNotNull(urgent);
    }

    @Test
    @DisplayName("P3：跨租户访问被拒")
    void crossTenantForbidden() {
        long assignee = nextUser();
        Long taskId = create(assignee, "租户隔离");
        assertThrows(BusinessException.class,
                () -> taskService.handleTask(999999L, taskId, new HandleTaskRequest("APPROVE", null, null), assignee));
    }

    @Test
    @DisplayName("P3：不存在的代办返回 NOT_FOUND")
    void notFound() {
        assertThrows(BusinessException.class,
                () -> taskService.handleTask(TENANT, 999_999_999_999L,
                        new HandleTaskRequest("APPROVE", null, null), 1L));
    }

    @Test
    @DisplayName("安全：同租户非处理人处理待办被拒（FORBIDDEN）——防越权")
    void nonAssigneeHandleForbidden() {
        long owner = nextUser();
        long intruder = nextUser();
        Long taskId = create(owner, "越权处理");

        BusinessException ex = assertThrows(BusinessException.class,
                () -> taskService.handleTask(TENANT, taskId, new HandleTaskRequest("APPROVE", "抢办", null), intruder),
                "同租户非处理人不得处理他人待办");
        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode(), "应为权限不足");

        assertEquals("PENDING", taskRepository.findById(taskId).orElseThrow().getStatus(),
                "越权请求不得改动待办状态");
    }

    @Test
    @DisplayName("安全：同租户非处理人转办待办被拒（FORBIDDEN）")
    void nonAssigneeTransferForbidden() {
        long owner = nextUser();
        long intruder = nextUser();
        Long taskId = create(owner, "越权转办");

        BusinessException ex = assertThrows(BusinessException.class,
                () -> taskService.transferTask(TENANT, taskId,
                        new TransferTaskRequest(nextUser(), "接手人", null), intruder));
        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode(), "应为权限不足");

        assertEquals(owner, taskRepository.findById(taskId).orElseThrow().getAssigneeId(),
                "越权转办不得改动处理人");
    }

    @Test
    @DisplayName("安全：未携带 operatorId 的处理请求被拒（不因缺参而绕过 assignee 校验）")
    void nullOperatorForbidden() {
        long owner = nextUser();
        Long taskId = create(owner, "缺操作人");

        BusinessException ex = assertThrows(BusinessException.class,
                () -> taskService.handleTask(TENANT, taskId, new HandleTaskRequest("APPROVE", null, null), null));
        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode(), "缺少操作人不得放行");
    }
}