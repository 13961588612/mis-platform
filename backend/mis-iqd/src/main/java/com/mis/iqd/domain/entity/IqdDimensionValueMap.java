package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 行级范围「MIS 值 ⇄ 数仓值」映射（iqd_dimension_value_map）。
 *
 * <p>X-Mis-Dept-Scope / X-Mis-Stores 携带的是 mis-platform 自己的部门 id（sys_dept.id）
 * 与门店 id；数仓业务表里存的是对方系统的部门/门店编码（如 org_dept_code / shop_no）。
 * 本表把 MIS 侧值翻译成「该连接对应数仓」的外部编码。
 *
 * <p>关键约束（见 V117）：映射必须带 {@code connectionId}（多源）；唯一键含
 * {@code externalValue} 以支持 1:N。
 *
 * <p>缺映射语义在解析服务实现：store 无映射 = 无权限（丢弃）；dept 锚点无直接映射 =
 * 向下找有映射的后代作为限制范围。
 */
@Entity
@Table(name = "iqd_dimension_value_map")
public class IqdDimensionValueMap {

    @Id
    private Long id;

    @Column(name = "connection_id", nullable = false)
    private Long connectionId;

    @Column(name = "dimension_code", nullable = false)
    private String dimensionCode;

    @Column(name = "mis_value", nullable = false)
    private String misValue;

    @Column(name = "external_value", nullable = false)
    private String externalValue;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(nullable = false)
    private Integer effective = 1;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "covers_subtree", nullable = false)
    private Integer coversSubtree = 1;

    @Column
    private String remark;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getConnectionId() { return connectionId; }
    public void setConnectionId(Long connectionId) { this.connectionId = connectionId; }
    public String getDimensionCode() { return dimensionCode; }
    public void setDimensionCode(String dimensionCode) { this.dimensionCode = dimensionCode; }
    public String getMisValue() { return misValue; }
    public void setMisValue(String misValue) { this.misValue = misValue; }
    public String getExternalValue() { return externalValue; }
    public void setExternalValue(String externalValue) { this.externalValue = externalValue; }
    public Integer getEffective() { return effective; }
    public void setEffective(Integer effective) { this.effective = effective; }
    public String getRemark() { return remark; }
    public void setRemark(String remark) { this.remark = remark; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
    public Integer getCoversSubtree() { return coversSubtree; }
    public void setCoversSubtree(Integer coversSubtree) { this.coversSubtree = coversSubtree; }
}
