package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 问数知识/术语/口径（iqd_knowledge）。
 *
 * <p>{@code source=kb_s07} 表示从 S-07 平台术语表单向拉入（A6 未就绪时字段保留不启用）；
 * {@code related_item_keys} JSONB 关联清单 {@code item_key} 集合。
 */
@Entity
@Table(name = "iqd_knowledge")
public class IqdKnowledge {

    @Id
    private Long id;

    @Column(name = "connection_id", nullable = false)
    private Long connectionId;

    @Column(nullable = false)
    private String kind;

    @Column(nullable = false)
    private String title;

    @Column(columnDefinition = "text")
    private String content;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "related_item_keys", columnDefinition = "jsonb")
    private String relatedItemKeys;

    @Column(nullable = false)
    private String source = "local";

    @Column(name = "kb_term_id")
    private String kbTermId;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(nullable = false)
    private Integer enabled = 1;

    @Column(name = "wren_ref_id")
    private String wrenRefId;

    @Column(name = "sync_status", nullable = false)
    private String syncStatus = "pending";

    @Column(name = "synced_at")
    private Instant syncedAt;

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

    public Long getConnectionId() {
        return connectionId;
    }

    public void setConnectionId(Long connectionId) {
        this.connectionId = connectionId;
    }

    public String getKind() {
        return kind;
    }

    public void setKind(String kind) {
        this.kind = kind;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getRelatedItemKeys() {
        return relatedItemKeys;
    }

    public void setRelatedItemKeys(String relatedItemKeys) {
        this.relatedItemKeys = relatedItemKeys;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public String getKbTermId() {
        return kbTermId;
    }

    public void setKbTermId(String kbTermId) {
        this.kbTermId = kbTermId;
    }

    public Integer getEnabled() {
        return enabled;
    }

    public void setEnabled(Integer enabled) {
        this.enabled = enabled;
    }

    public String getWrenRefId() {
        return wrenRefId;
    }

    public void setWrenRefId(String wrenRefId) {
        this.wrenRefId = wrenRefId;
    }

    public String getSyncStatus() {
        return syncStatus;
    }

    public void setSyncStatus(String syncStatus) {
        this.syncStatus = syncStatus;
    }

    public Instant getSyncedAt() {
        return syncedAt;
    }

    public void setSyncedAt(Instant syncedAt) {
        this.syncedAt = syncedAt;
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
