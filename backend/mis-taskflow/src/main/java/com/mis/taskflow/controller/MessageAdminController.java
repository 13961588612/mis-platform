package com.mis.taskflow.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.taskflow.domain.entity.SysMessageFile;
import com.mis.taskflow.dto.AdminSendRequest;
import com.mis.taskflow.dto.MessageFileVO;
import com.mis.taskflow.dto.SentMessageDetailVO;
import com.mis.taskflow.dto.SentMessageVO;
import com.mis.taskflow.service.MessageAdminService;
import com.mis.taskflow.service.MessageFileService;
import jakarta.validation.Valid;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;

/**
 * 后台发消息、发送记录与文件（BFF 透传）。
 */
@RestController
@RequestMapping("/internal/v1/messages")
public class MessageAdminController {

    private final MessageAdminService adminService;
    private final MessageFileService fileService;

    public MessageAdminController(MessageAdminService adminService, MessageFileService fileService) {
        this.adminService = adminService;
        this.fileService = fileService;
    }

    @PostMapping("/manage/send")
    public Result<Long> send(@RequestParam Long tenantId, @Valid @RequestBody AdminSendRequest request) {
        return Result.ok(adminService.send(tenantId, request));
    }

    @GetMapping("/manage/sent")
    public Result<PageResult<SentMessageVO>> sent(@RequestParam Long tenantId,
                                                  @RequestParam(defaultValue = "1") int page,
                                                  @RequestParam(defaultValue = "20") int size) {
        return Result.ok(adminService.sent(tenantId, page, size));
    }

    @GetMapping("/manage/sent/{id}")
    public Result<SentMessageDetailVO> sentDetail(@RequestParam Long tenantId, @PathVariable Long id) {
        return Result.ok(adminService.sentDetail(tenantId, id));
    }

    @PostMapping(value = "/manage/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Result<MessageFileVO> upload(@RequestParam Long tenantId,
                                        @RequestParam Long userId,
                                        @RequestParam(defaultValue = "file") String kind,
                                        @RequestParam("file") MultipartFile file) throws Exception {
        return Result.ok(fileService.upload(tenantId, userId, kind, file.getOriginalFilename(),
                file.getContentType(), file.getBytes()));
    }

    @GetMapping("/files/{id}")
    public ResponseEntity<byte[]> download(@PathVariable Long id,
                                           @RequestParam Long tenantId,
                                           @RequestParam Long userId) {
        SysMessageFile file = fileService.requireReadable(tenantId, id, userId);
        byte[] body = fileService.readBytes(file);
        ContentDisposition disposition = (file.getMime() != null && file.getMime().startsWith("image/")
                ? ContentDisposition.inline()
                : ContentDisposition.attachment())
                .filename(file.getFileName(), StandardCharsets.UTF_8)
                .build();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .contentType(MediaType.parseMediaType(file.getMime()))
                .body(body);
    }
}
