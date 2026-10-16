package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.client.model.MessageFileVO;
import com.mis.adminbff.client.model.SentMessageDetailVO;
import com.mis.adminbff.client.model.SentMessageVO;
import com.mis.adminbff.dto.MessageSendRequest;
import com.mis.adminbff.service.MessageManageService;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * 消息中心 · 消息管理（发消息、发送记录、附件）。
 */
@RestController
@RequestMapping("/api/v1/messages")
public class MessageManageController {

    private final MessageManageService messageManageService;
    private final TaskflowWebClient taskflowWebClient;

    public MessageManageController(MessageManageService messageManageService, TaskflowWebClient taskflowWebClient) {
        this.messageManageService = messageManageService;
        this.taskflowWebClient = taskflowWebClient;
    }

    @PostMapping("/manage/preview")
    public Result<Map<String, Integer>> preview(@RequestBody MessageSendRequest request) {
        int count = messageManageService.preview(RequestContext.requireLoginUser(), request);
        return Result.ok(Map.of("count", count));
    }

    @PostMapping("/manage/send")
    public Result<Long> send(@RequestBody MessageSendRequest request) {
        return Result.ok(messageManageService.send(RequestContext.requireLoginUser(), request));
    }

    @GetMapping("/manage/sent")
    public Result<PageResult<SentMessageVO>> sent(@RequestParam(defaultValue = "1") int page,
                                                  @RequestParam(defaultValue = "20") int size) {
        return Result.ok(messageManageService.sent(RequestContext.requireLoginUser(), page, size));
    }

    @GetMapping("/manage/sent/{id}")
    public Result<SentMessageDetailVO> sentDetail(@PathVariable Long id) {
        return Result.ok(messageManageService.sentDetail(RequestContext.requireLoginUser(), id));
    }

    @PostMapping("/manage/files")
    public Result<MessageFileVO> upload(@RequestParam(defaultValue = "file") String kind,
                                        @RequestParam("file") MultipartFile file) throws Exception {
        LoginUser user = RequestContext.requireLoginUser();
        return Result.ok(taskflowWebClient.uploadMessageFile(
                user.getTenantId(), user.getUserId(), kind,
                file.getOriginalFilename(), file.getContentType(), file.getBytes()));
    }

    @GetMapping("/files/{id}")
    public ResponseEntity<byte[]> download(@PathVariable Long id) {
        LoginUser user = RequestContext.requireLoginUser();
        return taskflowWebClient.downloadMessageFile(user.getTenantId(), user.getUserId(), id);
    }
}
