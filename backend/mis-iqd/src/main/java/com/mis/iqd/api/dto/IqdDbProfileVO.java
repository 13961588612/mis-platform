package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

/**
 * 数据库连接配置视图（Tab①，wire snake_case）。密码恒不回显（只回 {@code has_password}）。
 */
public class IqdDbProfileVO {

    private Long id;
    private String name;
    private String dbType;
    private String dbHost;
    private Integer dbPort;
    private String dbDatabase;
    private String dbUser;
    /** 恒回 ******（不泄露 secret_ref 真值）。 */
    private String secretRef = "******";
    /** vault 是否已有该 ref 的密码（列表/编辑提示是否需重填）。 */
    private Boolean hasPassword;
    private String description;
    private Boolean enabled;
    private Boolean isDefault;
    private Instant lastTestAt;
    private Boolean lastTestOk;
    private String lastTestMsg;
    private Instant createdAt;
    private Instant updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    @JsonProperty("db_type")
    public String getDbType() { return dbType; }
    public void setDbType(String dbType) { this.dbType = dbType; }

    @JsonProperty("db_host")
    public String getDbHost() { return dbHost; }
    public void setDbHost(String dbHost) { this.dbHost = dbHost; }

    @JsonProperty("db_port")
    public Integer getDbPort() { return dbPort; }
    public void setDbPort(Integer dbPort) { this.dbPort = dbPort; }

    @JsonProperty("db_database")
    public String getDbDatabase() { return dbDatabase; }
    public void setDbDatabase(String dbDatabase) { this.dbDatabase = dbDatabase; }

    @JsonProperty("db_user")
    public String getDbUser() { return dbUser; }
    public void setDbUser(String dbUser) { this.dbUser = dbUser; }

    @JsonProperty("secret_ref")
    public String getSecretRef() { return secretRef; }
    public void setSecretRef(String secretRef) { this.secretRef = secretRef; }

    @JsonProperty("has_password")
    public Boolean getHasPassword() { return hasPassword; }
    public void setHasPassword(Boolean hasPassword) { this.hasPassword = hasPassword; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }

    @JsonProperty("is_default")
    public Boolean getIsDefault() { return isDefault; }
    public void setIsDefault(Boolean isDefault) { this.isDefault = isDefault; }

    @JsonProperty("last_test_at")
    public Instant getLastTestAt() { return lastTestAt; }
    public void setLastTestAt(Instant lastTestAt) { this.lastTestAt = lastTestAt; }

    @JsonProperty("last_test_ok")
    public Boolean getLastTestOk() { return lastTestOk; }
    public void setLastTestOk(Boolean lastTestOk) { this.lastTestOk = lastTestOk; }

    @JsonProperty("last_test_msg")
    public String getLastTestMsg() { return lastTestMsg; }
    public void setLastTestMsg(String lastTestMsg) { this.lastTestMsg = lastTestMsg; }

    @JsonProperty("created_at")
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }

    @JsonProperty("updated_at")
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }

    @JsonIgnore
    public String getSecretRefInternal() { return secretRef; }
}
