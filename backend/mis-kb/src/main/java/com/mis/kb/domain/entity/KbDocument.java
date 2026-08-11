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

    /** 解析进度百分比 0~100（V30；null=未解析/未知）。 */
    @Column(name = "parse_progress")
    private Integer parseProgress;

    /** 最近一次解析失败原因（V30；引擎 progress_msg 摘要 ≤500 字符，成功/重试时清空）。 */
    @Column(name = "parse_error")
    private String parseError;

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
