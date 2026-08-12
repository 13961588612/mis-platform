package com.mis.kb.engine.dto;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * RAGFlow {@code /datasets/{id}/search} chunk 正文剥离测试（Wave B GraphRAG PoC，R3 验收）。
 *
 * <p><b>T00 G7 实测契约：</b>图谱增强检索的 chunk 正文是 {@code content_with_weight}，
 * 引擎会在正文里插入 {@code <weight ...>} / {@code <sep ...>} 加权排版标记，
 * 直接透传给用户会造成「正文带尖括号标签」的展示事故。{@link RfSearchChunk#text()}
 * 必须在展示前把全部标记剥离。
 *
 * <p><b>R3 风险防线（设计 §4.2）：</b>覆盖多标记、嵌套标记、自闭合变体、纯标记串、
 * null 入参五类边界；嵌套场景（{@code <weight 0.8><weight 0.9>xxx</weight></weight>}）
 * 由非贪婪 + 迭代剥离保证全部清除，只匹配标签本身、绝不误删标签间正文。
 */
class RfSearchChunkTest {

    @Test
    @DisplayName("单标记：<weight 0.95>正文</weight> → 正文")
    void stripsSingleWeightTag() {
        RfSearchChunk chunk = new RfSearchChunk(
                "<weight 0.95>年终奖按十二薪发放</weight>", "probe.txt",
                "doc-1", "kb-1", 0.92D);
        assertEquals("年终奖按十二薪发放", chunk.text());
    }

    @Test
    @DisplayName("多标记：weight + sep 混合出现全部剥离")
    void stripsMultipleMixedTags() {
        RfSearchChunk chunk = new RfSearchChunk(
                "<weight 0.9>甲</weight><sep>、</sep><weight 0.8>乙</weight><sep>、</sep><weight 0.7>丙</weight>",
                "probe.txt", "doc-1", "kb-1", 0.9D);
        assertEquals("甲、乙、丙", chunk.text());
    }

    @Test
    @DisplayName("嵌套标记：<weight 0.8><weight 0.9>xxx</weight></weight> → xxx（R3 关键用例）")
    void stripsNestedTags() {
        RfSearchChunk chunk = new RfSearchChunk(
                "<weight 0.8><weight 0.9>五险一金缴纳基数</weight></weight>",
                "probe.txt", "doc-1", "kb-1", 0.9D);
        assertEquals("五险一金缴纳基数", chunk.text());
    }

    @Test
    @DisplayName("自闭合/无属性变体：<weight>、<sep/>、<weight 0.5/> 全部剥离")
    void stripsSelfClosingAndBareVariants() {
        RfSearchChunk chunk = new RfSearchChunk(
                "<weight>裸标签</weight><sep/>、<weight 0.5/>末尾",
                "probe.txt", "doc-1", "kb-1", 0.9D);
        assertEquals("裸标签、末尾", chunk.text());
    }

    @Test
    @DisplayName("纯标记串（无正文）→ 空串，不留尖括号残留")
    void pureTagStringBecomesEmpty() {
        RfSearchChunk chunk = new RfSearchChunk(
                "<weight 0.95></weight><sep> </sep>", "probe.txt", "doc-1", "kb-1", 0.9D);
        assertEquals("", chunk.text());
    }

    @Test
    @DisplayName("标记间换行/多空白归一为单空格，保持可读")
    void collapsesExcessWhitespace() {
        RfSearchChunk chunk = new RfSearchChunk(
                "甲</weight>   <weight 0.8>乙", "probe.txt", "doc-1", "kb-1", 0.9D);
        assertEquals("甲 乙", chunk.text());
    }

    @Test
    @DisplayName("无标记正文原样返回（trim 前后空白）")
    void plainTextUnchanged() {
        RfSearchChunk chunk = new RfSearchChunk(
                "  正常正文内容  ", "probe.txt", "doc-1", "kb-1", 0.9D);
        assertEquals("正常正文内容", chunk.text());
    }

    @Test
    @DisplayName("null 正文 → 空串（防 NPE）；5 参兼容构造 chunkId 为 null")
    void nullContentIsEmpty() {
        RfSearchChunk chunk = new RfSearchChunk(
                (String) null, "probe.txt", "doc-1", "kb-1", 0.9D);
        assertEquals("", chunk.text());
        assertNull(chunk.chunkId());
    }

    @Test
    @DisplayName("字段映射：@JsonProperty 与 T00 G7 实测字段名一一对应")
    void jsonPropertyMapping() throws Exception {
        String json = "{\"chunk_id\":\"chunk-9\",\"content_with_weight\":\"<weight 0.9>正文</weight>\","
                + "\"docnm_kwd\":\"员工手册.pdf\",\"doc_id\":\"doc-1\",\"kb_id\":\"kb-1\","
                + "\"similarity\":0.88}";
        RfSearchChunk chunk = new com.fasterxml.jackson.databind.ObjectMapper()
                .readValue(json, RfSearchChunk.class);
        assertEquals("chunk-9", chunk.chunkId());
        assertEquals("正文", chunk.text());
        assertEquals("员工手册.pdf", chunk.docnmKwd());
        assertEquals("doc-1", chunk.docId());
        assertEquals("kb-1", chunk.kbId());
        assertEquals(0.88D, chunk.similarity(), 1e-9);
    }
}
