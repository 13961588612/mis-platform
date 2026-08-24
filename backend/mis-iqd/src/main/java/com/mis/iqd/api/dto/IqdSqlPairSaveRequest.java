package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 问数样本对保存请求（POST /api/v1/iqd/sql-pairs；snake_case wire）。
 *
 * @param connectionId 问数连接 id
 * @param question     问题原文（few-shot）
 * @param sqlText      对应 SQL（标准写法，可含占位参数）
 * @param remark       备注（可空）
 * @param enabled      是否启用（缺省 1）
 */
public record IqdSqlPairSaveRequest(
        @JsonProperty("connection_id") Long connectionId,
        String question,
        @JsonProperty("sql_text") String sqlText,
        String remark,
        Integer enabled) {
}
