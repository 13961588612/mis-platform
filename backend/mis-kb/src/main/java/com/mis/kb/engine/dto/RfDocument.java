package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * RAGFlow document 字段子集（上传响应 / 列表查询共用）。
 *
 * <p>未知字段忽略，避免 RAGFlow 版本字段漂移导致反序列化失败。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfDocument(
        @JsonProperty("id") String id,
        @JsonProperty("name") String name,
        @JsonProperty("run") String run,
        @JsonProperty("progress") Double progress,
        @JsonProperty("progress_msg") String progressMsg,
        @JsonProperty("chunk_count") Integer chunkCount) {

    public RfDocument(String id, String name) {
        this(id, name, null, null, null, null);
    }
}
