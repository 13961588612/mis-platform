package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * RAGFlow 文档切片分页响应 {@code data}：{@code {chunks, doc, total}}。
 *
 * <p>现网探测结论：{@code total} 为关键字过滤后的总条数；{@code doc} 为文档级摘要
 * （含 {@code parser_config}）；{@code chunks} 为当前页切片。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfDocumentChunkPage(
        @JsonProperty("chunks") List<RfDocumentChunk> chunks,
        @JsonProperty("doc") RfDocumentChunkDoc doc,
        @JsonProperty("total") Integer total) {
}
