package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * RAGFlow 模型列表原生项（T00 实测固化：{@code GET /api/v1/models}）。
 *
 * <p>实测字段：{@code name} / {@code model_type}(数组) / {@code provider_name} /
 * {@code instance_name} / {@code provider_id} / {@code instance_id}。
 * 本实例<b>不提供</b> {@code dimension} / {@code language}（列表接口无此字段）。
 *
 * <p>仅 mis-kb 内部适配层使用；浏览器/BFF 禁止感知此结构（设计 §7.6 密钥与原生字段隔离）。
 *
 * @param name         模型名（如 {@code text-embedding-v3}）
 * @param modelType    分类码值数组（如 {@code ["embedding"]} / {@code ["rerank"]}）
 * @param providerName 提供方名（如 {@code Tongyi-Qianwen}）
 * @param instanceName 实例名（如 {@code Tongyi-Qianwen}）
 * @param providerId   提供方内部 id（仅透传，不用于展示）
 * @param instanceId   实例内部 id（仅透传，不用于展示）
 */
public record RfModel(
        @JsonProperty("name") String name,
        @JsonProperty("model_type") List<String> modelType,
        @JsonProperty("provider_name") String providerName,
        @JsonProperty("instance_name") String instanceName,
        @JsonProperty("provider_id") String providerId,
        @JsonProperty("instance_id") String instanceId) {

    /**
     * 是否为 embedding 模型（T00 实测分类码值）。
     *
     * @return {@code model_type} 含 {@code embedding} 返回 {@code true}
     */
    public boolean isEmbedding() {
        return modelType != null && modelType.contains("embedding");
    }

    /**
     * 是否为 rerank 模型（T00 实测分类码值）。
     *
     * @return {@code model_type} 含 {@code rerank} 返回 {@code true}
     */
    public boolean isRerank() {
        return modelType != null && modelType.contains("rerank");
    }
}
