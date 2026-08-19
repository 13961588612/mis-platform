package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 知识库文档（kb_document）。
 *
 * <p>{@code engine_document_ref} 为引擎 doc 原生 id；{@code parse_status} 由引擎异步回写。
 *
 * <p><b>V23（kb_settings_model_chunk）新增三列：</b>{@code chunkMethod} / {@code chunkTokenNum} /
 * {@code separator}，均为文件级切片覆盖字段，可空 = 继承库级（方案 B：库级默认 + 文件级覆盖）。
 * 合并语义由 {@code DocumentChunkConfigResolver} 统一收口，本实体只做持久化承载。
 *
 * <p><b>V30（企业级增强一期 KE-03/KE-04）新增两列：</b>{@code parseProgress} / {@code parseError}。
 * {@code parseProgress}（0~100）与 {@code parseError}（引擎 progress_msg 摘要 ≤500 字符）
 * 随既有 {@code syncOpenParseStatuses} 同步批次一并回写；解析成功/重试时清空 error。
 */
@Entity
@Table(name = "kb_document")
public class KbDocument {

    @Id
    private Long id;

    @Column(name = "library_id", nullable = false)
    private Long libraryId;

    @Column(nullable = false)
    private String title;

    @Column(name = "engine_document_ref")
    private String engineDocumentRef;

    @Column(nullable = false)
    private Integer version = 1;

    @Column(name = "parse_status", nullable = false)
    private String parseStatus = "pending";

    @Column(nullable = false)
    private Integer enabled = 1;

    @Column
    private Long size;

    @Column
    private String format;

    /** 文件级切片方法（V23；null = 继承库级）。 */
    @Column(name = "chunk_method")
    private String chunkMethod;

    /** 文件级切片 token 数（V23；null = 继承库级）。 */
    @Column(name = "chunk_token_num")
    private Integer chunkTokenNum;

    /** 文件级切片分隔符（V23；null = 继承库级）。 */
    @Column(name = "separator")
    private String separator;

    /** 文件级页码索引/TOC 提取开关（V62；null = 继承库级；只落库不下发）。 */
    @Column(name = "page_index")
    private Boolean pageIndex;

    /** 文件级图像/表格上下文窗口 token 数（V62；null = 继承库级；只落库不下发）。 */
    @Column(name = "image_table_context_window")
    private Integer imageTableContextWindow;

    /** 文件级自动关键字数量（V62；null = 继承库级；0 = 关闭）。 */
    @Column(name = "auto_keywords")
    private Integer autoKeywords;

    /** 文件级自动问题数量（V62；null = 继承库级；0 = 关闭）。 */
    @Column(name = "auto_questions")
    private Integer autoQuestions;

    /** 解析进度百分比 0~100（V30；null=未解析/未知）。 */
    @Column(name = "parse_progress")
    private Integer parseProgress;

    /** 最近一次解析失败原因（V30；引擎 progress_msg 摘要 ≤500 字符，成功/重试时清空）。 */
    @Column(name = "parse_error")
    private String parseError;

    /**
     * 引擎同步状态（T04 文档级对账）：码值复用 {@link com.mis.kb.domain.model.EngineSyncStatus}
     * （0 未知 / 1 一致 / 2 引擎缺失 / 3 名称漂移或同步失败）。
     *
     * <p>建文档默认 0；由文档级对账服务比对 {@code kb_document.engine_document_ref} 与
     * 引擎 {@code listDocuments} 结果后写入。
     */
    @Column(name = "engine_sync_status", nullable = false)
    private Integer engineSyncStatus = 0;

    /** 最近一次与引擎对账的时刻（T04 文档级对账）。 */
    @Column(name = "engine_checked_at")
    private Instant engineCheckedAt;

    /** 连续被标记 MISSING_IN_ENGINE 的起始时刻（T04 收敛判定用）。 */
    @Column(name = "engine_missing_since")
    private Instant engineMissingSince;

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

    public Long getLibraryId() {
        return libraryId;
    }

    public void setLibraryId(Long libraryId) {
        this.libraryId = libraryId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getEngineDocumentRef() {
        return engineDocumentRef;
    }

    public void setEngineDocumentRef(String engineDocumentRef) {
        this.engineDocumentRef = engineDocumentRef;
    }

    public Integer getVersion() {
        return version;
    }

    public void setVersion(Integer version) {
        this.version = version;
    }

    public String getParseStatus() {
        return parseStatus;
    }

    public void setParseStatus(String parseStatus) {
        this.parseStatus = parseStatus;
    }

    public Integer getEnabled() {
        return enabled;
    }

    public void setEnabled(Integer enabled) {
        this.enabled = enabled;
    }

    public Long getSize() {
        return size;
    }

    public void setSize(Long size) {
        this.size = size;
    }

    public String getFormat() {
        return format;
    }

    public void setFormat(String format) {
        this.format = format;
    }

    public String getChunkMethod() {
        return chunkMethod;
    }

    public void setChunkMethod(String chunkMethod) {
        this.chunkMethod = chunkMethod;
    }

    public Integer getChunkTokenNum() {
        return chunkTokenNum;
    }

    public void setChunkTokenNum(Integer chunkTokenNum) {
        this.chunkTokenNum = chunkTokenNum;
    }

    public String getSeparator() {
        return separator;
    }

    public void setSeparator(String separator) {
        this.separator = separator;
    }

    public Boolean getPageIndex() {
        return pageIndex;
    }

    public void setPageIndex(Boolean pageIndex) {
        this.pageIndex = pageIndex;
    }

    public Integer getImageTableContextWindow() {
        return imageTableContextWindow;
    }

    public void setImageTableContextWindow(Integer imageTableContextWindow) {
        this.imageTableContextWindow = imageTableContextWindow;
    }

    public Integer getAutoKeywords() {
        return autoKeywords;
    }

    public void setAutoKeywords(Integer autoKeywords) {
        this.autoKeywords = autoKeywords;
    }

    public Integer getAutoQuestions() {
        return autoQuestions;
    }

    public void setAutoQuestions(Integer autoQuestions) {
        this.autoQuestions = autoQuestions;
    }

    public Integer getParseProgress() {
        return parseProgress;
    }

    public void setParseProgress(Integer parseProgress) {
        this.parseProgress = parseProgress;
    }

    public String getParseError() {
        return parseError;
    }

    public void setParseError(String parseError) {
        this.parseError = parseError;
    }

    public Integer getEngineSyncStatus() {
        return engineSyncStatus;
    }

    public void setEngineSyncStatus(Integer engineSyncStatus) {
        this.engineSyncStatus = engineSyncStatus;
    }

    public Instant getEngineCheckedAt() {
        return engineCheckedAt;
    }

    public void setEngineCheckedAt(Instant engineCheckedAt) {
        this.engineCheckedAt = engineCheckedAt;
    }

    public Instant getEngineMissingSince() {
        return engineMissingSince;
    }

    public void setEngineMissingSince(Instant engineMissingSince) {
        this.engineMissingSince = engineMissingSince;
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
