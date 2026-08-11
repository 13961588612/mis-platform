package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * RAGFlow dataset（知识库）响应体。
 *
 * <p>同时用于 {@code POST /api/v1/datasets}（创建）与
 * {@code GET /api/v1/datasets?page=&page_size=}（列举，T02 对账用）。
 *
 * <p>{@code @JsonIgnoreProperties(ignoreUnknown = true)} 是必须的：不同 RAGFlow 版本
 * 的 dataset 对象字段数差异很大（embedding_model / parser_config / permission / avatar…），
 * 不加会在列举时因为未知字段直接反序列化失败——那会让整个对账任务挂掉。
 *
 * @param id            原生 dataset id
 * @param name          dataset 名
 * @param documentCount 文档数（列举接口才有，创建响应里通常缺省）
 * @param chunkCount    chunk 数（同上）
 * @param updateTime    最近更新时间戳，毫秒（RAGFlow 用 {@code update_time}）
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfDataset(
        @JsonProperty("id") String id,
        @JsonProperty("name") String name,
        @JsonProperty("document_count") Integer documentCount,
        @JsonProperty("chunk_count") Integer chunkCount,
        @JsonProperty("update_time") Long updateTime) {

    /**
     * 便捷构造（只关心 id/name 的场景，如创建响应）。
     *
     * @param id   原生 dataset id
     * @param name dataset 名
     * @return 其余字段为 {@code null} 的实例
     */
    public static RfDataset of(String id, String name) {
        return new RfDataset(id, name, null, null, null);
    }
}
