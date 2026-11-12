package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 行级范围维度注册表响应 VO（GET /internal/v1/iqd/get-dimensions；snake_case wire）。
 */
public class IqdScopeDimensionVO {

    private Long id;
    private String dimensionCode;
    private String dimensionName;
    private String predicateType;
    private String columnName;
    private String headerName;
    private String paramWhitelist;
    private String dictTable;
    private Boolean autoMode;
    private Boolean enabled;
    private Integer sort;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getDimensionCode() {
        return dimensionCode;
    }

    public void setDimensionCode(String dimensionCode) {
        this.dimensionCode = dimensionCode;
    }

    public String getDimensionName() {
        return dimensionName;
    }

    public void setDimensionName(String dimensionName) {
        this.dimensionName = dimensionName;
    }

    public String getPredicateType() {
        return predicateType;
    }

    public void setPredicateType(String predicateType) {
        this.predicateType = predicateType;
    }

    public String getColumnName() {
        return columnName;
    }

    public void setColumnName(String columnName) {
        this.columnName = columnName;
    }

    public String getHeaderName() {
        return headerName;
    }

    public void setHeaderName(String headerName) {
        this.headerName = headerName;
    }

    public String getParamWhitelist() {
        return paramWhitelist;
    }

    public void setParamWhitelist(String paramWhitelist) {
        this.paramWhitelist = paramWhitelist;
    }

    public String getDictTable() {
        return dictTable;
    }

    public void setDictTable(String dictTable) {
        this.dictTable = dictTable;
    }

    public Boolean getAutoMode() {
        return autoMode;
    }

    public void setAutoMode(Boolean autoMode) {
        this.autoMode = autoMode;
    }

    public Boolean getEnabled() {
        return enabled;
    }

    public void setEnabled(Boolean enabled) {
        this.enabled = enabled;
    }

    public Integer getSort() {
        return sort;
    }

    public void setSort(Integer sort) {
        this.sort = sort;
    }

    @JsonProperty("dimension_code")
    public String dimensionCodeWire() {
        return dimensionCode;
    }

    @JsonProperty("dimension_name")
    public String dimensionNameWire() {
        return dimensionName;
    }

    @JsonProperty("predicate_type")
    public String predicateTypeWire() {
        return predicateType;
    }

    @JsonProperty("column_name")
    public String columnNameWire() {
        return columnName;
    }

    @JsonProperty("header_name")
    public String headerNameWire() {
        return headerName;
    }

    @JsonProperty("param_whitelist")
    public String paramWhitelistWire() {
        return paramWhitelist;
    }

    @JsonProperty("dict_table")
    public String dictTableWire() {
        return dictTable;
    }

    @JsonProperty("auto_mode")
    public Boolean autoModeWire() {
        return autoMode;
    }
}
