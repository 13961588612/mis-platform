package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 流程定义 {@code wf_definition}。
 *
 * <p>{@code supportedFormCodes} 为表单白名单（TEXT[]）：一个流程可被多个表单复用；
 * 启动实例时校验 {@code startedFormCode} 必须在白名单内。
 */
@Entity
@Table(name = "wf_definition")
public class WfDefinition {

    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_ARCHIVED = "ARCHIVED";

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 64)
    private String code;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(nullable = false, length = 32)
    private String category = "APPROVAL";

    /**
     * 流程分类（V131 新增）：指向 {@code wf_category.id} 的软引用（无外键约束）。
     * 新代码只认 {@code categoryId}；旧 {@link #category VARCHAR} 列保留但废弃，不再赋予业务含义。
     */
    @Column(name = "category_id")
    private Long categoryId;

    @Column(columnDefinition = "text")
    private String description;

    @Column(nullable = false)
    private Integer version = 1;

    @Column(nullable = false, length = 16)
    private String status = STATUS_DRAFT;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "supported_form_codes", nullable = false, columnDefinition = "text[]")
    private String[] supportedFormCodes = new String[0];

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "form_schema", columnDefinition = "jsonb")
    private String formSchema;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String config = "{}";

    @Column(nullable = false)
    private Integer deleted = 0;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public Long getCategoryId() { return categoryId; }
    public void setCategoryId(Long categoryId) { this.categoryId = categoryId; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String[] getSupportedFormCodes() { return supportedFormCodes; }
    public void setSupportedFormCodes(String[] supportedFormCodes) { this.supportedFormCodes = supportedFormCodes; }
    public String getFormSchema() { return formSchema; }
    public void setFormSchema(String formSchema) { this.formSchema = formSchema; }
    public String getConfig() { return config; }
    public void setConfig(String config) { this.config = config; }
    public Integer getDeleted() { return deleted; }
    public void setDeleted(Integer deleted) { this.deleted = deleted; }
    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
