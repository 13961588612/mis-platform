package com.mis.aireport.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class AiReportDefVO {

    private Long id;
    private String reportCode;
    private String title;
    private String description;
    private Long categoryId;
    private List<Map<String, Object>> slots;
    private Boolean useAiWorkflow;
    private String workflowPlatformCode;
    private String workflowCode;
    private Boolean enabled;
    private Integer sortOrder;
    private Instant createdAt;
    private Instant updatedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    @JsonProperty("report_code")
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

    @JsonProperty("category_id")
    public Long getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(Long categoryId) {
        this.categoryId = categoryId;
    }

    public List<Map<String, Object>> getSlots() {
        return slots;
    }

    public void setSlots(List<Map<String, Object>> slots) {
        this.slots = slots;
    }

    @JsonProperty("use_ai_workflow")
    public Boolean getUseAiWorkflow() {
        return useAiWorkflow;
    }

    public void setUseAiWorkflow(Boolean useAiWorkflow) {
        this.useAiWorkflow = useAiWorkflow;
    }

    @JsonProperty("workflow_platform_code")
    public String getWorkflowPlatformCode() {
        return workflowPlatformCode;
    }

    public void setWorkflowPlatformCode(String workflowPlatformCode) {
        this.workflowPlatformCode = workflowPlatformCode;
    }

    @JsonProperty("workflow_code")
    public String getWorkflowCode() {
        return workflowCode;
    }

    public void setWorkflowCode(String workflowCode) {
        this.workflowCode = workflowCode;
    }

    public Boolean getEnabled() {
        return enabled;
    }

    public void setEnabled(Boolean enabled) {
        this.enabled = enabled;
    }

    @JsonProperty("sort_order")
    public Integer getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(Integer sortOrder) {
        this.sortOrder = sortOrder;
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
