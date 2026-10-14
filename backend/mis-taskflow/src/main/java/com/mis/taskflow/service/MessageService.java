package com.mis.taskflow.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.taskflow.domain.entity.SysMessage;
import com.mis.taskflow.domain.entity.SysMessageReceiver;
import com.mis.taskflow.domain.entity.WfTask;
import com.mis.taskflow.domain.repository.SysMessageReceiverRepository;
import com.mis.taskflow.domain.repository.SysMessageRepository;
import com.mis.taskflow.domain.repository.WfTaskRepository;
import com.mis.taskflow.dto.MarkReadRequest;
import com.mis.taskflow.dto.MessageDetailVO;
import com.mis.taskflow.dto.MessageStatsVO;
import com.mis.taskflow.dto.MessageVO;
import com.mis.taskflow.dto.PublishMessageRequest;
import com.mis.taskflow.support.AppScope;
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
    private final WfTaskRepository wfTaskRepository;

    public MessageService(SysMessageRepository messageRepository,
                          SysMessageReceiverRepository receiverRepository,
                          WfTaskRepository wfTaskRepository) {
        this.messageRepository = messageRepository;
        this.receiverRepository = receiverRepository;
        this.wfTaskRepository = wfTaskRepository;
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
        msg.setInstanceId(req.instanceId());
        // 应用归属：**仅按显式值直取**（MessageService 拿不到 bizType，不做推导）；
        // 需要推导的内部调用者（M2/M3/M4）负责把已解析值传入。blank → NULL（= 平台级）。
        msg.setAppCode(trimToNull(req.appCode()));
        // 业务类型：显式写入 sys_message.biz_type（软引用 biz_category.code）。blank → NULL。
        msg.setBizType(trimToNull(req.bizType()));
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
     * 收件箱分页（含当前用户已读状态）。等价 {@code inbox(..., appCode=null, scope=null, ...)}。
     */
    @Transactional(readOnly = true)
    public PageResult<MessageVO> inbox(Long tenantId, Long userId, String msgType, int page, int size) {
        return inbox(tenantId, userId, msgType, null, null, page, size);
    }

    /**
     * 收件箱分页（可选应用归属过滤）。
     *
     * <p>按 {@code scope} 分派到不同仓储查询（**不传=零回归**）：
     * <ul>
     *   <li>{@code APP} 且 {@code appCode} 非空 → {@link SysMessageRepository#findInboxByApp}（{@code app_code = :appCode}）</li>
     *   <li>{@code PLATFORM} → {@link SysMessageRepository#findInboxPlatform}（{@code app_code IS NULL}）</li>
     *   <li>其余（{@code ALL}/未传/非法） → {@link SysMessageRepository#findInbox}（不加条件，与旧行为逐字等价）</li>
     * </ul>
     * 刻意拆成 3 条独立查询而**非**单条 {@code (:appCode IS NULL OR ...)}：见仓储方法注释。
     */
    @Transactional(readOnly = true)
    public PageResult<MessageVO> inbox(Long tenantId, Long userId, String msgType,
                                       String appCode, String scope, int page, int size) {
        Pageable pageable = PageRequest.of(Math.max(page - 1, 0), clampSize(size));
        String type = trimToNull(msgType);
        String app = trimToNull(appCode);
        String sc = AppScope.normalizeScope(scope);

        Page<SysMessage> p;
        if (AppScope.SCOPE_APP.equals(sc) && app != null) {
            p = messageRepository.findInboxByApp(tenantId, userId, type, app, pageable);
        } else if (AppScope.SCOPE_PLATFORM.equals(sc)) {
            p = messageRepository.findInboxPlatform(tenantId, userId, type, pageable);
        } else {
            p = messageRepository.findInbox(tenantId, userId, type, pageable);
        }

        List<Long> ids = p.getContent().stream().map(SysMessage::getId).toList();
        Map<Long, SysMessageReceiver> mine = ids.isEmpty()
                ? Map.of()
                : receiverRepository.findByMessageIdInAndUserId(ids, userId).stream()
                        .collect(Collectors.toMap(SysMessageReceiver::getMessageId, Function.identity(), (a, b) -> a));

        Map<Long, Long> taskToInstance = resolveInstanceByReferenceTasks(p.getContent());
        List<MessageVO> list = p.getContent().stream()
                .map(m -> toVo(m, mine.get(m.getId()), effectiveInstanceId(m, taskToInstance)))
                .toList();
        return PageResult.of(page, pageable.getPageSize(), p.getTotalElements(), list);
    }

    /**
     * 关键词检索（标题 + 摘要）。
     *
     * <p><b>类型内独立搜索（PRD D-5 / Q3）</b>：{@code msgType} 非空时**只在该类型内**检索
     * （走 {@link SysMessageRepository#searchInboxByType}），保证「审批/通知/提醒/系统告警」
     * 各子 Tab 的搜索互不串台；{@code msgType} 为空时**跨类型**检索（走旧
     * {@link SysMessageRepository#searchInbox}），保持既有行为不变。
     *
     * @param msgType 消息类型过滤；空白/{@code null} 表示不限定类型（跨类型检索）
     */
    @Transactional(readOnly = true)
    public PageResult<MessageVO> search(Long tenantId, Long userId, String msgType, String keyword, int page, int size) {
        return search(tenantId, userId, msgType, keyword, null, null, page, size);
    }

    /**
     * 关键词检索（标题 + 摘要；可选 msgType 类型内 + 可选应用归属过滤）。
     *
     * <p>两条正交维度的分派：
     * <ul>
     *   <li>{@code msgType}：非空走类型内查询（各子 Tab 互不串台），空走跨类型（旧行为）。</li>
     *   <li>{@code scope}：{@code APP}&amp;appCode 非空 → {@code app_code = :appCode}；
     *       {@code PLATFORM} → {@code app_code IS NULL}；其余 → 不加条件（零回归）。</li>
     * </ul>
     * 组合共 6 条独立仓储查询（刻意不用 {@code (:appCode IS NULL OR ...)} 单条写法）。
     */
    @Transactional(readOnly = true)
    public PageResult<MessageVO> search(Long tenantId, Long userId, String msgType, String keyword,
                                        String appCode, String scope, int page, int size) {
        if (!StringUtils.hasText(keyword)) {
            return PageResult.empty(page, clampSize(size));
        }
        Pageable pageable = PageRequest.of(Math.max(page - 1, 0), clampSize(size));
        String type = trimToNull(msgType);
        String app = trimToNull(appCode);
        String sc = AppScope.normalizeScope(scope);
        String kw = keyword.trim();

        Page<SysMessage> p;
        if (type == null) {
            if (AppScope.SCOPE_APP.equals(sc) && app != null) {
                p = messageRepository.searchInboxByApp(tenantId, userId, kw, app, pageable);
            } else if (AppScope.SCOPE_PLATFORM.equals(sc)) {
                p = messageRepository.searchInboxPlatform(tenantId, userId, kw, pageable);
            } else {
                p = messageRepository.searchInbox(tenantId, userId, kw, pageable);
            }
        } else {
            if (AppScope.SCOPE_APP.equals(sc) && app != null) {
                p = messageRepository.searchInboxByTypeAndApp(tenantId, userId, type, kw, app, pageable);
            } else if (AppScope.SCOPE_PLATFORM.equals(sc)) {
                p = messageRepository.searchInboxByTypePlatform(tenantId, userId, type, kw, pageable);
            } else {
                p = messageRepository.searchInboxByType(tenantId, userId, type, kw, pageable);
            }
        }

        List<Long> ids = p.getContent().stream().map(SysMessage::getId).toList();
        Map<Long, SysMessageReceiver> mine = ids.isEmpty()
                ? Map.of()
                : receiverRepository.findByMessageIdInAndUserId(ids, userId).stream()
                        .collect(Collectors.toMap(SysMessageReceiver::getMessageId, Function.identity(), (a, b) -> a));

        Map<Long, Long> taskToInstance = resolveInstanceByReferenceTasks(p.getContent());
        List<MessageVO> list = p.getContent().stream()
                .map(m -> toVo(m, mine.get(m.getId()), effectiveInstanceId(m, taskToInstance)))
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
        Long instanceId = resolveInstanceId(msg);
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
                msg.getCreatedAt(),
                nullableId(instanceId),
                canReply(instanceId));
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

    /**
     * 读取指定消息所关联的流程实例 ID（供 {@code ProcessService.replyToMessage} 复用）。
     *
     * @return 关联的 {@code wf_instance.id}；无关联时返回 {@code null}
     * @throws BusinessException NOT_FOUND 消息不存在或已删除
     */
    @Transactional(readOnly = true)
    public Long instanceIdOf(Long messageId) {
        return resolveInstanceId(requireMessage(messageId));
    }

    private SysMessage requireMessage(Long messageId) {
        return messageRepository.findById(messageId)
                .filter(m -> m.getDeleted() == null || m.getDeleted() == 0)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "消息不存在"));
    }

    private MessageVO toVo(SysMessage m, SysMessageReceiver mine, Long instanceId) {
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
                m.getCreatedAt(),
                nullableId(instanceId),
                canReply(instanceId),
                m.getAppCode(),
                m.getBizType());
    }

    /**
     * 独立「回复」入口已关闭：流程意见由当前审批人在审批栏填写（同意/驳回 comment）。
     * {@code canReply} 恒为 false，保留字段以免破坏前端契约。
     */
    private static boolean canReply(Long instanceId) {
        return false;
    }

    /** 消息上的 instance_id；缺省时用 reference_task_id → wf_task 反查（兼容旧数据）。 */
    private Long resolveInstanceId(SysMessage msg) {
        if (msg.getInstanceId() != null) {
            return msg.getInstanceId();
        }
        if (msg.getReferenceTaskId() == null) {
            return null;
        }
        return wfTaskRepository.findFirstBySysTaskId(msg.getReferenceTaskId())
                .map(WfTask::getInstanceId)
                .orElse(null);
    }

    private static Long effectiveInstanceId(SysMessage m, Map<Long, Long> taskToInstance) {
        if (m.getInstanceId() != null) {
            return m.getInstanceId();
        }
        if (m.getReferenceTaskId() == null) {
            return null;
        }
        return taskToInstance.get(m.getReferenceTaskId());
    }

    private Map<Long, Long> resolveInstanceByReferenceTasks(List<SysMessage> messages) {
        List<Long> taskIds = messages.stream()
                .filter(m -> m.getInstanceId() == null && m.getReferenceTaskId() != null)
                .map(SysMessage::getReferenceTaskId)
                .distinct()
                .toList();
        if (taskIds.isEmpty()) {
            return Map.of();
        }
        Map<Long, Long> map = new java.util.HashMap<>();
        for (WfTask wt : wfTaskRepository.findBySysTaskIdIn(taskIds)) {
            if (wt.getSysTaskId() != null && wt.getInstanceId() != null) {
                map.putIfAbsent(wt.getSysTaskId(), wt.getInstanceId());
            }
        }
        return map;
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