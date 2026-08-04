package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 同义词词条（kb_synonym_term，Wave D）。规范词与别名同表。
 *
 * <p><b>{@code termNorm} 上是普通 UNIQUE，不带 status 条件</b>（Q3 裁决：停用仍占用）。
 * 产品理由：避免「停用 A 组 → 词被 B 组抢走 → A 组无法启用」的死结。
 *
 * <p>{@code canonical=1} 的行即本组规范词，随组自动维护；{@code sortNo} 决定预算截断时的
 * 入选优先级（规范词恒为 0，别名从 1 递增）。
 *
 * <p>FK {@code group_id → kb_synonym_group ON DELETE CASCADE}（Q4 硬删）：删组即删词。
 * 这里<b>刻意不建 {@code @ManyToOne} 关联</b>——词典加载走批量 ID 查询，
 * 建关联只会引来 N+1 与 lazy 代理问题，收益为零。
 */
@Entity
@Table(name = "kb_synonym_term")
public class KbSynonymTerm {

    /** 该行为本组规范词。 */
    public static final int CANONICAL_YES = 1;
    /** 该行为别名。 */
    public static final int CANONICAL_NO = 0;
    /** 规范词固定的组内排序号。 */
    public static final int CANONICAL_SORT_NO = 0;

    @Id
    private Long id;

    @Column(name = "group_id", nullable = false)
    private Long groupId;

    @Column(nullable = false, length = 128)
    private String term;

    @Column(name = "term_norm", nullable = false, length = 128)
    private String termNorm;

    @Column(nullable = false)
    private Integer canonical = CANONICAL_NO;

    @Column(name = "sort_no", nullable = false)
    private Integer sortNo = 0;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getGroupId() {
        return groupId;
    }

    public void setGroupId(Long groupId) {
        this.groupId = groupId;
    }

    public String getTerm() {
        return term;
    }

    public void setTerm(String term) {
        this.term = term;
    }

    public String getTermNorm() {
        return termNorm;
    }

    public void setTermNorm(String termNorm) {
        this.termNorm = termNorm;
    }

    public Integer getCanonical() {
        return canonical;
    }

    public void setCanonical(Integer canonical) {
        this.canonical = canonical;
    }

    public Integer getSortNo() {
        return sortNo;
    }

    public void setSortNo(Integer sortNo) {
        this.sortNo = sortNo;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    /**
     * 是否为本组规范词。
     *
     * @return {@code canonical == 1} 返回 {@code true}
     */
    public boolean isCanonical() {
        return canonical != null && canonical == CANONICAL_YES;
    }
}
