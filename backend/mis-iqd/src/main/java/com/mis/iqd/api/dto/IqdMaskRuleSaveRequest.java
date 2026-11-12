package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 脱敏规则保存请求（POST /api/v1/iqd/mask/rules；snake_case wire）。
 *
 * @param name        规则名（唯一）
 * @param matchType   column_name | regex | semantic_tag
 * @param pattern     列名/正则/语义标签匹配模式
 * @param rule        phone | idcard | email | amount | full | custom
 * @param replacement custom 规则的自定义替换模板（可空）
 * @param priority    优先级（小者优先）
 * @param enabled     是否启用
 */
public record IqdMaskRuleSaveRequest(
        String name,
        @JsonProperty("match_type") String matchType,
        String pattern,
        String rule,
        String replacement,
        Integer priority,
        Boolean enabled) {
}
