package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 问数样本对保存请求（POST /api/v1/iqd/sql-pairs；snake_case wire）。
 *
 * <p>v1.10（§4.2.3）：原 {@code sql_text} 改名为 {@code wren_sql}（WrenAI 方言）；
 * 新增 {@code source_dialect}（关系库类型）与 {@code native_sql}（原生 SQL）。
 *
 * @param connectionId 问数连接 id
 * @param question     问题原文（few-shot）
 * @param sourceDialect 关系库类型：oracle | mysql | postgres | clickhouse
 * @param nativeSql    原生 SQL（源方言）
 * @param wrenSql      转化后/可手改的 WrenAI 方言 SQL（= 最终入库并推 WrenAI）
 * @param remark       备注（可空）
 * @param enabled      是否启用（缺省 true；Boolean，与 BFF/前端及兄弟 DTO 对齐，避免 mis-iqd 反序列化 Boolean→Integer 失败）
 * @param id           样本对 id（编辑时透传；为空表示新增，按 连接+question+wren_sql 去重新建）
 */
public record IqdSqlPairSaveRequest(
        @JsonProperty("connection_id") Long connectionId,
        String question,
        @JsonProperty("source_dialect") String sourceDialect,
        @JsonProperty("native_sql") String nativeSql,
        @JsonProperty("wren_sql") String wrenSql,
        String remark,
        Boolean enabled,
        @JsonProperty("id") Long id) {
}
