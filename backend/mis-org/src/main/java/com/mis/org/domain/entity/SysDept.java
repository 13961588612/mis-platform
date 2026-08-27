package com.mis.org.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.SQLRestriction;

import java.time.Instant;

@Entity
@Table(name = "sys_dept")
@SQLRestriction("deleted = 0")
public class SysDept {

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "org_id", nullable = false)
    private Long orgId;

    @Column(name = "parent_id", nullable = false)
    private Long parentId;

    @Column(nullable = false)
    private String code;

    @Column(nullable = false)
    private String name;

    @Column(name = "category_id", nullable = false)
    private Long categoryId;

    @Column(nullable = false)
    private String ancestors;

    @Column(nullable = false)
    private Integer sort;

    @Column(nullable = false)
    private Integer status;

    @Column(name = "is_root", nullable = false)
    private Integer isRoot;

    @Column(name = "leader_employee_id")
    private Long leaderEmployeeId;

    /** V40 新增：手工对应组织（穿透锚点，NULL=无） */
    @Column(name = "linked_org_id")
    private Long linkedOrgId;

    /** 部门类型 id（逻辑关联 sys_dept_type.id；NULL=未设置，应用层必填） */
    @Column(name = "dept_type_id")
    private Long deptTypeId;

    /** 部门编制数 / headcount 配额（NULL=未设置，默认 0） */
    @Column(name = "establishment_count")
    private Integer establishmentCount;

    @Column(nullable = false)
    private Integer deleted;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_by")
    private Long updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public Long getOrgId() { return orgId; }
    public void setOrgId(Long orgId) { this.orgId = orgId; }
    public Long getParentId() { return parentId; }
    public void setParentId(Long parentId) { this.parentId = parentId; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public Long getCategoryId() { return categoryId; }
    public void setCategoryId(Long categoryId) { this.categoryId = categoryId; }
    public String getAncestors() { return ancestors; }
    public void setAncestors(String ancestors) { this.ancestors = ancestors; }
    public Integer getSort() { return sort; }
    public void setSort(Integer sort) { this.sort = sort; }
    public Integer getStatus() { return status; }
    public void setStatus(Integer status) { this.status = status; }
    public Integer getIsRoot() { return isRoot; }
    public void setIsRoot(Integer isRoot) { this.isRoot = isRoot; }
    public Long getLeaderEmployeeId() { return leaderEmployeeId; }
    public void setLeaderEmployeeId(Long leaderEmployeeId) { this.leaderEmployeeId = leaderEmployeeId; }
    public Long getLinkedOrgId() { return linkedOrgId; }
    public void setLinkedOrgId(Long linkedOrgId) { this.linkedOrgId = linkedOrgId; }
    public Long getDeptTypeId() { return deptTypeId; }
    public void setDeptTypeId(Long deptTypeId) { this.deptTypeId = deptTypeId; }
    public Integer getEstablishmentCount() { return establishmentCount; }
    public void setEstablishmentCount(Integer establishmentCount) { this.establishmentCount = establishmentCount; }
    public Integer getDeleted() { return deleted; }
    public void setDeleted(Integer deleted) { this.deleted = deleted; }
    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Long getUpdatedBy() { return updatedBy; }
    public void setUpdatedBy(Long updatedBy) { this.updatedBy = updatedBy; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
