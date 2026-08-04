package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 同义词术语组（kb_synonym_group，Wave D）。
 *
 * <p>{@code canonicalTerm} <b>不独立唯一</b> —— 唯一性统一由
 * {@link KbSynonymTerm#getTermNorm()} 上的 {@code uk_synonym_term_norm} 承担。
 * 这样「规范词」与「别名」在唯一性上是同一等价类，不会出现「A 组的规范词恰好是 B 组的别名」
 * 这种半冲突状态。
 *
 * <p>{@code status} 1=启用 0=停用。<b>停用只影响是否参与扩展，不释放词条唯一性</b>（Q3 裁决）。
 *
 * <p>主键用 {@code IdGenerator.nextId()}，与既有 {@code kb_*} 实体同口径，不用数据库自增。
 */
@Entity
@Table(name = "kb_synonym_group")
public class KbSynonymGroup {

    /** 启用。 */
    public static final int STATUS_ENABLED = 1;
    /** 停用。 */
    public static final int STATUS_DISABLED = 0;

    @Id
    private Long id;

    @Column(name = "canonical_term", nullable = false, length = 128)
    private String canonicalTerm;

    @Column(nullable = false)
    private Integer status = STATUS_ENABLED;

    @Column(length = 512)
    private String remark;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by")
    private Long updatedBy;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getCanonicalTerm() {
        return canonicalTerm;
    }

    public void setCanonicalTerm(String canonicalTerm) {
        this.canonicalTerm = canonicalTerm;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public String getRemark() {
        return remark;
    }

    public void setRemark(String remark) {
        this.remark = remark;
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

    public Long getUpdatedBy() {
        return updatedBy;
    }

    public void setUpdatedBy(Long updatedBy) {
        this.updatedBy = updatedBy;
    }

    /**
     * 是否为启用状态。
     *
     * @return {@code status == 1} 返回 {@code true}
     */
    public boolean isEnabled() {
        return status != null && status == STATUS_ENABLED;
    }
}
