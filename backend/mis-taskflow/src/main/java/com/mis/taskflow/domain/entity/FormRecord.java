package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 表单单据 {@code form_record}：生命周期与挂流程；业务字段在专用宽表。
 */
@Entity
@Table(name = "form_record")
public class FormRecord {

    public static final String STATUS_SAVED = "SAVED";
    public static final String STATUS_IN_PROCESS = "IN_PROCESS";
    public static final String STATUS_IN_AUDIT = "IN_AUDIT";
    public static final String STATUS_APPROVED = "APPROVED";
    public static final String STATUS_REJECTED = "REJECTED";

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "form_code", nullable = false, length = 64)
    private String formCode;

    @Column(nullable = false, length = 16)
    private String status = STATUS_SAVED;

    @Column(name = "storage_table", nullable = false, length = 128)
    private String storageTable;

    @Column(name = "data_id", nullable = false)
    private Long dataId;

    @Column(name = "current_instance_id")
    private Long currentInstanceId;

    @Column(name = "last_instance_id")
    private Long lastInstanceId;

    @Column(length = 256)
    private String title;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload_snapshot", columnDefinition = "jsonb")
    private String payloadSnapshot;

    @Column(name = "created_by", nullable = false)
    private Long createdBy;

    @Column(name = "created_by_name", length = 64)
    private String createdByName;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @Column(nullable = false)
    private Integer deleted = 0;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public String getFormCode() { return formCode; }
    public void setFormCode(String formCode) { this.formCode = formCode; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getStorageTable() { return storageTable; }
    public void setStorageTable(String storageTable) { this.storageTable = storageTable; }
    public Long getDataId() { return dataId; }
    public void setDataId(Long dataId) { this.dataId = dataId; }
    public Long getCurrentInstanceId() { return currentInstanceId; }
    public void setCurrentInstanceId(Long currentInstanceId) { this.currentInstanceId = currentInstanceId; }
    public Long getLastInstanceId() { return lastInstanceId; }
    public void setLastInstanceId(Long lastInstanceId) { this.lastInstanceId = lastInstanceId; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getPayloadSnapshot() { return payloadSnapshot; }
    public void setPayloadSnapshot(String payloadSnapshot) { this.payloadSnapshot = payloadSnapshot; }
    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }
    public String getCreatedByName() { return createdByName; }
    public void setCreatedByName(String createdByName) { this.createdByName = createdByName; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public Integer getDeleted() { return deleted; }
    public void setDeleted(Integer deleted) { this.deleted = deleted; }
}
