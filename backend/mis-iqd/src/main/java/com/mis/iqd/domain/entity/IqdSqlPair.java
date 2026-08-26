package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 问数样本对（iqd_sql_pair）——few-shot 问题↔SQL 样本，W4 同步进 WrenAI
 * {@code sql_pairs}（{@code wren_ref_id} 回填外部引用 id）。
 *
 * <p>v1.10（§4.2.3）：原 {@code sql_text} 改名为 {@code wren_sql}（WrenAI 方言，
 * 入库并推 WrenAI）；新增 {@code source_dialect}（用户所选关系库类型）与
 * {@code native_sql}（用户手写的原生 SQL，保留以便再编辑/再翻译）。
 */
@Entity
@Table(name = "iqd_sql_pair")
public class IqdSqlPair {

    @Id
    private Long id;

    @Column(name = "connection_id", nullable = false)
    private Long connectionId;

    @Column(nullable = false)
    private String question;

    /** 转化后、可编辑、最终入库并推 WrenAI 的方言 SQL（原 sql_text 改名，v1.10）。 */
    @Column(name = "wren_sql", nullable = false)
    private String wrenSql;

    /** 用户所选关系库类型：oracle | mysql | postgres | clickhouse（v1.10）。 */
    @Column(name = "source_dialect")
    private String sourceDialect;

    /** 用户手写的原生 SQL（源方言）；保留以便再编辑/再翻译（v1.10）。 */
    @Column(name = "native_sql", columnDefinition = "text")
    private String nativeSql;

    @Column
    private String remark;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(nullable = false)
    private Integer enabled = 1;

    @Column(name = "wren_ref_id")
    private String wrenRefId;

    @Column(name = "sync_status", nullable = false)
    private String syncStatus = "pending";

    @Column(name = "synced_at")
    private Instant syncedAt;

    @Column(name = "created_by")
    private Long createdBy;

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

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
    }

    public String getWrenSql() {
        return wrenSql;
    }

    public void setWrenSql(String wrenSql) {
        this.wrenSql = wrenSql;
    }

    public String getSourceDialect() {
        return sourceDialect;
    }

    public void setSourceDialect(String sourceDialect) {
        this.sourceDialect = sourceDialect;
    }

    public String getNativeSql() {
        return nativeSql;
    }

    public void setNativeSql(String nativeSql) {
        this.nativeSql = nativeSql;
    }

    public String getRemark() {
        return remark;
    }

    public void setRemark(String remark) {
        this.remark = remark;
    }

    public Integer getEnabled() {
        return enabled;
    }

    public void setEnabled(Integer enabled) {
        this.enabled = enabled;
    }

    public String getWrenRefId() {
        return wrenRefId;
    }

    public void setWrenRefId(String wrenRefId) {
        this.wrenRefId = wrenRefId;
    }

    public String getSyncStatus() {
        return syncStatus;
    }

    public void setSyncStatus(String syncStatus) {
        this.syncStatus = syncStatus;
    }

    public Instant getSyncedAt() {
        return syncedAt;
    }

    public void setSyncedAt(Instant syncedAt) {
        this.syncedAt = syncedAt;
    }

    public Long getCreatedBy() {
        return createdBy;
    }

    public void setCreatedBy(Long createdBy) {
        this.createdBy = createdBy;
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
