package com.mis.adminbff.dto.kb;

import com.mis.adminbff.dto.kb.KbSynonymExpansionVO.KbSynonymBudgetVO;

/**
 * 同义词全局配置（BFF 侧镜像，字段与 mis-kb {@code SynonymConfigVO} 一一对齐）。
 *
 * <p>Wave D 新增，纯透传。
 *
 * <p><b>{@link #effective} 由 mis-kb 算好下发，BFF 绝不重算。</b>
 * 它等于 {@code enabled && killSwitchEnabled}（Q2 双闸）。这个「与」一旦在这一层
 * 或前端重算，「生效状态」就有了两份真值来源；将来加第三个闸（比如按租户禁用），
 * 没同步改的那一份立刻开始撒谎。
 *
 * <p>{@link #budget} 复用 {@link KbSynonymExpansionVO.KbSynonymBudgetVO}——
 * 命中测试卡片和配置页展示的是同一组预算值，两处各定义一个 record，
 * 迟早会在某次加字段时只改一边。
 *
 * @param enabled           库内业务开关是否为开（页面可写）
 * @param killSwitchEnabled Nacos 熔断闸 {@code mis.kb.synonym.enabled} 是否为开（页面只读）
 * @param effective         实际生效状态 = {@code enabled && killSwitchEnabled}
 * @param budget            当前生效的扩展预算四值（只读）
 * @param scale             词表规模水位（只提示不阻断）
 * @param dictVersion       当前词表版本号
 */
public record KbSynonymConfigVO(
        Boolean enabled,
        Boolean killSwitchEnabled,
        Boolean effective,
        KbSynonymBudgetVO budget,
        KbSynonymScaleVO scale,
        Long dictVersion) {

    /**
     * 词表规模水位（BFF 镜像，WD-15）。
     *
     * @param groupCount           术语组总数（含停用组）
     * @param termCount            词条总数（含规范词）
     * @param recommendedTermLimit 建议上限；达 80% 与超限各有一档前端文案，后端不阻断写入
     */
    public record KbSynonymScaleVO(
            Long groupCount,
            Long termCount,
            Integer recommendedTermLimit) {
    }
}
