package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 行级数据范围维度注册表（iqd_row_scope_dimension）——v1.9 一期必做。
 *
 * <p>一期种子两条：{@code dept}（predicate_type=PATH_PREFIX，列 dept_id，
 * 头 X-Mis-Dept-Scope，字典 mis_dept_scope，auto_mode=true）与 {@code store}
 * （predicate_type=ENUM，列 store_id，头 X-Mis-Stores，字典 mis_store_scope，
 * auto_mode=true）。{@code row_scope} 的维度引用即本表 {@code dimension_code}，
 * 新增维度 = 注册一条记录（含可选字典表），无需新增 type 分支。
 */
@Entity
@Table(name = "iqd_row_scope_dimension")
public class IqdRowScopeDimension {

    @Id
    private Long id;

    @Column(name = "dimension_code", nullable = false)
    private String dimensionCode;

    @Column(name = "dimension_name", nullable = false)
    private String dimensionName;

    @Column(name = "predicate_type", nullable = false)
    private String predicateType;

    @Column(name = "column_name", nullable = false)
    private String columnName;

    @Column(name = "header_name", nullable = false)
    private String headerName;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "param_whitelist", columnDefinition = "jsonb")
    private String paramWhitelist;

    @Column(name = "dict_table")
    private String dictTable;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "auto_mode", nullable = false)
    private Integer autoMode = 1;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(nullable = false)
    private Integer enabled = 1;

    @Column(nullable = false)
    private Integer sort = 0;

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

    public Integer getAutoMode() {
        return autoMode;
    }

    public void setAutoMode(Integer autoMode) {
        this.autoMode = autoMode;
    }

    public Integer getEnabled() {
        return enabled;
    }

    public void setEnabled(Integer enabled) {
        this.enabled = enabled;
    }

    public Integer getSort() {
        return sort;
    }

    public void setSort(Integer sort) {
        this.sort = sort;
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
