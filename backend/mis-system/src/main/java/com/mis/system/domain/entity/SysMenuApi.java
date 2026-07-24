package com.mis.system.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "sys_menu_api")
public class SysMenuApi {

    @Id
    private Long id;

    @Column(name = "menu_id", nullable = false)
    private Long menuId;

    @Column(name = "api_id", nullable = false)
    private Long apiId;

    @Column(nullable = false)
    private Integer sort;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getMenuId() { return menuId; }
    public void setMenuId(Long menuId) { this.menuId = menuId; }
    public Long getApiId() { return apiId; }
    public void setApiId(Long apiId) { this.apiId = apiId; }
    public Integer getSort() { return sort; }
    public void setSort(Integer sort) { this.sort = sort; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
