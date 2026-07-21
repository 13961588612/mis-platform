package com.mis.iam.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "sys_app")
public class SysApp {

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(nullable = false)
    private String code;

    @Column(nullable = false)
    private String name;

    @Column
    private String icon;

    @Column(name = "base_path")
    private String basePath;

    @Column(name = "mfe_remote")
    private String mfeRemote;

    @Column(nullable = false)
    private Integer sort;

    @Column(nullable = false)
    private Integer status;

    @Column(nullable = false)
    private String kind = "subsystem";

    @Column(nullable = false)
    private String runtime = "host";

    @Column
    private String description;

    @Column(name = "portal_group")
    private String portalGroup;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getIcon() { return icon; }
    public void setIcon(String icon) { this.icon = icon; }
    public String getBasePath() { return basePath; }
    public void setBasePath(String basePath) { this.basePath = basePath; }
    public String getMfeRemote() { return mfeRemote; }
    public void setMfeRemote(String mfeRemote) { this.mfeRemote = mfeRemote; }
    public Integer getSort() { return sort; }
    public void setSort(Integer sort) { this.sort = sort; }
    public Integer getStatus() { return status; }
    public void setStatus(Integer status) { this.status = status; }
    public String getKind() { return kind; }
    public void setKind(String kind) { this.kind = kind; }
    public String getRuntime() { return runtime; }
    public void setRuntime(String runtime) { this.runtime = runtime; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getPortalGroup() { return portalGroup; }
    public void setPortalGroup(String portalGroup) { this.portalGroup = portalGroup; }
}
