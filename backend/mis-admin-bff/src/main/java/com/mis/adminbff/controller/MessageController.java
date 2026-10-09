package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.support.TaskflowIdentity;
import com.mis.adminbff.client.model.MessageDetailVO;
import com.mis.adminbff.client.model.MessageStatsVO;
import com.mis.adminbff.client.model.MessageVO;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 消息中心对外 API（BFF 透传 mis-taskflow）。
 *
 * <p>租户/用户暂以查询参数传入；P3 接入登录上下文后改从 LoginUser 取。
 */
@RestController
@RequestMapping("/api/v1/messages")
public class MessageController {

    private final TaskflowWebClient taskflowWebClient;

    public MessageController(TaskflowWebClient taskflowWebClient) {
        this.taskflowWebClient = taskflowWebClient;
    }

    @GetMapping("/inbox")
    public Result<PageResult<MessageVO>> inbox(@RequestParam(required = false) Long tenantId,
                                               @RequestParam(required = false) Long userId,
                                               @RequestParam(required = false) String msgType,
                                               @RequestParam(defaultValue = "1") int page,
                                               @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskflowWebClient.inbox(TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.userId(userId), msgType, page, size));
    }

    @GetMapping("/search")
    public Result<PageResult<MessageVO>> search(@RequestParam(required = false) Long tenantId,
                                                @RequestParam(required = false) Long userId,
                                                @RequestParam String q,
                                                @RequestParam(defaultValue = "1") int page,
                                                @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskflowWebClient.searchMessages(TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.userId(userId), q, page, size));
    }

    @GetMapping("/{id}")
    public Result<MessageDetailVO> detail(@PathVariable Long id, @RequestParam(required = false) Long userId) {
        return Result.ok(taskflowWebClient.messageDetail(id, TaskflowIdentity.userId(userId)));
    }

    @PostMapping("/read")
    public Result<Integer> markRead(@RequestParam(required = false) Long userId, @RequestBody Map<String, Object> body) {
        return Result.ok(taskflowWebClient.markMessagesRead(TaskflowIdentity.userId(userId), body));
    }

    @GetMapping("/stats")
    public Result<MessageStatsVO> stats(@RequestParam(required = false) Long tenantId, @RequestParam(required = false) Long userId) {
        return Result.ok(taskflowWebClient.messageStats(TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.userId(userId)));
    }
}