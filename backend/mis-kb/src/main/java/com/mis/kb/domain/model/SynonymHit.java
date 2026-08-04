package com.mis.kb.domain.model;

/**
 * 一次同义词命中的轨迹条目（Wave D）。
 *
 * <p>只用于命中测试轨迹回显（PRD §7），<b>不进入问答链路的任何响应体</b>（WD-06 红线）。
 *
 * @param groupId        命中的术语组 ID；前端据此跳 {@code /kb/synonyms?groupId=42}
 * @param matchedTerm    问句中被命中的原文片段（保留问句里的原始大小写与写法）
 * @param canonicalTerm  该组的规范词，用于 chip 展示
 * @param addedTermCount 本次实际并入查询串的扩展词数量（已扣除去重与预算截断）
 */
public record SynonymHit(
        Long groupId,
        String matchedTerm,
        String canonicalTerm,
        int addedTermCount) {
}
