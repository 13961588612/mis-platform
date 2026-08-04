package com.mis.adminbff.dto.kb;

/**
 * 命中测试单条命中（BFF 侧镜像，字段与 mis-kb {@code ChunkHitVO} 一一对齐）。
 *
 * <p>不复用 {@link KbQaCitationVO}：那是「已落库的问答引用」，带 {@code id} 且语义上
 * 对应一条持久化记录；命中测试的结果<b>不落库</b>，硬套过去会诱导后续实现者去找那个
 * 并不存在的 id。字段相近但语义不同，宁可多一个 record。
 *
 * @param libraryId  知识库 id
 * @param documentId 文档 id；引擎未能反查到时为 null
 * @param chunkText  片段原文
 * @param score      相似度得分
 * @param docTitle   来源文档标题
 * @param offset     片段字符偏移；可空
 * @param page       页码（从 1 开始）；可空
 */
public record KbHitTestHitVO(
        Long libraryId,
        Long documentId,
        String chunkText,
        Double score,
        String docTitle,
        Integer offset,
        Integer page) {
}
