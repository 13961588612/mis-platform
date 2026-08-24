package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

/**
 * 问数知识/术语/口径响应 VO（GET /api/v1/iqd/knowledge；snake_case wire）。
 *
 * <p>{@code related_item_keys} 为 JSON 字符串数组；{@code source=kb_s07} 表示从
 * S-07 平台术语表单向拉入（A6 未就绪时保留不启用）。
 */
public class IqdKnowledgeVO {

    private Long id;
    private Long connectionId;
    private String kind;
    private String title;
    private String content;
    private String relatedItemKeys;
    private String source;
    private String kbTermId;
    private Boolean enabled;
    private String wrenRefId;
    private String syncStatus;
    private Instant syncedAt;
    private Instant createdAt;
    private Instant updatedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    @JsonProperty("connection_id")
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

    @JsonProperty("related_item_keys")
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

    @JsonProperty("kb_term_id")
    public String getKbTermId() {
        return kbTermId;
    }

    public void setKbTermId(String kbTermId) {
        this.kbTermId = kbTermId;
    }

    public Boolean getEnabled() {
        return enabled;
    }

    public void setEnabled(Boolean enabled) {
        this.enabled = enabled;
    }

    @JsonProperty("wren_ref_id")
    public String getWrenRefId() {
        return wrenRefId;
    }

    public void setWrenRefId(String wrenRefId) {
        this.wrenRefId = wrenRefId;
    }

    @JsonProperty("sync_status")
    public String getSyncStatus() {
        return syncStatus;
    }

    public void setSyncStatus(String syncStatus) {
        this.syncStatus = syncStatus;
    }

    @JsonProperty("synced_at")
    public Instant getSyncedAt() {
        return syncedAt;
    }

    public void setSyncedAt(Instant syncedAt) {
        this.syncedAt = syncedAt;
    }

    @JsonProperty("created_at")
    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    @JsonProperty("updated_at")
    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
