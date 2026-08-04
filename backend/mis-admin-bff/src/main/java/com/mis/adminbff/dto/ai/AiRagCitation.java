package com.mis.adminbff.dto.ai;

/**
 * RAG 引用来源（{@code data.result.citations} 中的单项）。
 *
 * <p>字段分两组：
 * <ul>
 *   <li><b>通用字段</b>（{@code source}/{@code chunk}/{@code score}）——ai-copilot 通道原有契约，
 *       非 KB 场景的 RAG 仍只填这三项，向后兼容不变。</li>
 *   <li><b>KB 溯源字段</b>（{@code id}/{@code libraryId}/{@code documentId}/{@code chunkText}/
 *       {@code messageId}）——T10 扩展。由 mis-rag 的 KB 问答管线依据检索命中片段补全，
 *       前端 {@code KbQaCitation} 据此跳转文档、回看历史会话。</li>
 * </ul>
 *
 * <p>安全约束：仅承载 MIS 业务 ID，<b>绝不</b>暴露引擎原生标识
 * （{@code engine_library_ref} / {@code engine_document_ref}）。
 */
public class AiRagCitation {

    /** 引用主键（mis-kb {@code kb_qa_citation.id}）；未落库时为 null。 */
    private Long id;

    /** 来源名（如 hr-handbook.pdf）。 */
    private String source;

    /** 片段 / 章节（如 §3.2）。 */
    private String chunk;

    /** 相关性打分（0~1）。 */
    private Double score;

    /** MIS 知识库 ID（{@code kb_library.id}）。 */
    private Long libraryId;

    /** MIS 文档 ID（{@code kb_document.id}）。 */
    private Long documentId;

    /** 引用片段正文（完整文本，{@code chunk} 为其截断摘要）。 */
    private String chunkText;

    /** 所属助手消息 ID（{@code kb_qa_message.id}）；未落库时为 null。 */
    private Long messageId;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public String getChunk() {
        return chunk;
    }

    public void setChunk(String chunk) {
        this.chunk = chunk;
    }

    public Double getScore() {
        return score;
    }

    public void setScore(Double score) {
        this.score = score;
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

    public Long getMessageId() {
        return messageId;
    }

    public void setMessageId(Long messageId) {
        this.messageId = messageId;
    }
}
