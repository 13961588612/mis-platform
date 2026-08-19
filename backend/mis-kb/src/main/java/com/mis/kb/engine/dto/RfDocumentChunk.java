package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * RAGFlow {@code GET /datasets/{dataset_id}/documents/{document_id}/chunks} 返回的 chunk 单项。
 *
 * <p><b>现网探测结论：</b>chunk 级无 {@code token_count}（doc 级才有）；{@code content}
 * 含 {@code <em>xxx</em>} 高亮与 {@code <table>} HTML 包裝（展示前必须清洗，杜绝 XSS，
 * 见 {@link com.mis.kb.engine.RagflowAdapter#cleanContent}）；{@code important_keywords}
 * 恒为空数组；{@code positions} 形如 {@code [[1,0,0,0,0]]}，每行首元素即页码
 * （见 {@link #pageNo()}）；{@code image_id} 非空时表示分片关联了版面截图
 * （取图走 {@code GET /v1/document/image/{image_id}}）。
 *
 * @param id                引擎原生 chunk id
 * @param content           正文（含 {@code <em>} 高亮 / 残留 HTML 标签，展示前需清洗）
 * @param documentId        原生文档 id
 * @param importantKeywords 重要关键词（auto_keywords=0 时为空数组；可空）
 * @param positions         位置数组（每行首元素 = 页码，从 1 开始）
 * @param imageId           分片关联图片 id（空串 = 无图）；形如 {@code {datasetId}-{objectId}}
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfDocumentChunk(
        @JsonProperty("id") String id,
        @JsonProperty("content") String content,
        @JsonProperty("document_id") String documentId,
        @JsonProperty("important_keywords") List<String> importantKeywords,
        @JsonProperty("positions") List<List<Integer>> positions,
        @JsonProperty("image_id") String imageId) {

    /**
     * 提取切片所在页码：{@code positions} 首行首元素即页码（现网探测结论）。
     *
     * @return 页码（从 1 开始）；positions 缺失/为空/首元素非正数时返回 {@code null}
     */
    public Integer pageNo() {
        if (positions == null || positions.isEmpty()) {
            return null;
        }
        List<Integer> first = positions.get(0);
        if (first == null || first.isEmpty()) {
            return null;
        }
        Integer p = first.get(0);
        return (p == null || p <= 0) ? null : p;
    }

    /** 空串 / 空白 {@code image_id} 归一为 {@code null}。 */
    public String normalizedImageId() {
        if (imageId == null || imageId.isBlank()) {
            return null;
        }
        return imageId.trim();
    }
}
