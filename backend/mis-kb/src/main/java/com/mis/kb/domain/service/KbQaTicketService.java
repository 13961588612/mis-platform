package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.kb.api.dto.KbQaTicketVO;
import com.mis.kb.api.dto.KbTicketTimelineEntry;
import com.mis.kb.api.dto.TicketCreateRequest;
import com.mis.kb.api.dto.TicketPatchRequest;
import com.mis.kb.domain.entity.KbQaTicket;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.TicketRelAction;
import com.mis.kb.domain.model.TicketStatus;
import com.mis.kb.domain.model.TicketType;
import com.mis.kb.domain.repository.KbQaSessionRepository;
import com.mis.kb.domain.repository.KbQaTicketRepository;
import com.mis.kb.support.IdGenerator;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * 问答工单服务（F-10 建单 → A-02c 运营处理闭环）。
 *
 * <p><b>为什么自建而不接平台工单中心：</b>全仓 grep 无任何 ticket/工单模块，
 * 平台当前不存在统一工单能力。为 P1 单独立一个工单中心属于超范围建设，
 * 因此按决策 A-02c 在知识库内自建轻量工单——复用 P0 已建的 {@code kb_qa_ticket} 占位表，
 * V15 迁移补齐字段即可，不新建表、不引新依赖。
 *
 * <p><b>状态机：</b>见 {@link TicketStatus}。非法流转抛
 * {@link KbResultCode#KB_TICKET_STATUS_ILLEGAL}，而不是静默忽略——
 * 运营侧误操作必须显性反馈，否则会出现「点了关闭但没关掉」的幽灵工单。
 */
@Service
public class KbQaTicketService {

    private static final Logger log = LoggerFactory.getLogger(KbQaTicketService.class);

    private final KbQaTicketRepository ticketRepository;
    private final KbQaSessionRepository sessionRepository;

    public KbQaTicketService(
            KbQaTicketRepository ticketRepository,
            KbQaSessionRepository sessionRepository) {
        this.ticketRepository = ticketRepository;
        this.sessionRepository = sessionRepository;
    }

    // ---------------------------------------------------------------- 写

    /**
     * 建工单（F-10 问答一键报错）。
     *
     * <p>会校验 {@code sessionId} 真实存在——否则运营点开工单看不到上下文，等于废单。
     * 不校验会话归属：用户可能对「别人分享给他的会话」报错，且工单本身不泄露会话内容。
     *
     * @param req       建单请求
     * @param creatorId 提单人 userId；可为 {@code null}（无身份的内部调用）
     * @return 新建工单视图
     */
    @Transactional
    public KbQaTicketVO create(TicketCreateRequest req, Long creatorId) {
        TicketType type = TicketType.fromCode(req.type());
        if (type == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "工单类型非法（应为 answer_error/cite_error/missing_doc/permission/other）");
        }
        if (!sessionRepository.existsById(req.sessionId())) {
            throw new KbBusinessException(KbResultCode.KB_SESSION_NOT_FOUND);
        }
        Instant now = Instant.now();
        KbQaTicket entity = new KbQaTicket();
        entity.setId(IdGenerator.nextId());
        entity.setSessionId(req.sessionId());
        entity.setMessageId(req.messageId());
        entity.setType(type.code());
        entity.setStatus(TicketStatus.OPEN.code());
        entity.setContent(req.content());
        entity.setCreatorId(creatorId);
        entity.setRelAction(TicketRelAction.NONE.code());
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        entity.setTimeLine(writeTimeline(List.of(new KbTicketTimelineEntry(
                now.toString(), null, TicketStatus.OPEN.code(), creatorId, "提交工单"))));
        KbQaTicket saved = ticketRepository.save(entity);
        log.info("问答工单已创建 ticketId={} sessionId={} type={} creator={}",
                saved.getId(), saved.getSessionId(), saved.getType(), creatorId);
        return toVo(saved);
    }

    /**
     * 处理/关闭工单（A-02c）。
     *
     * <p>PATCH 语义：只更新显式传入的字段。{@code status} 非空时走状态机校验并追加时间线。
     *
     * @param ticketId    工单 id
     * @param req         处理请求
     * @param actingUserId 当前操作人；{@code req.processorId()} 为空时用它填充
     * @return 更新后的工单视图
     */
    @Transactional
    public KbQaTicketVO patch(Long ticketId, TicketPatchRequest req, Long actingUserId) {
        KbQaTicket entity = ticketRepository.findById(ticketId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_TICKET_NOT_FOUND));

        Long processor = req.processorId() != null ? req.processorId() : actingUserId;
        Instant now = Instant.now();

        if (req.relAction() != null && !req.relAction().isBlank()) {
            TicketRelAction relAction = TicketRelAction.fromCode(req.relAction());
            if (relAction == null) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR,
                        "关联动作非法（应为 none/add_doc/fix_doc/adjust_acl/adjust_rag）");
            }
            entity.setRelAction(relAction.code());
        }
        if (req.note() != null) {
            entity.setNote(req.note());
        }
        if (processor != null) {
            entity.setProcessorId(processor);
        }

        if (req.status() != null && !req.status().isBlank()) {
            TicketStatus target = TicketStatus.fromCode(req.status());
            if (target == null) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR,
                        "工单状态非法（应为 open/processing/resolved/closed）");
            }
            TicketStatus current = TicketStatus.fromCode(entity.getStatus());
            if (current == null) {
                // 历史脏数据兜底：状态为空/未知时视作 OPEN，避免整条工单卡死无法处理
                log.warn("工单状态未知，按 OPEN 处理 ticketId={} rawStatus={}", ticketId, entity.getStatus());
                current = TicketStatus.OPEN;
            }
            if (!TicketStatus.canTransit(current, target)) {
                throw new KbBusinessException(KbResultCode.KB_TICKET_STATUS_ILLEGAL);
            }
            if (current != target) {
                entity.setStatus(target.code());
                // 首次进入 processing 时锁定受理人
                if (target == TicketStatus.PROCESSING && entity.getHandlerId() == null) {
                    entity.setHandlerId(processor);
                }
                List<KbTicketTimelineEntry> timeline = new ArrayList<>(readTimeline(entity.getTimeLine()));
                timeline.add(new KbTicketTimelineEntry(
                        now.toString(), current.code(), target.code(), processor, req.note()));
                entity.setTimeLine(writeTimeline(timeline));
            }
        }

        entity.setUpdatedAt(now);
        KbQaTicket saved = ticketRepository.save(entity);
        log.info("问答工单已更新 ticketId={} status={} processor={}",
                saved.getId(), saved.getStatus(), saved.getProcessorId());
        return toVo(saved);
    }

    /**
     * 关闭工单（{@link #patch} 的语义化快捷方式）。
     *
     * @param ticketId     工单 id
     * @param note         关闭备注
     * @param processorId  处理人
     * @param relAction    关联动作码值
     * @return 更新后的工单视图
     */
    @Transactional
    public KbQaTicketVO close(Long ticketId, String note, Long processorId, String relAction) {
        return patch(ticketId,
                new TicketPatchRequest(TicketStatus.CLOSED.code(), note, relAction, processorId),
                processorId);
    }

    // ---------------------------------------------------------------- 读

    /**
     * 工单分页列表（A-02c）。
     *
     * @param status 状态码值筛选；{@code null}/空表示不限
     * @param page   页码，从 1 开始
     * @param size   每页条数
     * @return 分页结果
     */
    @Transactional(readOnly = true)
    public PageResult<KbQaTicketVO> list(String status, Integer page, Integer size) {
        int p = page == null || page < 1 ? 1 : page;
        int s = size == null || size < 1 ? 20 : Math.min(size, 200);
        String normalized = null;
        if (status != null && !status.isBlank()) {
            TicketStatus parsed = TicketStatus.fromCode(status);
            if (parsed == null) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "工单状态筛选值非法");
            }
            normalized = parsed.code();
        }
        Page<KbQaTicket> result = ticketRepository.pageByStatus(normalized, PageRequest.of(p - 1, s));
        return PageResult.of(p, s, result.getTotalElements(),
                result.getContent().stream().map(KbQaTicketService::toVo).toList());
    }

    /** 工单详情。 */
    @Transactional(readOnly = true)
    public KbQaTicketVO get(Long ticketId) {
        return toVo(ticketRepository.findById(ticketId)
                .orElseThrow(() -> new KbBusinessException(KbResultCode.KB_TICKET_NOT_FOUND)));
    }

    /** 某会话下的工单列表（问答详情页展示）。 */
    @Transactional(readOnly = true)
    public List<KbQaTicketVO> listBySession(Long sessionId) {
        if (sessionId == null) {
            return List.of();
        }
        return ticketRepository.findBySessionIdOrderByIdDesc(sessionId).stream()
                .map(KbQaTicketService::toVo)
                .toList();
    }

    /** 未关闭工单数（看板用）。 */
    @Transactional(readOnly = true)
    public long countOpen() {
        return ticketRepository.countByStatusNot(TicketStatus.CLOSED.code());
    }

    /** 工单总数（看板用）。 */
    @Transactional(readOnly = true)
    public long countAll() {
        return ticketRepository.count();
    }

    // ---------------------------------------------------------------- 内部

    private static List<KbTicketTimelineEntry> readTimeline(String json) {
        return KbJson.readTimeline(json);
    }

    private static String writeTimeline(List<KbTicketTimelineEntry> timeline) {
        return KbJson.writeTimeline(timeline);
    }

    private static KbQaTicketVO toVo(KbQaTicket e) {
        TicketType type = TicketType.fromCode(e.getType());
        return new KbQaTicketVO(
                e.getId(),
                e.getSessionId(),
                e.getMessageId(),
                e.getType(),
                type != null ? type.label() : e.getType(),
                e.getStatus(),
                e.getContent(),
                e.getNote(),
                e.getRelAction(),
                e.getCreatorId(),
                e.getHandlerId(),
                e.getProcessorId(),
                readTimeline(e.getTimeLine()),
                e.getCreatedAt(),
                e.getUpdatedAt());
    }
}
