package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 引擎侧游离 dataset（kb_engine_orphan）。
 *
 * <p>记录「引擎有 / MIS 无」的差异——这类差异在 {@code kb_library} 里<b>无行可落</b>，
 * 故单独建表。由定时对账 {@code KbEngineReconcileService} upsert：
 * {@code firstSeenAt} 首次发现后不再变，{@code lastSeenAt} 每次仍可见时刷新。
 *
 * <p>P0 只做「发现与展示」；{@code resolved} / {@code note} 两列为 P1 的「认领 / 清理」
 * 操作页预留，本期恒为 {@code 0 / null}。
 */
@Entity
@Table(name = "kb_engine_orphan")
public class KbEngineOrphan {

    @Id
    private Long id;

    /** 引擎类型（当前只有 ragflow 会参与对账）。 */
    @Column(name = "engine_type", nullable = false, length = 32)
    private String engineType;

    /** 引擎原生 dataset id（与 engineType 组成唯一键）。 */
    @Column(name = "native_id", nullable = false, length = 64)
    private String nativeId;

    /** 引擎侧 dataset 名快照，每次对账刷新。 */
    @Column(name = "native_name", length = 255)
    private String nativeName;

    /** 引擎侧文档数快照，未知时 {@code null}。 */
    @Column(name = "doc_count")
    private Integer docCount;

    @Column(name = "first_seen_at", nullable = false)
    private Instant firstSeenAt;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;

    /** 0 = 待处理；1 = 已认领 / 已处理（P1 用）。 */
    @Column(name = "resolved", nullable = false)
    private Integer resolved = 0;

    @Column(name = "note", length = 512)
    private String note;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getEngineType() {
        return engineType;
    }

    public void setEngineType(String engineType) {
        this.engineType = engineType;
    }

    public String getNativeId() {
        return nativeId;
    }

    public void setNativeId(String nativeId) {
        this.nativeId = nativeId;
    }

    public String getNativeName() {
        return nativeName;
    }

    public void setNativeName(String nativeName) {
        this.nativeName = nativeName;
    }

    public Integer getDocCount() {
        return docCount;
    }

    public void setDocCount(Integer docCount) {
        this.docCount = docCount;
    }

    public Instant getFirstSeenAt() {
        return firstSeenAt;
    }

    public void setFirstSeenAt(Instant firstSeenAt) {
        this.firstSeenAt = firstSeenAt;
    }

    public Instant getLastSeenAt() {
        return lastSeenAt;
    }

    public void setLastSeenAt(Instant lastSeenAt) {
        this.lastSeenAt = lastSeenAt;
    }

    public Integer getResolved() {
        return resolved;
    }

    public void setResolved(Integer resolved) {
        this.resolved = resolved;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }
}
