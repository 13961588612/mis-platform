package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 同义词批量导入的预检批次（kb_synonym_import_batch，Wave D）。
 *
 * <p><b>预检计划必须落库，不能放内存 Map</b>：预检可能落在实例 A、提交落在实例 B，
 * 内存态在多实例下会「找不到 token」（与 {@code dict_version} 同一个根因，同一个解法）。
 *
 * <p>{@code planJson} 是行级计划全文（含 {@code skipReason}），
 * <b>提交执行 / 下载未导入行 / 回执计数三处共用这一份</b>，因此原始上传文件不必留存。
 *
 * <p>{@code dictVersion} 是提交期版本校验凭据（Q10 硬约束）：提交时若库内当前版本
 * 已不等于此值，抛 {@code KB_SYNONYM_IMPORT_STALE}「词表已变更，请重新预检」，
 * 而不是「静默多跳几行」——预检报告承诺的计数就是这份报告的契约。
 */
@Entity
@Table(name = "kb_synonym_import_batch")
public class KbSynonymImportBatch {

    /** 预检完成、等待提交。 */
    public static final String STATUS_PENDING = "PENDING";
    /** 已提交执行。 */
    public static final String STATUS_COMMITTED = "COMMITTED";
    /** 已过期。 */
    public static final String STATUS_EXPIRED = "EXPIRED";

    /** CSV 格式。 */
    public static final String FORMAT_CSV = "CSV";
    /** JSON 格式。 */
    public static final String FORMAT_JSON = "JSON";

    @Id
    private Long id;

    @Column(nullable = false, length = 64)
    private String token;

    @Column(nullable = false, length = 16)
    private String status = STATUS_PENDING;

    @Column(name = "dict_version", nullable = false)
    private Long dictVersion;

    @Column(name = "file_name", length = 255)
    private String fileName;

    @Column(nullable = false, length = 16)
    private String format;

    /** 行级计划全文；可能到几百 KB，故为 TEXT 而非 VARCHAR(n)。 */
    @Lob
    @Column(name = "plan_json", nullable = false)
    private String planJson;

    @Column(name = "planned_create", nullable = false)
    private Integer plannedCreate = 0;

    @Column(name = "planned_merge", nullable = false)
    private Integer plannedMerge = 0;

    @Column(name = "planned_skip", nullable = false)
    private Integer plannedSkip = 0;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "committed_at")
    private Instant committedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Long getDictVersion() {
        return dictVersion;
    }

    public void setDictVersion(Long dictVersion) {
        this.dictVersion = dictVersion;
    }

    public String getFileName() {
        return fileName;
    }

    public void setFileName(String fileName) {
        this.fileName = fileName;
    }

    public String getFormat() {
        return format;
    }

    public void setFormat(String format) {
        this.format = format;
    }

    public String getPlanJson() {
        return planJson;
    }

    public void setPlanJson(String planJson) {
        this.planJson = planJson;
    }

    public Integer getPlannedCreate() {
        return plannedCreate;
    }

    public void setPlannedCreate(Integer plannedCreate) {
        this.plannedCreate = plannedCreate;
    }

    public Integer getPlannedMerge() {
        return plannedMerge;
    }

    public void setPlannedMerge(Integer plannedMerge) {
        this.plannedMerge = plannedMerge;
    }

    public Integer getPlannedSkip() {
        return plannedSkip;
    }

    public void setPlannedSkip(Integer plannedSkip) {
        this.plannedSkip = plannedSkip;
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

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(Instant expiresAt) {
        this.expiresAt = expiresAt;
    }

    public Instant getCommittedAt() {
        return committedAt;
    }

    public void setCommittedAt(Instant committedAt) {
        this.committedAt = committedAt;
    }

    /**
     * 批次是否仍可提交。
     *
     * @param now 当前时刻
     * @return 状态为 {@code PENDING} 且未过期返回 {@code true}
     */
    public boolean isCommittable(Instant now) {
        return STATUS_PENDING.equals(status)
                && expiresAt != null
                && now != null
                && now.isBefore(expiresAt);
    }
}
