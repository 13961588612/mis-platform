package com.mis.kb.engine.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * RAGFlow chunks 响应中的 {@code doc} 对象（文档级摘要）。
 *
 * <p>嵌套解析 {@code parser_config}：引擎侧文档当前生效的切片配置
 * （{@code chunk_method}/{@code chunk_token_num}/{@code delimiter}），
 * 与 MIS 本地 {@code kb_document} 文件级覆盖字段同源不同侧——展示统计以
 * MIS 本地为准（来源判定 {@code FILE_OVERRIDE/LIBRARY}），本 DTO 仅承载
 * 引擎侧事实供对账/审计使用，未知字段忽略（RAGFlow 版本字段漂移防护）。
 *
 * @param id           原生文档 id
 * @param name         文档名
 * @param parserConfig 引擎侧切片配置（可能为 {@code null}）
 * @param chunkCount   切片总数（全量，不受关键字过滤影响）
 * @param tokenCount   文档级 token 数（现网探测：chunk 级无，doc 级有；可空）
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RfDocumentChunkDoc(
        @JsonProperty("id") String id,
        @JsonProperty("name") String name,
        @JsonProperty("parser_config") ParserConfig parserConfig,
        @JsonProperty("chunk_count") Integer chunkCount,
        @JsonProperty("token_count") Integer tokenCount) {

    /**
     * RAGFlow {@code parser_config} 子集（忽略 OCR/overlap/auto_keywords 等其余字段）。
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ParserConfig(
            @JsonProperty("chunk_method") String chunkMethod,
            @JsonProperty("chunk_token_num") Integer chunkTokenNum,
            @JsonProperty("delimiter") String delimiter) {
    }
}
