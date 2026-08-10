package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/** RAGFlow 文档列表 {@code data}：{@code {docs, total}}。 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfDocumentPage(
        @JsonProperty("docs") List<RfDocument> docs,
        @JsonProperty("total") Integer total) {
}
