package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 业务表单注册表 {@code form_definition}。
 *
 * <p>一条记录 = 一个 {@code formCode} = 前端注册表里的一个组件。后台只管
 * 「哪个 formCode 存在、归哪一类、启用没有」；它长什么样由前端注册表负责，
 * 故此处刻意不存字段 schema（不做低代码设计器）。
 *
 * <p>分类树用单表自引用 {@code parentId}（邻接表，{@code 0} 表示根），
 * 与 {@code sys_menu} / {@code kb_category} 的既有做法一致。
 */
@Entity
@Table(name = "form_definition")
public class FormDefinition {

    public static final String STATUS_ENABLED = "ENABLED";
    public static final String STATUS_DISABLED = "DISABLED";

    /** 根分类的 parentId。 */
    public static final Long ROOT_PARENT_ID = 0L;

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "parent_id", nullable = false)
    private Long parentId = ROOT_PARENT_ID;

    /** 表单编码，精确匹配前端注册表 key（大小写敏感），软删后不可复用。 */
    @Column(nullable = false, length = 64)
    private String code;

    /** 中文名，后台展示用。 */
    @Column(nullable = false, length = 128)
    private String name;

    @Column(columnDefinition = "text")
    private String description;

    @Column(nullable = false, length = 16)
    private String status = STATUS_ENABLED;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    /** 预留位：图标/分组/排序权重等。 */
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
    public Long getParentId() { return parentId; }
    public void setParentId(Long parentId) { this.parentId = parentId; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Integer getSortOrder() { return sortOrder; }
    public void setSortOrder(Integer sortOrder) { this.sortOrder = sortOrder; }
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