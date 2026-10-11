package com.mis.taskflow.service;

import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.dto.CompleteWfTaskRequest;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.MessageVO;
import com.mis.taskflow.dto.PublishMessageRequest;
import com.mis.taskflow.dto.StartProcessRequest;
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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PR-08 / PR-18 消息↔流程实例关联集成测试 —— 真实库，事务回滚。
 *
 * <p>验签：{@code ProcessService.notify} 产生的 NOTIFY 消息 {@code instanceId} 非空、
 * {@code canReply=true}；无实例或非 NOTIFY 的消息 {@code canReply=false}（前端隐藏回复入口的权威口径）。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class MessageInstanceLinkTest {

    private static final long TENANT = 900001L;

    @Autowired private WfDefinitionService definitionService;
    @Autowired private FormDefinitionService formDefinitionService;
    @Autowired private ProcessService processService;
    @Autowired private MessageService messageService;
    @Autowired private WfTaskRepository wfTaskRepository;

    private String uniqueCode() {
        return "LINK_" + System.nanoTime();
    }

    private String createSingleApprovalFlow(String formCode, long approver) {
        String code = uniqueCode();
        FormTestFixtures.register(formDefinitionService, TENANT, formCode, "关联测试表单");
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "关联测试流程", "APPROVAL", null, List.of(formCode), "{}",
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
                code, "PURCHASE_ORDER", bizId, formCode, "{}", initiator, "发起人", null));
    }

    @Test
    @DisplayName("PR-08：审批通过触发 notify，其 NOTIFY 消息 instanceId 非空且 canReply=true")
    void notifyCarriesInstanceAndIsReplyable() {
        long approver = 700501L;
        long initiator = 700601L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime(), initiator);

        Long wfTaskId = wfTaskRepository.findPendingByInstance(instId).get(0).getId();
        processService.completeTask(TENANT, wfTaskId, new CompleteWfTaskRequest("APPROVE", "同意"), approver);

        MessageVO vo = messageService.inbox(TENANT, initiator, "NOTIFY", 1, 50).getList().stream()
                .filter(v -> String.valueOf(instId).equals(v.instanceId()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("notify 应产生一条 instanceId 指向该实例的 NOTIFY 消息"));
        assertNotNull(vo.instanceId(), "NOTIFY 消息应携带实例线索");
        assertTrue(vo.canReply(), "有关联实例的 NOTIFY 消息应可回复");
    }

    @Test
    @DisplayName("PR-08：驳回触发 notify，其 NOTIFY 消息同样携带 instanceId 且可回复")
    void rejectNotifyCarriesInstance() {
        long approver = 700502L;
        long initiator = 700602L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime(), initiator);

        Long wfTaskId = wfTaskRepository.findPendingByInstance(instId).get(0).getId();
        processService.completeTask(TENANT, wfTaskId, new CompleteWfTaskRequest("REJECT", "不同意"), approver);

        MessageVO vo = messageService.inbox(TENANT, initiator, "NOTIFY", 1, 50).getList().stream()
                .filter(v -> String.valueOf(instId).equals(v.instanceId()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("驳回通知应携带实例线索"));
        assertTrue(vo.canReply(), "有关联实例的驳回通知应可回复");
    }

    @Test
    @DisplayName("PR-18：无实例的 NOTIFY 消息 canReply=false、instanceId=null")
    void notifyWithoutInstanceNotReplyable() {
        long receiver = 700603L;
        Long msgId = messageService.publish(TENANT, new PublishMessageRequest(
                "NOTIFY", "ANNOUNCEMENT", "纯公告", "summary", null, null,
                1L, "系统", List.of(receiver), null, null, null, null));

        MessageVO vo = messageService.inbox(TENANT, receiver, "NOTIFY", 1, 50).getList().stream()
                .filter(v -> String.valueOf(msgId).equals(v.id()))
                .findFirst().orElseThrow();
        assertNull(vo.instanceId(), "无关联实例应为 null");
        assertFalse(vo.canReply(), "无实例的 NOTIFY 不应可回复");
    }

    @Test
    @DisplayName("PR-18：非 NOTIFY 消息即使带 instanceId 也 canReply=false（口径：msgType=='NOTIFY'）")
    void nonNotifyNotReplyable() {
        long receiver = 700604L;
        Long msgId = messageService.publish(TENANT, new PublishMessageRequest(
                "APPROVAL", "TASK", "待办提醒", "summary", null, null,
                1L, "系统", List.of(receiver), null, 700000001L, null, null));

        MessageVO vo = messageService.inbox(TENANT, receiver, "APPROVAL", 1, 50).getList().stream()
                .filter(v -> String.valueOf(msgId).equals(v.id()))
                .findFirst().orElseThrow();
        assertNotNull(vo.instanceId(), "实例线索应保留");
        assertFalse(vo.canReply(), "非 NOTIFY 消息不可回复");
    }

    @Test
    @DisplayName("PR-08：消息详情同样透出 instanceId / canReply")
    void detailExposesInstanceIdAndCanReply() {
        long receiver = 700605L;
        Long msgId = messageService.publish(TENANT, new PublishMessageRequest(
                "NOTIFY", "TASK", "流程通知", "summary", null, null,
                1L, "系统", List.of(receiver), null, 700000002L, null, null));

        var detail = messageService.detail(msgId, receiver);
        assertEquals("700000002", detail.instanceId(), "详情应透出 instanceId");
        assertTrue(detail.canReply(), "详情 canReply 应与列表一致");
    }
}
