package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 文档切片单项（BFF 侧镜像，与 mis-kb {@code KbDocumentChunkVO} 对齐）。
 *
 * @param seq               全局连续序号（从 1 开始）
 * @param content           清洗后纯文本（引擎 HTML/高亮已剥离，前端直接渲染）
 * @param pageNo            切片所在页码；引擎未提供时为 {@code null}
 * @param characterCount    清洗后正文字符数
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
