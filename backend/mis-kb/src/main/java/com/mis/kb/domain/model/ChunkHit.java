package com.mis.kb.domain.model;

/**
 * 统一检索命中片段（对外只携带 MIS 业务 ID，绝不暴露引擎原生 id）。
 *
 * <p>F-04 溯源增强：新增 {@code offset}（片段在原文中的字符偏移）与 {@code page}（页码，从 1 开始）。
 * 二者均可能为 {@code null}——并非所有引擎/文档类型都能给出位置信息（如纯文本无页码），
 * 前端需按「有则展示、无则降级」处理。
 *
 * @param libraryId  MIS 知识库 id
 * @param documentId MIS 文档 id
 * @param chunkText  片段文本
 * @param score      相似度得分
 * @param docTitle   文档标题
 * @param offset     片段在原文中的字符偏移；引擎未提供时为 {@code null}
 * @param page       片段所在页码（从 1 开始）；引擎未提供时为 {@code null}
 * @param imageId    分片关联图片 id（引擎 {@code image_id}）；无图时为 {@code null}
 */
public record ChunkHit(
        Long libraryId,
        Long documentId,
        String chunkText,
        Double score,
        String docTitle,
        Integer offset,
        Integer page,
        String imageId) {

    /**
     * 兼容旧调用的便捷构造器（无位置信息）。
     *
     * <p>保留它是为了让尚未接入位置信息的适配器（如 {@code NoopAdapter}）无需改动，
     * 位置字段一律置 {@code null}。
     */
    public ChunkHit(Long libraryId, Long documentId, String chunkText, Double score, String docTitle) {
        this(libraryId, documentId, chunkText, score, docTitle, null, null, null);
    }
}
