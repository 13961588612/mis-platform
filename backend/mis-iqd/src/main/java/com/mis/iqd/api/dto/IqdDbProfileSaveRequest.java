package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

/**
 * 数据库连接配置保存请求（Tab①，wire snake_case）。
 *
 * <p>密码字段 {@code db_password} **只在请求体里短暂存在**：BFF 会把它转投 ai-platform
 * vault，mis-iqd 侧只落 {@code secret_ref} 引用（本 DTO 不带 password 的持久化语义）。
 */
public class IqdDbProfileSaveRequest {

    @NotBlank(message = "连接名不能为空")
    private String name;

    private String dbType = "starrocks";

    private String dbHost;

    private Integer dbPort;

    private String dbDatabase;

    private String dbUser;

    /** vault 引用；提交非空才更新（GET 恒回 ******）。 */
    private String secretRef;

    /** 【写路径】密码明文；仅经 BFF 转投 vault，不落 mis-iqd。 */
    private String dbPassword;

    private String description;

    private Boolean enabled = true;

    private Boolean isDefault = false;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    @JsonProperty("db_type")
    public String getDbType() { return dbType; }
    @JsonProperty("db_type")
    public void setDbType(String dbType) { this.dbType = dbType; }

    @JsonProperty("db_host")
    public String getDbHost() { return dbHost; }
    @JsonProperty("db_host")
    public void setDbHost(String dbHost) { this.dbHost = dbHost; }

    @JsonProperty("db_port")
    public Integer getDbPort() { return dbPort; }
    @JsonProperty("db_port")
    public void setDbPort(Integer dbPort) { this.dbPort = dbPort; }

    @JsonProperty("db_database")
    public String getDbDatabase() { return dbDatabase; }
    @JsonProperty("db_database")
    public void setDbDatabase(String dbDatabase) { this.dbDatabase = dbDatabase; }

    @JsonProperty("db_user")
    public String getDbUser() { return dbUser; }
    @JsonProperty("db_user")
    public void setDbUser(String dbUser) { this.dbUser = dbUser; }

    @JsonProperty("secret_ref")
    public String getSecretRef() { return secretRef; }
    @JsonProperty("secret_ref")
    public void setSecretRef(String secretRef) { this.secretRef = secretRef; }

    @JsonProperty("db_password")
    public String getDbPassword() { return dbPassword; }
    @JsonProperty("db_password")
    public void setDbPassword(String dbPassword) { this.dbPassword = dbPassword; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }

    @JsonProperty("is_default")
    public Boolean getIsDefault() { return isDefault; }
    @JsonProperty("is_default")
    public void setIsDefault(Boolean isDefault) { this.isDefault = isDefault; }

    public boolean isSecretPlaceholder() {
        return secretRef == null || "******".equals(secretRef.trim());
    }
}
