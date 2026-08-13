package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 问答会话（kb_qa_session）。落库责任方：mis-rag 经内部 API 写入。
 */
@Entity
@Table(name = "kb_qa_session")
public class KbQaSession {

    @Id
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "app_id")
    private Long appId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** 会话标题：新建时取首问前 30 字符（mis-rag 侧截断）；null 时前端兜底展示「会话 #id」。 */
    @Column(name = "title")
    private String title;

    /** 软删除时间戳；非 null 表示已删除（用户侧不可见，运营侧保留全量）。 */
    @Column(name = "deleted_at")
    private Instant deletedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Long getAppId() {
        return appId;
    }

    public void setAppId(Long appId) {
        this.appId = appId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public Instant getDeletedAt() {
        return deletedAt;
    }

    public void setDeletedAt(Instant deletedAt) {
        this.deletedAt = deletedAt;
    }
}
