package com.mis.kb.api.dto;

import com.mis.kb.api.dto.SynonymExpansionVO.SynonymBudgetVO;

/**
 * 同义词全局配置视图（Wave D，WD-07 / WD-15）。
 *
 * <p>与前端 {@code KbSynonymConfig} 逐字段对齐，一次请求把 S-07 页面需要的所有状态给全，
 * 免得前端为了渲染一个开关发三个请求。
 *
 * <p><b>双闸语义（Q2 裁决）——三个布尔缺一不可：</b>
 * <ul>
 *   <li>{@link #enabled} —— 库内业务开关，页面<b>可写</b>；</li>
 *   <li>{@link #killSwitchEnabled} —— Nacos 运维熔断闸 {@code mis.kb.synonym.enabled}，页面<b>只读</b>；</li>
 *   <li>{@link #effective} —— 两者相与，<b>由后端算好下发</b>。</li>
 * </ul>
 * 为什么 {@link #effective} 不让前端自己算：这个「与」的语义一旦在前端重算，
 * 就出现了两份真值来源；哪天加第三个闸（比如按租户禁用），前端不改就会显示错误状态。
 * 后端算好、前端直读，是让「生效状态」只有一个定义处。
 *
 * <p><b>{@link #budget} 只读</b>（Q5）：四个预算值仅 Nacos 可调，页面展示当前值。
 * 前端所有提示文案里的数字都从这里取，不许写死。
 *
 * <p><b>{@link #scale} 只提示不阻断</b>（WD-15 / D6 约束 5）：达建议线 80% 与超限各有一档文案，
 * 后端<b>不拒绝写入</b>。词表是业务资产，用一条硬编码上限把管理员挡在门外，
 * 换来的只会是绕过系统在 Excel 里维护第二份词表。
 *
 * @param enabled           库内业务开关是否为开
 * @param killSwitchEnabled Nacos 熔断闸是否为开（只读）
 * @param effective         实际生效状态 = {@code enabled && killSwitchEnabled}
 * @param budget            当前生效的扩展预算四值
 * @param scale             词表规模水位
 * @param dictVersion       当前词表版本号（跨实例一致性的权威源）
 */
public record SynonymConfigVO(
        Boolean enabled,
        Boolean killSwitchEnabled,
        Boolean effective,
        SynonymBudgetVO budget,
        SynonymScaleVO scale,
        Long dictVersion) {

    /**
     * 词表规模水位（WD-15）。
     *
     * @param groupCount           术语组总数（<b>含停用组</b>：它们同样占用词条唯一性，
     *                             也同样占存储，水位提示要算进去）
     * @param termCount            词条总数（含规范词）
     * @param recommendedTermLimit 建议上限，来自 {@code mis.kb.synonym.recommended-term-limit}
     */
    public record SynonymScaleVO(
            long groupCount,
            long termCount,
            int recommendedTermLimit) {
    }
}
