package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 统一「业务分类」邻接树 {@code biz_category}（租户通用、与 APP 无关）。
 *
 * <p><b>语义</b>（见 docs/design/biz-category-unification-design.md §1.1）：
 * 树节点即「业务分类」；节点 {@code code} 即<b>业务类型编码</b>（租户内唯一）。
 * 叶子节点 = 具体业务类型，内部节点 = 业务类型分组。结构对齐「流程分类表结构」
 * （去掉 APP 维度）。{@code parent_id} 自引用（{@code 0} 表示根）。
 *
 * <p>软引用方：定义侧 {@code wf_definition.category_id} / {@code form_definition.category_id}
 * 软引用 {@code biz_category.id}；运行侧 {@code sys_task.biz_type} /
 * {@code wf_instance.business_type} / {@code sys_message.biz_type} 软引用 {@code biz_category.code}。
 */
@Entity
@Table(name = "biz_category")
public class BizCategory {

    /** 根分类的 parentId。 */
    public static final Long ROOT_PARENT_ID = 0L;

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "parent_id", nullable = false)
    private Long parentId = ROOT_PARENT_ID;

    /** 业务类型编码（租户内唯一；运行侧 biz_type/business_type 的引用键）。 */
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
