package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 问答反馈（kb_qa_feedback）。由前端 → BFF → mis-kb 落库；{@code editable_once=1} 时仅可修改一次。
 */
@Entity
@Table(name = "kb_qa_feedback")
public class KbQaFeedback {

    @Id
    private Long id;

    @Column(name = "session_id", nullable = false)
    private Long sessionId;

    @Column
    private Integer accuracy;

    @Column
    private Integer helpful;

    @Column
    private Integer offtopic;

    @Column(name = "cite_error")
    private Integer citeError;

    @Column(name = "editable_once", nullable = false)
    private Integer editableOnce = 1;

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

    public Integer getAccuracy() {
        return accuracy;
    }

    public void setAccuracy(Integer accuracy) {
        this.accuracy = accuracy;
    }

    public Integer getHelpful() {
        return helpful;
    }

    public void setHelpful(Integer helpful) {
        this.helpful = helpful;
    }

    public Integer getOfftopic() {
        return offtopic;
    }

    public void setOfftopic(Integer offtopic) {
        this.offtopic = offtopic;
    }

    public Integer getCiteError() {
        return citeError;
    }

    public void setCiteError(Integer citeError) {
        this.citeError = citeError;
    }

    public Integer getEditableOnce() {
        return editableOnce;
    }

    public void setEditableOnce(Integer editableOnce) {
        this.editableOnce = editableOnce;
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
