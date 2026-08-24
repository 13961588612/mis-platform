package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 问数 MDL 模型快照（iqd_model_snapshot）。
 *
 * <p>记录 WrenAI 项目 MDL 构建/部署快照（{@code mdl_json} 全量 JSONB + 哈希），
 * 用于 Q4「平台为准」的回填对账与变更基线。
 */
@Entity
@Table(name = "iqd_model_snapshot")
public class IqdModelSnapshot {

    @Id
    private Long id;

    @Column(name = "connection_id", nullable = false)
    private Long connectionId;

    @Column(name = "mdl_hash")
    private String mdlHash;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "mdl_json", columnDefinition = "jsonb")
    private String mdlJson;

    @Column(nullable = false)
    private String source = "pull";

    @Column(name = "model_count")
    private Integer modelCount;

    @Column(name = "synced_at")
    private Instant syncedAt;

    @Column(name = "synced_by")
    private Long syncedBy;

    @Column(nullable = false)
    private String status = "ok";

    @Column(name = "error_message")
    private String errorMessage;

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

    public String getMdlHash() {
        return mdlHash;
    }

    public void setMdlHash(String mdlHash) {
        this.mdlHash = mdlHash;
    }

    public String getMdlJson() {
        return mdlJson;
    }

    public void setMdlJson(String mdlJson) {
        this.mdlJson = mdlJson;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public Integer getModelCount() {
        return modelCount;
    }

    public void setModelCount(Integer modelCount) {
        this.modelCount = modelCount;
    }

    public Instant getSyncedAt() {
        return syncedAt;
    }

    public void setSyncedAt(Instant syncedAt) {
        this.syncedAt = syncedAt;
    }

    public Long getSyncedBy() {
        return syncedBy;
    }

    public void setSyncedBy(Long syncedBy) {
        this.syncedBy = syncedBy;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
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
