package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 数据库连接配置（Tab① = wren profile 的平台侧登记）。
 *
 * <p>路线 A 分层（2026-09-29）：本表只描述「业务库在哪」，与「语义工程（project = wren
 * context）」解耦，二者是 **1 : N**（同一业务库可挂多个语义工程）。
 *
 * <p><b>安全红线</b>：密码明文只在 ai-platform vault（`credential_mappings`），本表仅存
 * {@code secret_ref} 引用；绝不落明文。
 */
@Entity
@Table(name = "iqd_db_profile")
public class IqdDbProfile {

    @Id
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(name = "db_type", nullable = false)
    private String dbType = "starrocks";

    @Column(name = "db_host")
    private String dbHost;

    @Column(name = "db_port")
    private Integer dbPort;

    @Column(name = "db_database")
    private String dbDatabase;

    @Column(name = "db_user")
    private String dbUser;

    /** vault 引用（CredentialVault system_account）；密码绝不落本表。 */
    @Column(name = "secret_ref")
    private String secretRef;

    @Column
    private String description;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(nullable = false)
    private Integer enabled = 1;

    /** 新建 project 时默认选中的 profile（0/1，业务层保证至多一条为 1）。 */
    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "is_default", nullable = false)
    private Integer isDefault = 0;

    @Column(name = "last_test_at")
    private Instant lastTestAt;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "last_test_ok")
    private Integer lastTestOk;

    @Column(name = "last_test_msg")
    private String lastTestMsg;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDbType() { return dbType; }
    public void setDbType(String dbType) { this.dbType = dbType; }
    public String getDbHost() { return dbHost; }
    public void setDbHost(String dbHost) { this.dbHost = dbHost; }
    public Integer getDbPort() { return dbPort; }
    public void setDbPort(Integer dbPort) { this.dbPort = dbPort; }
    public String getDbDatabase() { return dbDatabase; }
    public void setDbDatabase(String dbDatabase) { this.dbDatabase = dbDatabase; }
    public String getDbUser() { return dbUser; }
    public void setDbUser(String dbUser) { this.dbUser = dbUser; }
    public String getSecretRef() { return secretRef; }
    public void setSecretRef(String secretRef) { this.secretRef = secretRef; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public Integer getEnabled() { return enabled; }
    public void setEnabled(Integer enabled) { this.enabled = enabled; }
    public Integer getIsDefault() { return isDefault; }
    public void setIsDefault(Integer isDefault) { this.isDefault = isDefault; }
    public Instant getLastTestAt() { return lastTestAt; }
    public void setLastTestAt(Instant lastTestAt) { this.lastTestAt = lastTestAt; }
    public Integer getLastTestOk() { return lastTestOk; }
    public void setLastTestOk(Integer lastTestOk) { this.lastTestOk = lastTestOk; }
    public String getLastTestMsg() { return lastTestMsg; }
    public void setLastTestMsg(String lastTestMsg) { this.lastTestMsg = lastTestMsg; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
