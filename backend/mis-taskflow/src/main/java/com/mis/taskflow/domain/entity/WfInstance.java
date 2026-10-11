package com.mis.taskflow.domain.entity;

import com.mis.taskflow.support.TaskflowStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 流程实例 {@code wf_instance}。
 *
 * <p>{@code startedFormCode} 记录本次运行实际使用的表单（来自定义白名单）；
 * {@code postProcessStatus} 记录「审批后执行情况」，与流程状态解耦。
 */
@Entity
@Table(name = "wf_instance")
public class WfInstance {

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "definition_id", nullable = false)
    private Long definitionId;

    @Column(name = "definition_code", nullable = false, length = 64)
    private String definitionCode;

    @Column(name = "started_form_code", length = 64)
    private String startedFormCode;

    @Column(name = "business_type", nullable = false, length = 64)
    private String businessType;

    @Column(name = "business_id", nullable = false, length = 128)
    private String businessId;

    /**
     * 应用归属（{@code sys_app.code}）；{@code NULL} = 平台级。
     *
     * <p><b>语义</b>（见 docs/design/biz-category-unification-design.md §2.1）：
     * 流程实例启动时由发起方显式写入（{@code StartProcessRequest.appCode}）；
     * 其分派待办（{@code ProcessService:assignNode}）与结果通知（{@code ProcessService:notify}）
     * <b>继承</b>该值。**不由业务类型推导**（P0 绑定表已作废）。列由 V138 迁移新增。
     */
    @Column(name = "app_code", length = 64)
    private String appCode;

    @Column(nullable = false, length = 16)
    private String status = TaskflowStatus.Instance.RUNNING;

    @Column(name = "initiator_id", nullable = false)
    private Long initiatorId;

    @Column(name = "initiator_name", length = 64)
    private String initiatorName;

    @Column(name = "current_node_code", length = 64)
    private String currentNodeCode;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "form_data", columnDefinition = "jsonb")
    private String formData;

    @Column(length = 32)
    private String progress;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "extra_context", columnDefinition = "jsonb", nullable = false)
    private String extraContext = "{}";

    @Column(name = "post_process_status", nullable = false, length = 16)
    private String postProcessStatus = TaskflowStatus.PostProcess.WAITING;

    @Column(name = "post_process_time")
    private LocalDateTime postProcessTime;

    @Column(name = "post_process_msg", length = 512)
    private String postProcessMsg;

    @Column(name = "post_retry_count", nullable = false)
    private Integer postRetryCount = 0;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public Long getDefinitionId() { return definitionId; }
    public void setDefinitionId(Long definitionId) { this.definitionId = definitionId; }
    public String getDefinitionCode() { return definitionCode; }
    public void setDefinitionCode(String definitionCode) { this.definitionCode = definitionCode; }
    public String getStartedFormCode() { return startedFormCode; }
    public void setStartedFormCode(String startedFormCode) { this.startedFormCode = startedFormCode; }
    public String getBusinessType() { return businessType; }
    public void setBusinessType(String businessType) { this.businessType = businessType; }
    public String getBusinessId() { return businessId; }
    public void setBusinessId(String businessId) { this.businessId = businessId; }
    public String getAppCode() { return appCode; }
    public void setAppCode(String appCode) { this.appCode = appCode; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Long getInitiatorId() { return initiatorId; }
    public void setInitiatorId(Long initiatorId) { this.initiatorId = initiatorId; }
    public String getInitiatorName() { return initiatorName; }
    public void setInitiatorName(String initiatorName) { this.initiatorName = initiatorName; }
    public String getCurrentNodeCode() { return currentNodeCode; }
    public void setCurrentNodeCode(String currentNodeCode) { this.currentNodeCode = currentNodeCode; }
    public String getFormData() { return formData; }
    public void setFormData(String formData) { this.formData = formData; }
    public String getProgress() { return progress; }
    public void setProgress(String progress) { this.progress = progress; }
    public String getExtraContext() { return extraContext; }
    public void setExtraContext(String extraContext) { this.extraContext = extraContext; }
    public String getPostProcessStatus() { return postProcessStatus; }
    public void setPostProcessStatus(String postProcessStatus) { this.postProcessStatus = postProcessStatus; }
    public LocalDateTime getPostProcessTime() { return postProcessTime; }
    public void setPostProcessTime(LocalDateTime postProcessTime) { this.postProcessTime = postProcessTime; }
    public String getPostProcessMsg() { return postProcessMsg; }
    public void setPostProcessMsg(String postProcessMsg) { this.postProcessMsg = postProcessMsg; }
    public Integer getPostRetryCount() { return postRetryCount; }
    public void setPostRetryCount(Integer postRetryCount) { this.postRetryCount = postRetryCount; }
    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
