package com.mis.kb.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * 问答引用（kb_qa_citation）。仅存 MIS 业务 ID（library_id/document_id）。
 */
@Entity
@Table(name = "kb_qa_citation")
public class KbQaCitation {

    @Id
    private Long id;

    @Column(name = "message_id", nullable = false)
    private Long messageId;

    @Column(name = "library_id", nullable = false)
    private Long libraryId;

    @Column(name = "document_id", nullable = false)
    private Long documentId;

    @Column(name = "chunk_text")
    private String chunkText;

    @Column
    private Double score;

    /**
     * 片段字符偏移。
     *
     * <p>列名为 {@code chunk_offset} 而非 {@code offset}：{@code OFFSET} 是 SQL 保留字，
     * 直接用会导致 Hibernate 生成的 SQL 需要引号包裹，跨方言易翻车。对外 JSON 字段名仍为 {@code offset}。
     */
    @Column(name = "chunk_offset")
    private Integer chunkOffset;

    /** 片段所在页码（从 1 开始）；列名 {@code page_no}，对外 JSON 字段名 {@code page}。 */
    @Column(name = "page_no")
    private Integer pageNo;

    /** 来源标识（文档标题/文件名/外部 URL）。 */
    @Column(name = "source", length = 256)
    private String source;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getMessageId() {
        return messageId;
    }

    public void setMessageId(Long messageId) {
        this.messageId = messageId;
    }

    public Long getLibraryId() {
        return libraryId;
    }

    public void setLibraryId(Long libraryId) {
        this.libraryId = libraryId;
    }

    public Long getDocumentId() {
        return documentId;
    }

    public void setDocumentId(Long documentId) {
        this.documentId = documentId;
    }

    public String getChunkText() {
        return chunkText;
    }

    public void setChunkText(String chunkText) {
        this.chunkText = chunkText;
    }

    public Double getScore() {
        return score;
    }

    public void setScore(Double score) {
        this.score = score;
    }

    public Integer getChunkOffset() {
        return chunkOffset;
    }

    public void setChunkOffset(Integer chunkOffset) {
        this.chunkOffset = chunkOffset;
    }

    public Integer getPageNo() {
        return pageNo;
    }

    public void setPageNo(Integer pageNo) {
        this.pageNo = pageNo;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
