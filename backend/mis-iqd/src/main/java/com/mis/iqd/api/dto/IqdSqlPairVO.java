package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

/**
 * 问数样本对响应 VO（GET /api/v1/iqd/sql-pairs；snake_case wire）。
 *
 * <p>{@code wren_ref_id} 为同步进 WrenAI 后回填的外部引用 id；
 * {@code sync_status} 为 pending | synced | failed。
 */
public class IqdSqlPairVO {

    private Long id;
    private Long connectionId;
    private String question;
    private String sqlText;
    private String remark;
    private Boolean enabled;
    private String wrenRefId;
    private String syncStatus;
    private Instant syncedAt;
    private Long createdBy;
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

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
    }

    @JsonProperty("sql_text")
    public String getSqlText() {
        return sqlText;
    }

    public void setSqlText(String sqlText) {
        this.sqlText = sqlText;
    }

    public String getRemark() {
        return remark;
    }

    public void setRemark(String remark) {
        this.remark = remark;
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

    @JsonProperty("created_by")
    public Long getCreatedBy() {
        return createdBy;
    }

    public void setCreatedBy(Long createdBy) {
        this.createdBy = createdBy;
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
