package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** RAGFlow document 上传响应 data 单项。 */
public record RfDocument(
        @JsonProperty("id") String id,
        @JsonProperty("name") String name) {
}
