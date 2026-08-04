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
