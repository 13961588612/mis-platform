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

    /**
     * Cube 所属模型 item_key（如 {@code mdl:model:orders}）；仅 {@code kind=cube} 使用。
     *
     * <p>V89 新增（可空、**无回填**）。补该列的理由：唯一在写 cube 的 MDL 同步路径
     * （{@code IqdMdlParser:158}）把 {@code baseObject} 兜底塞进了 {@code expression}，
     * 使 {@code expression} 对 cube 成为**二义列**；把 model_ref 挤进 expression 会让
     * 同一列含义依赖 source/kind，且破坏 {@code validateCatalogRefs} 的
     * {@code expression.contains(item_key)} 反向引用扫描语义。故独立成列。
     *
     * <p>语义：{@code NULL} = 未记录（含 MDL 同步来源，其归属暂由 expression/baseObject 兜底）；
     * 建模台新写入的 cube 一律填写（T03 {@code createCube}）。
     */
    @Column(name = "model_ref")
    private String modelRef;

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

    /** 该节点最后被平台编辑所属 revision；NULL=从未编辑（沿用 WrenAI 镜像）。 */
    @Column(name = "edit_revision")
    private Long editRevision;

    /** 该节点被编入的 mdl_hash（批量回填盖章）；NULL=未同步。 */
    @Column(name = "wren_ref_id")
    private String wrenRefId;

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

    /** Cube 所属模型 item_key（仅 kind=cube；可空，V89 列 {@code model_ref}）。 */
    public String getModelRef() {
        return modelRef;
    }

    public void setModelRef(String modelRef) {
        this.modelRef = modelRef;
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

    public Long getEditRevision() {
        return editRevision;
    }

    public void setEditRevision(Long editRevision) {
        this.editRevision = editRevision;
    }

    public String getWrenRefId() {
        return wrenRefId;
    }

    public void setWrenRefId(String wrenRefId) {
        this.wrenRefId = wrenRefId;
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
