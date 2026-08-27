package com.mis.kb.api.dto;

import java.util.List;

/**
 * 文档切片单项（「查看文档切分效果」卡片）。
 *
 * <p>{@code seq} 为全局连续序号（{@code (page-1)*pageSize + i + 1}，跨页连续）；
 * {@code content} 为清洗后纯文本（引擎 HTML/高亮已剥离，前端直接渲染）；
 * {@code pageNo} 为切片所在页码（引擎 {@code positions} 推导，可能为 {@code null}）；
 * {@code characterCount} 为清洗后正文字符数；
 * {@code importantKeywords} 为引擎 {@code important_keywords} 透传（可空，空列表由
 * 展示层兜底为「—」）；
 * {@code imageId} 为引擎 {@code image_id}（无图为 {@code null}；前端经代理端点取图）。
 *
 * @param seq               全局连续序号（从 1 开始）
 * @param content           清洗后纯文本（恒非 {@code null}，可能为空串）
 * @param pageNo            切片所在页码；引擎未提供时为 {@code null}
 * @param characterCount    清洗后正文字符数（≥0）
 * @param importantKeywords 重要关键词；引擎未提供时为 {@code null}
 * @param imageId           分片关联图片 id；无图时为 {@code null}
 */
public record KbDocumentChunkVO(
        long seq,
        String content,
        Integer pageNo,
        int characterCount,
        List<String> importantKeywords,
        String imageId) {
}
