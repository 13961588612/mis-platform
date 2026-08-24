package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 问数样本对保存请求（BFF → mis-iqd /sql-pairs；snake_case wire）。
 *
 * @param connectionId 问数连接 id
 * @param question     问题原文（few-shot）
 * @param sqlText      对应 SQL
 * @param remark       备注（可空）
 * @param enabled      是否启用（缺省 true）
 */
public record IqdSqlPairSaveRequest(
        @JsonProperty("connection_id") Long connectionId,
        String question,
        @JsonProperty("sql_text") String sqlText,
        String remark,
        Boolean enabled) {
}
