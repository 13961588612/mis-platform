package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 清单项响应 VO（GET /api/v1/iqd/catalog；snake_case wire，与 mis-iqd 同构）。
 */
public class IqdCatalogItemVO {

    private Long id;
    private Long connectionId;
    private String kind;
    private String parentKey;
    private String itemKey;
    private String displayName;
    private String dataType;
    private Boolean isPrimaryKey;
    private Boolean isTimeDimension;
    private Boolean isEmail;
    private String description;
    private String expression;
    private String source;
    private Boolean inScope;
    private String sensitiveLevel;
    private String maskRule;

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

    @JsonProperty("parent_key")
    public String getParentKey() {
        return parentKey;
    }

    public void setParentKey(String parentKey) {
        this.parentKey = parentKey;
    }

    @JsonProperty("item_key")
    public String getItemKey() {
        return itemKey;
    }

    public void setItemKey(String itemKey) {
        this.itemKey = itemKey;
    }

    @JsonProperty("display_name")
    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    @JsonProperty("data_type")
    public String getDataType() {
        return dataType;
    }

    public void setDataType(String dataType) {
        this.dataType = dataType;
    }

    @JsonProperty("is_primary_key")
    public Boolean getIsPrimaryKey() {
        return isPrimaryKey;
    }

    public void setIsPrimaryKey(Boolean isPrimaryKey) {
        this.isPrimaryKey = isPrimaryKey;
    }

    @JsonProperty("is_time_dimension")
    public Boolean getIsTimeDimension() {
        return isTimeDimension;
    }

    public void setIsTimeDimension(Boolean isTimeDimension) {
        this.isTimeDimension = isTimeDimension;
    }

    @JsonProperty("is_email")
    public Boolean getIsEmail() {
        return isEmail;
    }

    public void setIsEmail(Boolean isEmail) {
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

    @JsonProperty("in_scope")
    public Boolean getInScope() {
        return inScope;
    }

    public void setInScope(Boolean inScope) {
        this.inScope = inScope;
    }

    @JsonProperty("sensitive_level")
    public String getSensitiveLevel() {
        return sensitiveLevel;
    }

    public void setSensitiveLevel(String sensitiveLevel) {
        this.sensitiveLevel = sensitiveLevel;
    }

    @JsonProperty("mask_rule")
    public String getMaskRule() {
        return maskRule;
    }

    public void setMaskRule(String maskRule) {
        this.maskRule = maskRule;
    }
}
