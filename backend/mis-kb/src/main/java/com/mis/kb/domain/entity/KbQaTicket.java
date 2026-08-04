package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 问答工单（kb_qa_ticket）——A-02c 自建轻量工单。
 *
 * <p>P0 为占位空表；V15 迁移补齐 {@code note}/{@code time_line}/{@code rel_action}/
 * {@code processor_id}/{@code message_id}/{@code creator_id}/{@code updated_at}，
 * 使其可承载「问答报错 → 运营处理 → 关闭」的完整闭环。
 *
 * <p>字段与列名对应关系（务必与 {@code V15__kb_incremental.sql} 保持一致）：
 * <pre>
 *   id          -> id            sessionId   -> session_id    messageId  -> message_id
 *   type        -> type          status      -> status        content    -> content
 *   handlerId   -> handler_id    processorId -> processor_id  creatorId  -> creator_id
 *   note        -> note          timeLine    -> time_line     relAction  -> rel_action
 *   createdAt   -> created_at    updatedAt   -> updated_at
 * </pre>
 */
@Entity
@Table(name = "kb_qa_ticket")
public class KbQaTicket {

    @Id
    private Long id;

    @Column(name = "session_id")
    private Long sessionId;

    /** 触发工单的问答消息 id（F-10 一键报错时回填），可为空。 */
    @Column(name = "message_id")
    private Long messageId;

    /** 工单类型，见 {@link com.mis.kb.domain.model.TicketType}。 */
    @Column(name = "type", length = 16)
    private String type;

    /** 工单状态，见 {@link com.mis.kb.domain.model.TicketStatus}。 */
    @Column(name = "status", length = 16)
    private String status;

    @Column(name = "content")
    private String content;

    /** 受理人 userId（首次进入 processing 时落）。 */
    @Column(name = "handler_id")
    private Long handlerId;

    /** 当前处理人 userId（可随流转变更）。 */
    @Column(name = "processor_id")
    private Long processorId;

    /** 提单人 userId。 */
    @Column(name = "creator_id")
    private Long creatorId;

    /** 处理备注。 */
    @Column(name = "note")
    private String note;

    /** 状态流转时间线（JSON 数组文本）。 */
    @Column(name = "time_line")
    private String timeLine;

    /** 关联动作，见 {@link com.mis.kb.domain.model.TicketRelAction}。 */
    @Column(name = "rel_action", length = 32)
    private String relAction;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getSessionId() {
        return sessionId;
    }

    public void setSessionId(Long sessionId) {
        this.sessionId = sessionId;
    }

    public Long getMessageId() {
        return messageId;
    }

    public void setMessageId(Long messageId) {
        this.messageId = messageId;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public Long getHandlerId() {
        return handlerId;
    }

    public void setHandlerId(Long handlerId) {
        this.handlerId = handlerId;
    }

    public Long getProcessorId() {
        return processorId;
    }

    public void setProcessorId(Long processorId) {
        this.processorId = processorId;
    }

    public Long getCreatorId() {
        return creatorId;
    }

    public void setCreatorId(Long creatorId) {
        this.creatorId = creatorId;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public String getTimeLine() {
        return timeLine;
    }

    public void setTimeLine(String timeLine) {
        this.timeLine = timeLine;
    }

    public String getRelAction() {
        return relAction;
    }

    public void setRelAction(String relAction) {
        this.relAction = relAction;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
