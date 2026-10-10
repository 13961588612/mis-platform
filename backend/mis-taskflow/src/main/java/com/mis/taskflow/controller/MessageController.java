package com.mis.taskflow.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.MarkReadRequest;
import com.mis.taskflow.dto.MessageDetailVO;
import com.mis.taskflow.dto.MessageStatsVO;
import com.mis.taskflow.dto.MessageVO;
import com.mis.taskflow.dto.PublishMessageRequest;
import com.mis.taskflow.dto.ReplyMessageRequest;
import com.mis.taskflow.service.MessageService;
import com.mis.taskflow.service.ProcessService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 消息中心内部 API（BFF 透传）。
 *
 * <p>租户/用户维度暂以查询参数显式传入；P3 接入认证上下文后改为从 LoginUser 取。
 */
@RestController
@RequestMapping("/internal/v1/messages")
public class MessageController {

    private final MessageService messageService;
    private final ProcessService processService;

    public MessageController(MessageService messageService, ProcessService processService) {
        this.messageService = messageService;
        this.processService = processService;
    }

    /** 发布消息（业务服务调用）。 */
    @PostMapping
    public Result<Long> publish(@RequestParam Long tenantId,
                                @Valid @RequestBody PublishMessageRequest request) {
        return Result.ok(messageService.publish(tenantId, request));
    }

    /** 我的收件箱。 */
    @GetMapping("/inbox")
    public Result<PageResult<MessageVO>> inbox(@RequestParam Long tenantId,
                                               @RequestParam Long userId,
                                               @RequestParam(required = false) String msgType,
                                               @RequestParam(defaultValue = "1") int page,
                                               @RequestParam(defaultValue = "20") int size) {
        return Result.ok(messageService.inbox(tenantId, userId, msgType, page, size));
    }

    /** 关键词检索（可选 msgType 限定类型内的独立搜索，PRD D-5 / Q3）。 */
    @GetMapping("/search")
    public Result<PageResult<MessageVO>> search(@RequestParam Long tenantId,
                                                @RequestParam Long userId,
                                                @RequestParam(required = false) String msgType,
                                                @RequestParam String q,
                                                @RequestParam(defaultValue = "1") int page,
                                                @RequestParam(defaultValue = "20") int size) {
        return Result.ok(messageService.search(tenantId, userId, msgType, q, page, size));
    }

    /** 详情。 */
    @GetMapping("/{id}")
    public Result<MessageDetailVO> detail(@PathVariable Long id, @RequestParam Long userId) {
        return Result.ok(messageService.detail(id, userId));
    }

    /**
     * 回复消息 —— 回写为该消息所关联流程实例的一条审批意见（PR-18）。
     *
     * <p>编排归属 {@code ProcessService}（见其 {@code replyToMessage} 注释），本控制器仅路由。
     */
    @PostMapping("/{id}/reply")
    public Result<Void> reply(@PathVariable Long id,
                              @RequestParam Long tenantId,
                              @RequestParam(required = false) Long operatorId,
                              @RequestParam(required = false) String operatorName,
                              @Valid @RequestBody ReplyMessageRequest request) {
        processService.replyToMessage(tenantId, id, operatorId, operatorName, request.content());
        return Result.ok();
    }

    /** 批量标记已读。 */
    @PostMapping("/read")
    public Result<Integer> markRead(@RequestParam Long userId,
                                    @Valid @RequestBody MarkReadRequest request) {
        return Result.ok(messageService.markRead(request, userId));
    }

    /** 角标统计。 */
    @GetMapping("/stats")
    public Result<MessageStatsVO> stats(@RequestParam Long tenantId, @RequestParam Long userId) {
        return Result.ok(messageService.stats(tenantId, userId));
    }
}