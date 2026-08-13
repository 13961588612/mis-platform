package com.mis.kb.domain.model;

import java.util.List;

/**
 * 文档切片单项（领域视图，引擎层返回的原始切片的 MIS 侧投影）。
 *
 * <p>仅携带 MIS 业务 id（documentId），引擎原生 chunk id 在适配层闭环，绝不下发。
 * {@code content} 为清洗后的纯文本（已剥离 {@code <em>}/{@code <weight>}/{@code <sep>}/
 * 残留 HTML 标签，杜绝 XSS）；{@code pageNo} 为切片所在页码（由引擎
 * {@code positions} 首元素推导），引擎未提供时为 {@code null}。
 * {@code importantKeywords} 为引擎 {@code important_keywords} 透传（可空，
 * 展示层对空列表兜底为「—」）。
 *
 * @param documentId       MIS 文档 id
 * @param content          清洗后纯文本（恒非 {@code null}，可能为空串）
 * @param pageNo           切片所在页码（从 1 开始）；引擎未提供时为 {@code null}
 * @param importantKeywords 重要关键词；引擎未提供时为 {@code null}
 */
public record DocumentChunkView(
        Long documentId,
        String content,
        Integer pageNo,
        List<String> importantKeywords) {
}
