package com.mis.taskflow.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.SysMessage;
import com.mis.taskflow.domain.entity.SysMessageFile;
import com.mis.taskflow.domain.entity.SysMessageReceiver;
import com.mis.taskflow.domain.repository.SysMessageReceiverRepository;
import com.mis.taskflow.domain.repository.SysMessageRepository;
import com.mis.taskflow.dto.AdminSendRequest;
import com.mis.taskflow.dto.PublishMessageRequest;
import com.mis.taskflow.dto.SentMessageDetailVO;
import com.mis.taskflow.dto.SentMessageVO;
import com.mis.taskflow.support.HtmlMessageSanitizer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 后台发消息与发送记录。接收人由 BFF 按并集解析后传入。
 */
@Service
public class MessageAdminService {

    private static final int DETAIL_RECEIVER_LIMIT = 200;

    private final MessageService messageService;
    private final MessageFileService fileService;
    private final SysMessageRepository messageRepository;
    private final SysMessageReceiverRepository receiverRepository;
    private final ObjectMapper objectMapper;

    public MessageAdminService(MessageService messageService,
                               MessageFileService fileService,
                               SysMessageRepository messageRepository,
                               SysMessageReceiverRepository receiverRepository,
                               ObjectMapper objectMapper) {
        this.messageService = messageService;
        this.fileService = fileService;
        this.messageRepository = messageRepository;
        this.receiverRepository = receiverRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public Long send(Long tenantId, AdminSendRequest req) {
        if (tenantId == null || req.senderId() == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "租户或发送人不能为空");
        }
        List<Long> receivers = req.receiverIds().stream().distinct().toList();
        if (receivers.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "没有可接收的启用用户");
        }
        String body = HtmlMessageSanitizer.cleanBody(req.contentHtml());
        String summary = StringUtils.hasText(req.summary())
                ? req.summary().trim()
                : HtmlMessageSanitizer.toPlainSummary(body);
        if (summary.isBlank()) {
            summary = null;
        }
        List<Long> attachmentIds = req.attachmentFileIds() == null
                ? List.of()
                : req.attachmentFileIds().stream().distinct().toList();
        if (attachmentIds.size() > MessageFileService.MAX_ATTACHMENTS) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "一条消息最多 10 个附件");
        }
        List<Long> imageIds = HtmlMessageSanitizer.fileIds(body);
        String attachments = attachmentJson(fileService.requireOwned(tenantId, req.senderId(), attachmentIds));
        String content = body.isBlank() ? null : envelope(body);

        Long messageId = messageService.publish(tenantId, new PublishMessageRequest(
                "NOTIFY",
                "ANNOUNCEMENT",
                req.title().trim(),
                summary,
                content,
                attachments,
                req.senderId(),
                req.senderName(),
                receivers,
                null,
                null,
                null,
                null,
                req.audience()));

        Set<Long> bindIds = new LinkedHashSet<>();
        bindIds.addAll(attachmentIds);
        bindIds.addAll(imageIds);
        fileService.bind(tenantId, req.senderId(), messageId, List.copyOf(bindIds));
        return messageId;
    }

    @Transactional(readOnly = true)
    public PageResult<SentMessageVO> sent(Long tenantId, String keyword, int page, int size) {
        int pageSize = Math.min(Math.max(size, 1), 100);
        var pageable = PageRequest.of(Math.max(page - 1, 0), pageSize);
        String q = keyword == null ? "" : keyword.trim();
        Page<SysMessage> result = q.isEmpty()
                ? messageRepository.findSent(tenantId, pageable)
                : messageRepository.findSentByKeyword(tenantId, q, pageable);
        List<SentMessageVO> list = result.getContent().stream()
                .map(m -> new SentMessageVO(
                        String.valueOf(m.getId()),
                        m.getTitle(),
                        m.getSummary(),
                        m.getSenderName(),
                        m.getAudience(),
                        m.getReadCount() == null ? 0 : m.getReadCount(),
                        m.getTotalCount() == null ? 0 : m.getTotalCount(),
                        m.getCreatedAt()))
                .toList();
        return PageResult.of(page, pageSize, result.getTotalElements(), list);
    }

    @Transactional(readOnly = true)
    public SentMessageDetailVO sentDetail(Long tenantId, Long messageId) {
        SysMessage msg = messageRepository.findById(messageId)
                .filter(m -> tenantId.equals(m.getTenantId()) && m.getDeleted() == 0 && m.getAudience() != null)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "发送记录不存在"));
        List<SysMessageReceiver> all = receiverRepository.findByMessageId(messageId);
        boolean truncated = all.size() > DETAIL_RECEIVER_LIMIT;
        List<SentMessageDetailVO.ReceiverReadVO> receivers = all.stream()
                .limit(DETAIL_RECEIVER_LIMIT)
                .map(r -> new SentMessageDetailVO.ReceiverReadVO(String.valueOf(r.getUserId()), Boolean.TRUE.equals(r.getRead())))
                .toList();
        return new SentMessageDetailVO(
                String.valueOf(msg.getId()),
                msg.getTitle(),
                msg.getSummary(),
                msg.getContent(),
                msg.getAttachments(),
                msg.getAudience(),
                msg.getSenderName(),
                msg.getReadCount() == null ? 0 : msg.getReadCount(),
                msg.getTotalCount() == null ? 0 : msg.getTotalCount(),
                truncated,
                receivers,
                msg.getCreatedAt());
    }

    private String attachmentJson(List<SysMessageFile> files) {
        ArrayNode arr = objectMapper.createArrayNode();
        for (SysMessageFile file : files) {
            ObjectNode node = arr.addObject();
            node.put("fileId", String.valueOf(file.getId()));
            node.put("name", file.getFileName());
            node.put("size", file.getSizeBytes());
            node.put("mime", file.getMime());
        }
        return arr.toString();
    }

    private String envelope(String body) {
        try {
            ObjectNode node = objectMapper.createObjectNode();
            node.put("format", "html");
            node.put("body", body);
            return objectMapper.writeValueAsString(node);
        } catch (Exception ex) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "正文序列化失败");
        }
    }
}
