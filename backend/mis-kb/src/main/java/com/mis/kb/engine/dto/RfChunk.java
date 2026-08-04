package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * RAGFlow retrieval 返回的 chunk 单项（原生结构）。
 *
 * <p>适配器负责将 {@code document_id}（原生）→ MIS documentId，绝不直接透传给上层。
 *
 * <p>F-04 溯源：额外接收 {@code page_num_int}（页码数组）与 {@code positions}（位置数组）。
 * RAGFlow 对不同解析器返回的结构不完全一致，且这两个字段并非必返，
 * 因此均定义为可空集合，由 {@link com.mis.kb.engine.RagflowAdapter} 做防御式取值。
 *
 * @param documentId   原生文档 id
 * @param documentName 文档名
 * @param text         片段文本
 * @param score        相似度
 * @param pageNums     页码数组（取首个作为展示页码）
 * @param positions    位置数组，元素形如 {@code [page, x0, x1, top, bottom]}
 */
public record RfChunk(
        @JsonProperty("document_id") String documentId,
        @JsonProperty("document_name") String documentName,
        @JsonProperty("text") String text,
        @JsonProperty("score") Double score,
        @JsonProperty("page_num_int") List<Integer> pageNums,
        @JsonProperty("positions") List<List<Integer>> positions) {

    /** 兼容仅有基础四字段的构造（单测/Mock 使用）。 */
    public RfChunk(String documentId, String documentName, String text, Double score) {
        this(documentId, documentName, text, score, null, null);
    }

    /**
     * 解析展示页码。
     *
     * @return 首个有效页码；无法解析时返回 {@code null}
     */
    public Integer firstPage() {
        if (pageNums != null && !pageNums.isEmpty() && pageNums.get(0) != null) {
            return pageNums.get(0);
        }
        if (positions != null && !positions.isEmpty()) {
            List<Integer> first = positions.get(0);
            if (first != null && !first.isEmpty() && first.get(0) != null) {
                return first.get(0);
            }
        }
        return null;
    }

    /**
     * 解析字符偏移。
     *
     * <p>RAGFlow 的 {@code positions} 是版面坐标而非字符偏移，无法直接换算；
     * 当前仅在引擎显式返回时使用，否则返回 {@code null}，不做臆测性推算。
     *
     * @return 字符偏移；不可得时返回 {@code null}
     */
    public Integer charOffset() {
        return null;
    }
}
