package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.SysMessage;
import com.mis.taskflow.domain.entity.SysMessageReceiver;
import com.mis.taskflow.domain.repository.SysMessageReceiverRepository;
import com.mis.taskflow.domain.repository.SysMessageRepository;
import com.mis.taskflow.dto.MarkReadRequest;
import com.mis.taskflow.dto.MessageDetailVO;
import com.mis.taskflow.dto.MessageStatsVO;
import com.mis.taskflow.dto.MessageVO;
import com.mis.taskflow.dto.PublishMessageRequest;
import com.mis.taskflow.support.IdGenerator;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 消息中心（P2）。
 *
 * <p>双轨存储：
 * <ul>
 *   <li>{@code sys_message.receiver_ids} —— 快速过滤（数组）</li>
 *   <li>{@code sys_message_receiver} —— 每人独立的已读/处理状态（唯一事实源）</li>
 * </ul>
 */
@Service
public class MessageService {

    private final SysMessageRepository messageRepository;
    private final SysMessageReceiverRepository receiverRepository;

    public MessageService(SysMessageRepository messageRepository,
                          SysMessageReceiverRepository receiverRepository) {
        this.messageRepository = messageRepository;
        this.receiverRepository = receiverRepository;
    }

    /**
     * 发布消息：写主表 + 为每个接收者生成明细。
     *
     * @return 消息 ID
     */
    @Transactional
    public Long publish(Long tenantId, PublishMessageRequest req) {
        List<Long> receivers = dedupe(req.receiverIds());
        if (receivers.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "接收者不能为空");
        }
        if (tenantId == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "租户不能为空");
        }

        LocalDateTime now = LocalDateTime.now();
        Long messageId = IdGenerator.nextId();

        SysMessage msg = new SysMessage();
        msg.setId(messageId);
        msg.setTenantId(tenantId);
        msg.setMsgType(req.msgType().trim());
        msg.setCategory(req.category().trim());
        msg.setTitle(req.title().trim());
        msg.setSummary(trimToNull(req.summary()));
        msg.setContent(trimToNull(req.content()));
        msg.setAttachments(StringUtils.hasText(req.attachments()) ? req.attachments() : "[]");
        msg.setSenderId(req.senderId());
        msg.setSenderName(trimToNull(req.senderName()));
        msg.setReceiverIds(receivers.toArray(Long[]::new));
        msg.setReceiverGroupType(receivers.size() > 1 ? "GROUP" : "SINGLE");
        msg.setReferenceTaskId(req.referenceTaskId());
        msg.setReadCount(0);
        msg.setTotalCount(receivers.size());
        msg.setCreatedBy(req.senderId());
        msg.setCreatedAt(now);
        msg.setUpdatedAt(now);
        messageRepository.save(msg);

        List<SysMessageReceiver> details = new ArrayList<>(receivers.size());
        for (Long userId : receivers) {
            SysMessageReceiver r = new SysMessageReceiver();
            r.setId(IdGenerator.nextId());
            r.setTenantId(msg.getTenantId());
            r.setMessageId(messageId);
            r.setUserId(userId);
            r.setRead(Boolean.FALSE);
            r.setStatus(SysMessageReceiver.STATUS_ACTIVE);
            r.setTaskId(req.referenceTaskId());
            r.setCreatedAt(now);
            details.add(r);
        }
        receiverRepository.saveAll(details);

        return messageId;
    }

    /**
     * 收件箱分页（含当前用户已读状态）。
     */
    @Transactional(readOnly = true)
    public PageResult<MessageVO> inbox(Long tenantId, Long userId, String msgType, int page, int size) {
        Pageable pageable = PageRequest.of(Math.max(page - 1, 0), clampSize(size));
        Page<SysMessage> p = messageRepository.findInbox(tenantId, userId, trimToNull(msgType), pageable);

        List<Long> ids = p.getContent().stream().map(SysMessage::getId).toList();
        Map<Long, SysMessageReceiver> mine = ids.isEmpty()
                ? Map.of()
                : receiverRepository.findByMessageIdInAndUserId(ids, userId).stream()
                        .collect(Collectors.toMap(SysMessageReceiver::getMessageId, Function.identity(), (a, b) -> a));

        List<MessageVO> list = p.getContent().stream()
                .map(m -> toVo(m, mine.get(m.getId())))
                .toList();
        return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(), list);
    }

    /**
     * 关键词检索（标题 + 摘要）。
     */
    @Transactional(readOnly = true)
    public PageResult<MessageVO> search(Long tenantId, Long userId, String keyword, int page, int size) {
        if (!StringUtils.hasText(keyword)) {
            return PageResult.empty(page, clampSize(size));
        }
        Pageable pageable = PageRequest.of(Math.max(page - 1, 0), clampSize(size));
        Page<SysMessage> p = messageRepository.searchInbox(tenantId, userId, keyword.trim(), pageable);

        List<Long> ids = p.getContent().stream().map(SysMessage::getId).toList();
        Map<Long, SysMessageReceiver> mine = ids.isEmpty()
                ? Map.of()
                : receiverRepository.findByMessageIdInAndUserId(ids, userId).stream()
                        .collect(Collectors.toMap(SysMessageReceiver::getMessageId, Function.identity(), (a, b) -> a));

        List<MessageVO> list = p.getContent().stream()
                .map(m -> toVo(m, mine.get(m.getId())))
                .toList();
        return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(), list);
    }

    /**
     * 消息详情（校验接收者可见性）。
     */
    @Transactional(readOnly = true)
    public MessageDetailVO detail(Long messageId, Long userId) {
        SysMessage msg = requireMessage(messageId);
        SysMessageReceiver mine = receiverRepository.findByMessageIdAndUserId(messageId, userId)
                .orElseThrow(() -> new BusinessException(ResultCode.FORBIDDEN, "无权查看该消息"));
        List<String> receivers = receiverRepository.findByMessageId(messageId).stream()
                .map(r -> String.valueOf(r.getUserId()))
                .toList();
        return new MessageDetailVO(
                String.valueOf(msg.getId()),
                msg.getMsgType(),
                msg.getCategory(),
                msg.getTitle(),
                msg.getSummary(),
                msg.getContent(),
                msg.getAttachments(),
                nullableId(msg.getSenderId()),
                msg.getSenderName(),
                nullableId(msg.getReferenceTaskId()),
                Boolean.TRUE.equals(mine.getRead()),
                receivers,
                msg.getCreatedAt());
    }

    /**
     * 批量标记已读（幂等：已读的不重复计数）。
     *
     * @return 实际由未读转为已读的条数
     */
    @Transactional
    public int markRead(MarkReadRequest req, Long userId) {
        LocalDateTime now = LocalDateTime.now();
        int changed = 0;
        for (Long messageId : dedupe(req.ids())) {
            Optional<SysMessageReceiver> opt = receiverRepository.findByMessageIdAndUserId(messageId, userId);
            if (opt.isEmpty()) {
                continue;
            }
            SysMessageReceiver r = opt.get();
            if (Boolean.TRUE.equals(r.getRead())) {
                continue;
            }
            r.setRead(Boolean.TRUE);
            r.setViewedAt(now);
            receiverRepository.save(r);
            changed++;

            // 主表已读计数回写（以明细表为唯一事实源重新聚合，避免并发漂移）
            long readCount = receiverRepository.countReadByMessageId(messageId);
            messageRepository.findById(messageId).ifPresent(m -> {
                m.setReadCount((int) readCount);
                m.setUpdatedAt(now);
                messageRepository.save(m);
            });
        }
        return changed;
    }

    /**
     * 角标统计：未读数 + 总数。
     */
    @Transactional(readOnly = true)
    public MessageStatsVO stats(Long tenantId, Long userId) {
        long unread = receiverRepository.countUnread(tenantId, userId);
        long total = receiverRepository.countByTenantIdAndUserId(tenantId, userId);
        return new MessageStatsVO(unread, total);
    }

    private SysMessage requireMessage(Long messageId) {
        return messageRepository.findById(messageId)
                .filter(m -> m.getDeleted() == null || m.getDeleted() == 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "消息不存在"));
    }

    private MessageVO toVo(SysMessage m, SysMessageReceiver mine) {
        return new MessageVO(
                String.valueOf(m.getId()),
                String.valueOf(m.getTenantId()),
                m.getMsgType(),
                m.getCategory(),
                m.getTitle(),
                m.getSummary(),
                nullableId(m.getSenderId()),
                m.getSenderName(),
                nullableId(m.getReferenceTaskId()),
                m.getReceiverGroupType(),
                mine != null && Boolean.TRUE.equals(mine.getRead()),
                m.getReadCount(),
                m.getTotalCount(),
                m.getCreatedAt());
    }

    private static List<Long> dedupe(List<Long> ids) {
        if (ids == null) {
            return List.of();
        }
        return new ArrayList<>(new LinkedHashSet<>(ids.stream().filter(java.util.Objects::nonNull).toList()));
    }

    private static int clampSize(int size) {
        if (size <= 0) {
            return 20;
        }
        return Math.min(size, 200);
    }

    private static String nullableId(Long id) {
        return id == null ? null : String.valueOf(id);
    }

    private static String trimToNull(String v) {
        return StringUtils.hasText(v) ? v.trim() : null;
    }
}