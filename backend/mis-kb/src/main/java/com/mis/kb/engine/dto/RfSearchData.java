package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * RAGFlow {@code /datasets/{id}/search}（单库图谱增强检索）响应 {@code data}。
 *
 * <p><b>T00 G7 实测契约（设计 §2.4）：</b>与经典 {@code /api/v1/retrieval} 相同，
 * {@code data} 是对象 {@code {chunks:[...], total:N}}，不是数组——
 * chunks 每项是 {@link RfSearchChunk}（字段名与 {@code /retrieval} 完全不同）。
 *
 * @param chunks 命中片段列表（核心字段，适配器只消费它）
 * @param total  命中总数（{@code = len(chunks)}，分页前）
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfSearchData(
        @JsonProperty("chunks") List<RfSearchChunk> chunks,
        @JsonProperty("total") Integer total) {

    /** 空安全取 chunks。 */
    public List<RfSearchChunk> chunksOrEmpty() {
        return chunks == null ? List.of() : chunks;
    }
}
