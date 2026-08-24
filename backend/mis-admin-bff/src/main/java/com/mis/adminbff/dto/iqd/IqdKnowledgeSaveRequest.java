package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 问数知识/术语/口径保存请求（BFF → mis-iqd /knowledge；snake_case wire）。
 *
 * @param connectionId    问数连接 id
 * @param kind            term | metric_definition | synonym | instruction
 * @param title           标题/术语
 * @param content         内容/口径说明（可空）
 * @param relatedItemKeys 关联清单 item_key 列表（JSON 字符串数组，可空）
 * @param source          来源 local | kb_s07（缺省 local）
 * @param kbTermId        S-07 术语表 id（source=kb_s07 时回填）
 * @param enabled         是否启用（缺省 true）
 */
public record IqdKnowledgeSaveRequest(
        @JsonProperty("connection_id") Long connectionId,
        String kind,
        String title,
        String content,
        @JsonProperty("related_item_keys") String relatedItemKeys,
        String source,
        @JsonProperty("kb_term_id") String kbTermId,
        Boolean enabled) {
}
