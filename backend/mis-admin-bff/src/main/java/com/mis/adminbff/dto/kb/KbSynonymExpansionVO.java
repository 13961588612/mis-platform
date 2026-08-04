package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 同义词扩展轨迹（BFF 侧镜像，字段与 mis-kb {@code SynonymExpansionVO} 一一对齐）。
 *
 * <p>Wave D 新增。本层<b>纯透传、零加工</b>：不合并四态、不改写文案、不补默认值——
 * 一旦 BFF 开始「顺手润色」，前端看到的就不再是检索链路的真实行为，
 * 命中测试作为「调参工具」的全部价值随之归零。
 *
 * <p><b>⛔ WD-06 红线：本 VO 只允许挂在 {@link KbHitTestResultVO#synonym()} 上。</b>
 * 问答链路的检索响应（{@code /internal/v1/kb/rag/retrieve}）在 mis-kb 侧就已经
 * 不含扩展轨迹，BFF 这边更不应该「补」出来。
 *
 * @param status             {@code EXPANDED} / {@code NO_MATCH} /
 *                           {@code DISABLED_GLOBAL} / {@code DISABLED_REQUEST}。
 *                           后两者<b>绝不可合并</b>：前者要去 S-07 改全局开关，
 *                           后者只要取消本次勾选
 * @param originalQuestion   用户原话
 * @param expandedQuery      实际送引擎的查询串；未扩展时逐字符等于 {@code originalQuestion}
 * @param hits               命中轨迹
 * @param droppedGroups      因超预算被整组丢弃的组规范词
 * @param skippedShortTerms  因过短未参与匹配、但确实出现在问句中的词（WD-19）
 * @param totalMatchedGroups 截断前命中的组总数
 * @param usedGroups         截断后实际并入的组数
 * @param truncated          是否发生过截断
 * @param engineNativeHint   Q9 运维声明式提示位；前端必须用 {@code === true} 判定
 * @param budget             本次生效的预算快照（Q5：数字全部来自后端，前端不许写死）
 */
public record KbSynonymExpansionVO(
        String status,
        String originalQuestion,
        String expandedQuery,
        List<KbSynonymHitVO> hits,
        List<String> droppedGroups,
        List<String> skippedShortTerms,
        Integer totalMatchedGroups,
        Integer usedGroups,
        Boolean truncated,
        Boolean engineNativeHint,
        KbSynonymBudgetVO budget) {

    /**
     * 单条命中轨迹（BFF 镜像）。
     *
     * @param groupId        命中的术语组 ID；前端据此跳 {@code /kb/synonyms?groupId=42}
     * @param matchedTerm    问句中被命中的原文片段
     * @param canonicalTerm  该组规范词
     * @param addedTermCount 本次实际并入查询串的扩展词数量
     */
    public record KbSynonymHitVO(
            Long groupId,
            String matchedTerm,
            String canonicalTerm,
            Integer addedTermCount) {
    }

    /**
     * 预算快照（BFF 镜像，页面只读）。
     *
     * @param maxGroups        单次最多扩展的术语组数
     * @param maxTermsPerGroup 单组最多并入的别名数
     * @param maxQueryChars    扩展后查询串的字符硬上限
     * @param minTermLength    参与自动匹配的词条最小长度
     */
    public record KbSynonymBudgetVO(
            Integer maxGroups,
            Integer maxTermsPerGroup,
            Integer maxQueryChars,
            Integer minTermLength) {
    }
}
