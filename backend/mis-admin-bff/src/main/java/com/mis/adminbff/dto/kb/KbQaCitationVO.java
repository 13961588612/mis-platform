package com.mis.adminbff.dto.kb;

/**
 * 问答引用视图（BFF 侧镜像，仅 MIS 业务 ID）。
 *
 * <p>F-04 新增定位信息：{@code offset}（片段在原文的字符起始位置）与
 * {@code page}（PDF 页码，从 1 开始），供前端「跳转到原文位置」。
 * 二者均可空——非 PDF 文档没有页码，老数据没有 offset。
 *
 * @param id         引用 id
 * @param libraryId  知识库 id
 * @param documentId 文档 id
 * @param chunkText  片段文本
 * @param score      相似度得分
 * @param offset     片段在原文中的字符偏移；可空
 * @param page       页码（从 1 开始）；可空
 * @param source     来源文件名/标题；可空
 */
public record KbQaCitationVO(
        Long id,
        Long libraryId,
        Long documentId,
        String chunkText,
        Double score,
        Integer offset,
        Integer page,
        String source) {
}
