package com.mis.kb.domain.model;

/**
 * 同义词扩展预算（Wave D）。
 *
 * <p>四个值全部来自 Nacos 的 {@code mis.kb.synonym.*}（Q5 裁决：<b>预算仅 Nacos 可调，
 * 页面只读展示当前值</b>）。它们随 {@code GET /api/v1/kb/synonyms/config} 一并下发，
 * 前端所有提示文案里的数字都从这里取，<b>不许前端写死</b>。
 *
 * <p>对应 {@code docs/backend/knowledge-base-phase2-plan.md} §5.1-D6 的设计约束 2 与 3。
 *
 * @param maxGroups        单次最多扩展的术语组数，默认 8
 * @param maxTermsPerGroup 单组最多并入的别名数，默认 5（规范词不占额度，实际取 {@code M + 1} 项）
 * @param maxQueryChars    扩展后查询串的字符硬上限，默认 512
 * @param minTermLength    参与自动匹配的词条最小长度，默认 2（更短的词进 {@code skippedShortTerms}）
 */
public record SynonymBudget(
        int maxGroups,
        int maxTermsPerGroup,
        int maxQueryChars,
        int minTermLength) {

    /** 默认单次最多扩展术语组数。 */
    public static final int DEFAULT_MAX_GROUPS = 8;
    /** 默认单组最多并入别名数。 */
    public static final int DEFAULT_MAX_TERMS_PER_GROUP = 5;
    /** 默认扩展后查询串字符上限。 */
    public static final int DEFAULT_MAX_QUERY_CHARS = 512;
    /** 默认参与匹配的最小词长。 */
    public static final int DEFAULT_MIN_TERM_LENGTH = 2;

    /**
     * 紧凑构造：把非正数收敛到默认值。
     *
     * <p>存在理由：预算值来自外部配置，运维误填 0 或负数时，「按默认跑」远优于
     * 「一次也不扩展」或「无上限膨胀」——后两者都是静默的行为突变。
     */
    public SynonymBudget {
        maxGroups = maxGroups > 0 ? maxGroups : DEFAULT_MAX_GROUPS;
        maxTermsPerGroup = maxTermsPerGroup > 0 ? maxTermsPerGroup : DEFAULT_MAX_TERMS_PER_GROUP;
        maxQueryChars = maxQueryChars > 0 ? maxQueryChars : DEFAULT_MAX_QUERY_CHARS;
        minTermLength = minTermLength > 0 ? minTermLength : DEFAULT_MIN_TERM_LENGTH;
    }

    /**
     * 设计文档给定的默认预算（8 / 5 / 512 / 2）。
     *
     * @return 默认预算实例
     */
    public static SynonymBudget defaults() {
        return new SynonymBudget(
                DEFAULT_MAX_GROUPS,
                DEFAULT_MAX_TERMS_PER_GROUP,
                DEFAULT_MAX_QUERY_CHARS,
                DEFAULT_MIN_TERM_LENGTH);
    }
}
