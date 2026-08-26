package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 问数清单项（iqd_catalog_item）。
 *
 * <p>{@code item_key} 为跨表 JOIN 的唯一稳定键（见 architecture §4.2 item_key 规范）：
 * 表 = {@code {datasource}.{schema}.{table}}；字段 = 表键 + {@code .{column}}；
 * 语义 = {@code mdl:{kind}:{name}}。{@code in_scope} 表示是否进入问数范围（治理层勾选）。
 */
@Entity
@Table(name = "iqd_catalog_item")
public class IqdCatalogItem {

    @Id
    private Long id;

    @Column(name = "connection_id", nullable = false)
    private Long connectionId;

    @Column(nullable = false)
    private String kind;

    @Column(name = "parent_key")
    private String parentKey;

    @Column(name = "item_key", nullable = false)
    private String itemKey;

    @Column(name = "display_name")
    private String displayName;

    @Column(name = "data_type")
    private String dataType;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "is_primary_key", nullable = false)
    private Integer isPrimaryKey = 0;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "is_time_dimension", nullable = false)
    private Integer isTimeDimension = 0;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "is_email", nullable = false)
    private Integer isEmail = 0;

    @Column(columnDefinition = "text")
    private String description;

    @Column(columnDefinition = "text")
    private String expression;

    @Column(nullable = false)
    private String source = "db_meta";

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "in_scope", nullable = false)
    private Integer inScope = 0;

    @Column(name = "sensitive_level", nullable = false)
    private String sensitiveLevel = "none";

    @Column(name = "mask_rule")
    private String maskRule;

    /** 二期前向：平台是否可内建/改此 catalog 项（一期恒 false，仅占位）。 */
    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "editable", nullable = false)
    private Integer editable = 0;

    @Column(name = "last_seen_at")
    private Instant lastSeenAt;

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

    public String getKind() {
        return kind;
    }

    public void setKind(String kind) {
        this.kind = kind;
    }

    public String getParentKey() {
        return parentKey;
    }

    public void setParentKey(String parentKey) {
        this.parentKey = parentKey;
    }

    public String getItemKey() {
        return itemKey;
    }

    public void setItemKey(String itemKey) {
        this.itemKey = itemKey;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getDataType() {
        return dataType;
    }

    public void setDataType(String dataType) {
        this.dataType = dataType;
    }

    public Integer getIsPrimaryKey() {
        return isPrimaryKey;
    }

    public void setIsPrimaryKey(Integer isPrimaryKey) {
        this.isPrimaryKey = isPrimaryKey;
    }

    public Integer getIsTimeDimension() {
        return isTimeDimension;
    }

    public void setIsTimeDimension(Integer isTimeDimension) {
        this.isTimeDimension = isTimeDimension;
    }

    public Integer getIsEmail() {
        return isEmail;
    }

    public void setIsEmail(Integer isEmail) {
        this.isEmail = isEmail;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getExpression() {
        return expression;
    }

    public void setExpression(String expression) {
        this.expression = expression;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public Integer getInScope() {
        return inScope;
    }

    public void setInScope(Integer inScope) {
        this.inScope = inScope;
    }

    public String getSensitiveLevel() {
        return sensitiveLevel;
    }

    public void setSensitiveLevel(String sensitiveLevel) {
        this.sensitiveLevel = sensitiveLevel;
    }

    public String getMaskRule() {
        return maskRule;
    }

    public void setMaskRule(String maskRule) {
        this.maskRule = maskRule;
    }

    public Integer getEditable() {
        return editable;
    }

    public void setEditable(Integer editable) {
        this.editable = editable;
    }

    public Instant getLastSeenAt() {
        return lastSeenAt;
    }

    public void setLastSeenAt(Instant lastSeenAt) {
        this.lastSeenAt = lastSeenAt;
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
