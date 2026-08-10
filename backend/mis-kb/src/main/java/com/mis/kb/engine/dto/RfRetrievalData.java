package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * RAGFlow retrieval 响应 {@code data}（实测 10.254.16.6:9380）。
 *
 * <p><b>结构铁律：{@code data} 是对象，不是数组！</b>实测响应形如
 * {@code {"chunks":[...],"doc_aggs":[...],"total":N}}。旧实现把 {@code data} 直接声明为
 * {@code List<RfChunk>}，Jackson 反序列化时把对象当数组解析直接抛异常——
 * 这正是「检索结果一直为空/异常」的另一半根因（请求体格式是另一半）。
 *
 * @param chunks  命中片段列表（核心字段，适配器只消费它）
 * @param docAggs 按文档聚合统计（{@code doc_name}/{@code doc_id}/{@code count}），
 *                MIS 当前不消费，仅保留以兼容未知字段
 * @param total   命中总数（分页前）
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfRetrievalData(
        @JsonProperty("chunks") List<RfChunk> chunks,
        @JsonProperty("doc_aggs") List<RfDocAgg> docAggs,
        @JsonProperty("total") Integer total) {

    /** 空安全取 chunks。 */
    public List<RfChunk> chunksOrEmpty() {
        return chunks == null ? List.of() : chunks;
    }
}
