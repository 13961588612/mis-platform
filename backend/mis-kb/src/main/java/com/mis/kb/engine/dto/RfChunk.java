package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * RAGFlow retrieval 返回的 chunk 单项（原生结构）。
 *
 * <p><b>B3 实测校正（2026-08-12，10.254.16.6:9380）：</b>retrieval 响应的 chunk 字段名
 * 与旧 DTO 假设<b>不一致</b>，旧 DTO 会把关键字段全解成 {@code null}：
 * <table border="1">
 *   <caption>旧 DTO 字段 vs 实测响应字段</caption>
 *   <tr><th>旧 DTO</th><th>实测响应</th><th>说明</th></tr>
 *   <tr><td>{@code text}</td><td>{@code content}</td><td>片段正文</td></tr>
 *   <tr><td>{@code score}</td><td>{@code similarity}</td><td>综合相似度（含重排后）</td></tr>
 *   <tr><td>{@code document_name}</td><td>{@code document_keyword}</td><td>该版本把文档名放在 keyword 字段</td></tr>
 *   <tr><td>{@code page_num_int}</td><td>{@code positions[][0]}</td><td>页码在 positions 每行首元素</td></tr>
 * </table>
 * {@code document_id} 与 {@code positions} 两字段名与旧 DTO 一致，未变化。
 *
 * <p>适配器负责将 {@code document_id}（原生）→ MIS documentId，绝不直接透传给上层。
 *
 * <p>F-04 溯源：{@code positions}（位置数组）并非必返，定义为可空集合，
 * 由 {@link com.mis.kb.engine.RagflowAdapter} 做防御式取值。
 *
 * @param documentId   原生文档 id
 * @param documentName 文档名（实测来自 {@code document_keyword}）
 * @param text         片段正文（实测来自 {@code content}）
 * @param score        综合相似度（实测来自 {@code similarity}）
 * @param positions    位置数组，元素形如 {@code [page, x0, x1, top, bottom]}
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfChunk(
        @JsonProperty("document_id") String documentId,
        @JsonProperty("document_keyword") String documentName,
        @JsonProperty("content") String text,
        @JsonProperty("similarity") Double score,
        @JsonProperty("positions") List<List<Integer>> positions) {

    /** 兼容仅有基础四字段的构造（单测/Mock 使用）。 */
    public RfChunk(String documentId, String documentName, String text, Double score) {
        this(documentId, documentName, text, score, null);
    }

    /**
     * 解析展示页码。
     *
     * <p>retrieval 响应的 {@code positions} 每行首元素即页码（1-based）。
     *
     * @return 首个有效页码；无法解析时返回 {@code null}
     */
    public Integer firstPage() {
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
