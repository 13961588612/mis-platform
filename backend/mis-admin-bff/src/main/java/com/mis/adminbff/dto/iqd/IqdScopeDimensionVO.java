package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 行级范围维度注册表 VO（GET /api/v1/iqd/dimensions；snake_case wire）。
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

    @JsonProperty("dimension_code")
    public String getDimensionCode() {
        return dimensionCode;
    }

    public void setDimensionCode(String dimensionCode) {
        this.dimensionCode = dimensionCode;
    }

    @JsonProperty("dimension_name")
    public String getDimensionName() {
        return dimensionName;
    }

    public void setDimensionName(String dimensionName) {
        this.dimensionName = dimensionName;
    }

    @JsonProperty("predicate_type")
    public String getPredicateType() {
        return predicateType;
    }

    public void setPredicateType(String predicateType) {
        this.predicateType = predicateType;
    }

    @JsonProperty("column_name")
    public String getColumnName() {
        return columnName;
    }

    public void setColumnName(String columnName) {
        this.columnName = columnName;
    }

    @JsonProperty("header_name")
    public String getHeaderName() {
        return headerName;
    }

    public void setHeaderName(String headerName) {
        this.headerName = headerName;
    }

    @JsonProperty("param_whitelist")
    public String getParamWhitelist() {
        return paramWhitelist;
    }

    public void setParamWhitelist(String paramWhitelist) {
        this.paramWhitelist = paramWhitelist;
    }

    @JsonProperty("dict_table")
    public String getDictTable() {
        return dictTable;
    }

    public void setDictTable(String dictTable) {
        this.dictTable = dictTable;
    }

    @JsonProperty("auto_mode")
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
}
