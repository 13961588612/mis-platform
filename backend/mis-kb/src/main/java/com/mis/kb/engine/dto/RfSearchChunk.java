package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.regex.Pattern;

/**
 * RAGFlow {@code /datasets/{id}/search}（单库图谱增强检索）返回的 chunk 单项。
 *
 * <p><b>T00 G7 实测契约（设计 §1.1 / §2.4）：</b>与经典 {@code /api/v1/retrieval}
 * 的 chunk 字段<b>完全不同</b>：
 * <table border="1">
 *   <caption>/datasets/search chunk 字段 vs /retrieval chunk 字段</caption>
 *   <tr><th>含义</th><th>/datasets/search（本 DTO）</th><th>/retrieval（{@link RfChunk}）</th></tr>
 *   <tr><td>正文</td><td>{@code content_with_weight}（含 {@code <weight>} 标记，需剥离）</td><td>{@code content}</td></tr>
 *   <tr><td>文档名</td><td>{@code docnm_kwd}</td><td>{@code document_keyword}</td></tr>
 *   <tr><td>文档 id</td><td>{@code doc_id}</td><td>{@code document_id}</td></tr>
 *   <tr><td>分数</td><td>{@code similarity}</td><td>{@code similarity}</td></tr>
 *   <tr><td>库 id</td><td>{@code kb_id}</td><td>—</td></tr>
 *   <tr><td>chunk id</td><td>{@code chunk_id}</td><td>—</td></tr>
 * </table>
 *
 * <p><b>剥离 {@code <weight>} 标记（R3 风险防线）：</b>{@link #text()} 用正则
 * {@code <(?:weight|sep)[^>]*>} 把引擎注入的权重/分隔标记替换为空串——该标记是 RAGFlow
 * 图谱检索时在正文里插入的加权排版信息，直接透传给用户会造成「正文带尖括号标签」的展示事故。
 * 单测锁定多标记与嵌套边界用例（R3 验收映射）。
 *
 * <p>适配器负责将 {@code doc_id} / {@code kb_id}（原生）→ MIS documentId/libraryId，
 * 绝不直接透传给上层。
 *
 * @param chunkId            引擎原生 chunk id
 * @param contentWithWeight  正文（含 {@code <weight>} 标记；展示前用 {@link #text()} 剥离）
 * @param docnmKwd           文档名（引擎已给，优先用于 {@code ChunkHit.docTitle}）
 * @param docId              原生文档 id
 * @param kbId               原生 dataset id
 * @param similarity         综合相似度
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfSearchChunk(
        @JsonProperty("chunk_id") String chunkId,
        @JsonProperty("content_with_weight") String contentWithWeight,
        @JsonProperty("docnm_kwd") String docnmKwd,
        @JsonProperty("doc_id") String docId,
        @JsonProperty("kb_id") String kbId,
        @JsonProperty("similarity") Double similarity) {

    /** 兼容仅有基础五字段的构造（单测/Mock 使用，chunkId 置 null）。 */
    public RfSearchChunk(
            String contentWithWeight, String docnmKwd, String docId, String kbId, Double similarity) {
        this(null, contentWithWeight, docnmKwd, docId, kbId, similarity);
    }

    /**
     * RAGFlow 注入的权重/分隔标记正则：{@code <weight ...>} / {@code </weight>} / {@code <sep>} / 自闭合变体。
     *
     * <p>引擎插入形如 {@code <weight 0.95>text</weight>} 的标记；嵌套/多标记场景
     * （如 {@code <weight 0.8><weight 0.9>xxx</weight></weight>}）由非贪婪 + 迭代剥离保证
     * 全部清除。注意只匹配标签本身，不匹配标签间正文。
     *
     * <p><b>为什么是 {@code </?(?:weight|sep)[^>]*>}：</b>{@code </?>} 的 {@code /?} 吸收闭标签
     * 的斜杠（{@code </weight>} 在 {@code <} 后紧跟 {@code /}，若不加 {@code /?}，交替组
     * {@code (?:weight|sep)} 无法命中，闭标签会残留成「正文带尖括号」事故）；
     * {@code [^>]*} 吸收自闭合斜杠与属性（{@code <sep/>}、{@code <weight 0.95>}）。三类形态
     * （开/闭/自闭合）一个模式全覆盖。
     */
    private static final Pattern WEIGHT_TAG_PATTERN =
            Pattern.compile("</?(?:weight|sep)[^>]*>");

    /**
     * 剥离 {@code <weight>}/{@code <sep>} 标记后的纯正文（R3 契约锁定）。
     *
     * @return 去除全部标记后的文本；原值为 {@code null} 时返回空串
     */
    public String text() {
        if (contentWithWeight == null || contentWithWeight.isBlank()) {
            return "";
        }
        String cleaned = WEIGHT_TAG_PATTERN.matcher(contentWithWeight).replaceAll("");
        // 标记间可能残留多余空白（如 </weight> <weight> 换行），归一为单个空格保持可读
        return cleaned.replaceAll("\\s{2,}", " ").trim();
    }
}
