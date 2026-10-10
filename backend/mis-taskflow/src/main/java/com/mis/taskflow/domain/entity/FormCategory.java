package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 表单分类邻接树 {@code form_category}（决策 B：与表单定义拆分为两张表）。
 *
 * <p>分类是表单的<b>属性</b>（{@code form_definition.category_id}），不再是表单的<b>父级</b>。
 * 分类自身仍是一棵任意深度的邻接树——{@code parent_id} 自引用（{@code 0} 表示根）。
 *
 * <p>结构逐列镜像已跑通的 {@link WfCategory}（去掉 {@code status}，无 {@code kind}）：
 * 分类就是文件夹，不存在「分类 vs 表单」之分。
 */
@Entity
@Table(name = "form_category")
public class FormCategory {

    /** 根分类的 parentId。 */
    public static final Long ROOT_PARENT_ID = 0L;

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "parent_id", nullable = false)
    private Long parentId = ROOT_PARENT_ID;

    /** 分类编码，租户内唯一（文件夹 key）。 */
    @Column(nullable = false, length = 64)
    private String code;

    /** 中文名，展示用。 */
    @Column(nullable = false, length = 128)
    private String name;

    @Column(columnDefinition = "text")
    private String description;

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
