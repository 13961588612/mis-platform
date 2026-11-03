package com.mis.aireport.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Entity
@Table(name = "ai_report_def")
public class AiReportDef {

    @Id
    private Long id;

    @Column(name = "report_code", nullable = false, length = 64)
    private String reportCode;

    @Column(nullable = false, length = 256)
    private String title;

    @Column(length = 1024)
    private String description;

    @Column(name = "category_id")
    private Long categoryId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "slots_json", nullable = false, columnDefinition = "jsonb")
    private List<Map<String, Object>> slotsJson;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "use_ai_workflow", nullable = false)
    private Integer useAiWorkflow = 0;

    @Column(name = "workflow_platform_code", length = 64)
    private String workflowPlatformCode;

    @Column(name = "workflow_code", length = 128)
    private String workflowCode;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(nullable = false)
    private Integer enabled = 1;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Column(name = "created_by")
    private Long createdBy;

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

    public String getReportCode() {
        return reportCode;
    }

    public void setReportCode(String reportCode) {
        this.reportCode = reportCode;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Long getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(Long categoryId) {
        this.categoryId = categoryId;
    }

    public List<Map<String, Object>> getSlotsJson() {
        return slotsJson;
    }

    public void setSlotsJson(List<Map<String, Object>> slotsJson) {
        this.slotsJson = slotsJson;
    }

    public Integer getUseAiWorkflow() {
        return useAiWorkflow;
    }

    public void setUseAiWorkflow(Integer useAiWorkflow) {
        this.useAiWorkflow = useAiWorkflow;
    }

    public String getWorkflowPlatformCode() {
        return workflowPlatformCode;
    }

    public void setWorkflowPlatformCode(String workflowPlatformCode) {
        this.workflowPlatformCode = workflowPlatformCode;
    }

    public String getWorkflowCode() {
        return workflowCode;
    }

    public void setWorkflowCode(String workflowCode) {
        this.workflowCode = workflowCode;
    }

    public Integer getEnabled() {
        return enabled;
    }

    public void setEnabled(Integer enabled) {
        this.enabled = enabled;
    }

    public Integer getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(Integer sortOrder) {
        this.sortOrder = sortOrder;
    }

    public Long getCreatedBy() {
        return createdBy;
    }

    public void setCreatedBy(Long createdBy) {
        this.createdBy = createdBy;
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
