package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.taskflow.domain.entity.WfHistory;
import com.mis.taskflow.domain.repository.WfHistoryRepository;
import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.dto.CompleteWfTaskRequest;
import com.mis.taskflow.dto.CreateDefinitionRequest;
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
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PR-18 回复消息回写审批意见集成测试 —— 真实库，事务回滚。
 *
 * <p>验签：{@code replyToMessage} 在消息所关联的流程实例上追加一条
 * {@code wf_history(operation=COMMENT)}；无关联实例的消息回复被拒（VALIDATION_ERROR）。
 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class ProcessServiceReplyTest {

    private static final long TENANT = 900001L;

    @Autowired private WfDefinitionService definitionService;
    @Autowired private FormDefinitionService formDefinitionService;
    @Autowired private ProcessService processService;
    @Autowired private MessageService messageService;
    @Autowired private WfHistoryRepository historyRepository;
    @Autowired private WfTaskRepository wfTaskRepository;

    private String uniqueCode() {
        return "RPLY_" + System.nanoTime();
    }

    /** 建一个单级审批流程：START → APPROVAL(FIXED) → END。 */
    private String createSingleApprovalFlow(String formCode, long approver) {
        String code = uniqueCode();
        FormTestFixtures.register(formDefinitionService, TENANT, formCode, "回复测试表单");
        Long defId = definitionService.create(TENANT, 1L, new CreateDefinitionRequest(
                code, "回复测试流程", "APPROVAL", null, List.of(formCode), "{}",
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

    private Long publishNotify(Long instanceId, long receiver) {
        return messageService.publish(TENANT, new PublishMessageRequest(
                "NOTIFY", "TASK", "流程通知", "summary", null, null,
                null, "系统", List.of(receiver), null, instanceId, null, null));
    }

    @Test
    @DisplayName("PR-18：回复消息 → 追加 wf_history(operation=COMMENT) 且可在实例详情 history 中看到")
    void replyAppendsCommentHistory() {
        long approver = 700201L;
        long initiator = 700301L;
        long operator = 700401L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime(), initiator);

        Long msgId = publishNotify(instId, initiator);

        String content = "补充意见：请复核发票号码 " + System.nanoTime();
        processService.replyToMessage(TENANT, msgId, operator, "王五", content);

        // 落库层：wf_history 追加一条 COMMENT
        var history = historyRepository.findByInstanceIdOrderByCreatedAtAsc(instId);
        var comment = history.stream()
                .filter(h -> WfHistory.OP_COMMENT.equals(h.getOperation()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("应追加一条 COMMENT 历史"));
        assertEquals(content, comment.getComment(), "comment 应为回复正文");
        assertEquals(operator, comment.getOperatorId(), "operator_id 应为回复人");
        assertEquals("王五", comment.getOperatorName(), "operator_name 应为回复人姓名");
        assertEquals(instId, comment.getInstanceId());
        assertTrue(comment.getNodeCode() != null && !comment.getNodeCode().isBlank(),
                "node_code 非空（NOT NULL 约束）");

        // 接口层：出现在 GET /workflow/instances/{id} 的 history
        var detail = processService.detail(instId, TENANT);
        assertTrue(detail.history().stream().anyMatch(h -> WfHistory.OP_COMMENT.equals(h.operation())
                        && content.equals(h.comment())),
                "实例详情的审批历史应包含该回复");
    }

    @Test
    @DisplayName("PR-18：回复不改变流程状态、不推进节点")
    void replyDoesNotChangeInstanceStatus() {
        long approver = 700202L;
        long initiator = 700302L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime(), initiator);

        String statusBefore = processService.detail(instId, TENANT).instance().status();
        String nodeBefore = processService.detail(instId, TENANT).instance().currentNodeCode();

        processService.replyToMessage(TENANT, publishNotify(instId, initiator), 700402L, "评论人", "仅评论");

        var after = processService.detail(instId, TENANT);
        assertEquals(statusBefore, after.instance().status(), "回复不得改变流程状态");
        assertEquals(nodeBefore, after.instance().currentNodeCode(), "回复不得推进节点");
    }

    @Test
    @DisplayName("PR-18：无关联流程的消息回复被拒（VALIDATION_ERROR）")
    void replyWithoutInstanceRejected() {
        long initiator = 700303L;
        Long msgId = messageService.publish(TENANT, new PublishMessageRequest(
                "NOTIFY", "TASK", "无关联流程通知", "summary", null, null,
                null, "系统", List.of(initiator), null, null, null, null));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> processService.replyToMessage(TENANT, msgId, 700403L, "王五", "内容"));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode(),
                "无实例应报 VALIDATION_ERROR");
    }

    @Test
    @DisplayName("PR-18：回复不存在的消息报 NOT_FOUND")
    void replyUnknownMessageNotFound() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> processService.replyToMessage(TENANT, 999_999_999_999L, 700404L, "王五", "内容"));
        assertEquals(ResultCode.NOT_FOUND.getCode(), ex.getCode(), "消息不存在应为 NOT_FOUND");
    }

    @Test
    @DisplayName("PR-18：关联实例不存在时回复报 NOT_FOUND")
    void replyMissingInstanceNotFound() {
        long initiator = 700304L;
        Long msgId = publishNotify(999_999_999_998L, initiator);
        BusinessException ex = assertThrows(BusinessException.class,
                () -> processService.replyToMessage(TENANT, msgId, 700405L, "王五", "内容"));
        assertEquals(ResultCode.NOT_FOUND.getCode(), ex.getCode(), "实例不存在应为 NOT_FOUND");
    }

    @Test
    @DisplayName("PR-18：空回复内容被拒（VALIDATION_ERROR）")
    void replyBlankContentRejected() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> processService.replyToMessage(TENANT, 1L, 700406L, "王五", "   "));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode(), "空内容应被拒");
    }

    @Test
    @DisplayName("前置：审批通过触发 notify，其消息 instanceId 非空（供回复定位）")
    void approvePublishesLinkedNotify() {
        long approver = 700205L;
        long initiator = 700305L;
        String formCode = "FORM_" + System.nanoTime();
        String code = createSingleApprovalFlow(formCode, approver);
        Long instId = start(code, formCode, "PO-" + System.nanoTime(), initiator);

        Long wfTaskId = wfTaskRepository.findPendingByInstance(instId).get(0).getId();
        processService.completeTask(TENANT, wfTaskId, new CompleteWfTaskRequest("APPROVE", "同意"), approver);

        var inbox = messageService.inbox(TENANT, initiator, "NOTIFY", 1, 50);
        var msg = inbox.getList().stream()
                .filter(v -> String.valueOf(instId).equals(v.instanceId()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("应存在一条 instanceId 指向该实例的通知"));
        assertTrue(msg.canReply(), "关联流程的通知应可回复");
    }
}
