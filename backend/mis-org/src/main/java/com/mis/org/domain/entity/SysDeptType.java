package com.mis.org.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 部门类型（独立概念，不复用 sys_dept.category_id）。
 * 精确对齐 {@link SysPostType} 实际字段（id, tenant_id, code, name, sort, status,
 * parent_id, is_leaf, created_at, updated_at）；不另加 ancestors/level/org_id。
 */
@Entity
@Table(name = "sys_dept_type")
public class SysDeptType {

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(nullable = false)
    private String code;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private Integer sort;

    @Column(nullable = false)
    private Integer status;

    /** 父级 id，0=根级（无父）。 */
    @Column(name = "parent_id", nullable = false)
    private Long parentId;

    /**
     * 末级标记（显式可写字段，不按是否有子节点推导）：
     * 1=末级（可被部门选用）/ 0=非末级（分类，可挂子类型）。
     */
    @Column(name = "is_leaf", nullable = false)
    private Integer isLeaf;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public Integer getSort() { return sort; }
    public void setSort(Integer sort) { this.sort = sort; }
    public Integer getStatus() { return status; }
    public void setStatus(Integer status) { this.status = status; }
    public Long getParentId() { return parentId; }
    public void setParentId(Long parentId) { this.parentId = parentId; }
    public Integer getIsLeaf() { return isLeaf; }
    public void setIsLeaf(Integer isLeaf) { this.isLeaf = isLeaf; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
