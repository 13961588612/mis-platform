package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * RAGFlow retrieval 响应 {@code doc_aggs} 单项（按文档聚合统计）。
 *
 * <p>实测（10.254.16.6:9380）字段为 {@code doc_name}/{@code doc_id}/{@code count}。
 * MIS 当前不消费该结构，仅用于正确反序列化 {@link RfRetrievalData} 的未知字段。
 *
 * @param docId   原生文档 id
 * @param docName 文档名
 * @param count   命中片段数
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfDocAgg(
        @JsonProperty("doc_id") String docId,
        @JsonProperty("doc_name") String docName,
        @JsonProperty("count") Integer count) {
}
