package com.mis.kb.api.dto;

import com.mis.kb.domain.model.SynonymBudget;
import com.mis.kb.domain.model.SynonymExpansion;
import com.mis.kb.domain.model.SynonymHit;

import java.util.List;

/**
 * 同义词扩展轨迹的对外视图（Wave D，WD-06 / WD-19）。
 *
 * <p><b>⛔ 唯一合法出口是 {@link HitTestResultVO#synonym()}。</b>
 * 本 VO 绝不允许出现在 {@link RetrieveHitsVO} 或任何 {@code /internal/v1/kb/rag/**}
 * 响应体里 —— 那等于把扩展串交给 {@code mis-rag}，AC-03b 直接判死。
 * {@code RetrieveHitsVoContractTest} 会对 {@code RetrieveHitsVO} 的 JSON 键集合做恒等断言，
 * 任何人「顺手」加一个字段都会当场红灯。
 *
 * <p><b>为什么要单独一层 VO，而不是直接把 {@link SynonymExpansion} 序列化出去：</b>
 * 领域对象会随实现演进（例如以后加内部计数器、加匹配区间下标），API 契约必须稳。
 * 更要紧的是 —— 领域对象<b>没有</b>「只能出现在命中测试」这条约束的物理体现，
 * 隔一层之后，谁想在问答链路里回显扩展轨迹，就必须显式 import 一个
 * 类注释里写着红线的类型，成本与可见度都足够高。
 *
 * <p><b>四态必须原样透出</b>（§7.3）：{@code DISABLED_GLOBAL} 与 {@code DISABLED_REQUEST}
 * 绝不可在这一层被合并成 {@code disabled} —— 前者管理员要去 S-07 改开关，
 * 后者只要取消勾选，后续动作完全不同。
 *
 * @param status             四态之一：{@code EXPANDED} / {@code NO_MATCH} /
 *                           {@code DISABLED_GLOBAL} / {@code DISABLED_REQUEST}
 * @param originalQuestion   用户原话（逐字符保留）
 * @param expandedQuery      实际送引擎的查询串；未扩展时逐字符等于 {@code originalQuestion}
 * @param hits               命中轨迹；非扩展态为空列表（不是 {@code null}）
 * @param droppedGroups      因超预算被整组丢弃的组规范词
 * @param skippedShortTerms  因短于 {@code minTermLength} 未参与匹配、但确实出现在问句中的词（WD-19）
 * @param totalMatchedGroups 截断前命中的组总数
 * @param usedGroups         截断后实际并入的组数
 * @param truncated          是否发生过截断
 * @param engineNativeHint   Q9 运维声明式开关；前端<b>必须用 {@code === true}</b> 判定（§7.8）
 * @param budget             本次生效的预算快照；前端提示文案里的数字全部取自这里（Q5）
 */
public record SynonymExpansionVO(
        String status,
        String originalQuestion,
        String expandedQuery,
        List<SynonymHitVO> hits,
        List<String> droppedGroups,
        List<String> skippedShortTerms,
        int totalMatchedGroups,
        int usedGroups,
        boolean truncated,
        boolean engineNativeHint,
        SynonymBudgetVO budget) {

    /**
     * 单条命中轨迹视图。
     *
     * @param groupId        命中的术语组 ID；前端据此跳 {@code /kb/synonyms?groupId=42}
     * @param matchedTerm    问句中被命中的原文片段（保留原始大小写与写法）
     * @param canonicalTerm  该组规范词，用于 chip 展示
     * @param addedTermCount 本次实际并入查询串的扩展词数量（已扣除去重与预算截断）
     */
    public record SynonymHitVO(
            Long groupId,
            String matchedTerm,
            String canonicalTerm,
            int addedTermCount) {

        /**
         * 由领域对象构造视图。
         *
         * @param hit 领域命中；{@code null} 时返回 {@code null}
         * @return 视图对象
         */
        public static SynonymHitVO from(SynonymHit hit) {
            if (hit == null) {
                return null;
            }
            return new SynonymHitVO(
                    hit.groupId(), hit.matchedTerm(), hit.canonicalTerm(), hit.addedTermCount());
        }
    }

    /**
     * 预算快照视图（Q5：仅 Nacos 可调，页面只读展示）。
     *
     * @param maxGroups        单次最多扩展的术语组数
     * @param maxTermsPerGroup 单组最多并入的别名数
     * @param maxQueryChars    扩展后查询串的字符硬上限
     * @param minTermLength    参与自动匹配的词条最小长度
     */
    public record SynonymBudgetVO(
            int maxGroups,
            int maxTermsPerGroup,
            int maxQueryChars,
            int minTermLength) {

        /**
         * 由领域对象构造视图。
         *
         * @param budget 领域预算；{@code null} 时回落设计默认值（8 / 5 / 512 / 2），
         *               不返回 {@code null} —— 前端要拿这些数字拼提示文案，
         *               给它一个 {@code null} 只会换来一句「undefined 组」
         * @return 视图对象，恒非 {@code null}
         */
        public static SynonymBudgetVO from(SynonymBudget budget) {
            SynonymBudget b = budget == null ? SynonymBudget.defaults() : budget;
            return new SynonymBudgetVO(
                    b.maxGroups(), b.maxTermsPerGroup(), b.maxQueryChars(), b.minTermLength());
        }
    }

    /**
     * 由领域对象构造视图。
     *
     * @param expansion 扩展结果；{@code null} 时返回 {@code null}
     *                  （正常链路下 {@code Resolution.expansion()} 恒非 null，
     *                  这里的判空只为兼容手工构造 {@code Resolution} 的老单测）
     * @return 视图对象
     */
    public static SynonymExpansionVO from(SynonymExpansion expansion) {
        if (expansion == null) {
            return null;
        }
        List<SynonymHitVO> hitVos = expansion.hits().stream()
                .map(SynonymHitVO::from)
                .toList();
        return new SynonymExpansionVO(
                expansion.status(),
                expansion.originalQuestion(),
                expansion.expandedQuery(),
                hitVos,
                expansion.droppedGroups(),
                expansion.skippedShortTerms(),
                expansion.totalMatchedGroups(),
                expansion.usedGroups(),
                expansion.truncated(),
                expansion.engineNativeHint(),
                SynonymBudgetVO.from(expansion.budget()));
    }
}
