package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** RAGFlow dataset（知识库）创建响应 data。 */
public record RfDataset(
        @JsonProperty("id") String id,
        @JsonProperty("name") String name) {
}
