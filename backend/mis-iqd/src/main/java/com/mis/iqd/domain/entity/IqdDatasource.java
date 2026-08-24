package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 问数数据源（iqd_datasource）。
 *
 * <p>一个连接下可挂多个数据源（Q10 多库演进预留）；{@code scope_sync_enabled}（v1.9
 * 由 {@code dept_scope_sync_enabled} 改名）标记该库是否启用 mis_dept_scope/mis_store_scope
 * 字典同步——接入新业务库的一次性注册项，非权限配置（见 architecture §4.2.2 D.6.4）。
 */
@Entity
@Table(name = "iqd_datasource")
public class IqdDatasource {

    @Id
    private Long id;

    @Column(name = "connection_id", nullable = false)
    private Long connectionId;

    @Column(name = "connector_type")
    private String connectorType;

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Column(name = "catalog_name")
    private String catalogName;

    @Column(name = "schema_name")
    private String schemaName;

    @Column(name = "credential_ref")
    private String credentialRef;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(nullable = false)
    private Integer enabled = 1;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "scope_sync_enabled", nullable = false)
    private Integer scopeSyncEnabled = 0;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getConnectionId() {
        return connectionId;
    }

    public void setConnectionId(Long connectionId) {
        this.connectionId = connectionId;
    }

    public String getConnectorType() {
        return connectorType;
    }

    public void setConnectorType(String connectorType) {
        this.connectorType = connectorType;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getCatalogName() {
        return catalogName;
    }

    public void setCatalogName(String catalogName) {
        this.catalogName = catalogName;
    }

    public String getSchemaName() {
        return schemaName;
    }

    public void setSchemaName(String schemaName) {
        this.schemaName = schemaName;
    }

    public String getCredentialRef() {
        return credentialRef;
    }

    public void setCredentialRef(String credentialRef) {
        this.credentialRef = credentialRef;
    }

    public Integer getEnabled() {
        return enabled;
    }

    public void setEnabled(Integer enabled) {
        this.enabled = enabled;
    }

    public Integer getScopeSyncEnabled() {
        return scopeSyncEnabled;
    }

    public void setScopeSyncEnabled(Integer scopeSyncEnabled) {
        this.scopeSyncEnabled = scopeSyncEnabled;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
