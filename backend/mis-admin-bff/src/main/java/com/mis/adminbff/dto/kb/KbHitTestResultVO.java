package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 命中测试结果（BFF 侧镜像，字段与 mis-kb {@code HitTestResultVO} 一一对齐）。
 *
 * @param hits                命中片段列表；可能为空
 * @param effectiveParams     本次生效参数
 * @param elapsedMs           引擎检索耗时（毫秒）
 * @param emptyResultStrategy 该库生效的空结果策略 SUGGEST/EMPTY/TRANSFER
 * @param degraded            是否发生过参数降级
 * @param synonym             同义词扩展轨迹（Wave D，<b>末位追加</b>）。
 *                            命中测试是全平台唯一回显扩展轨迹的出口（WD-06）；
 *                            {@code null} 只可能出现在「对接了未升级的 mis-kb」这一种情况下，
 *                            前端需按「不显示卡片」处理，不要当成 {@code NO_MATCH}
 */
public record KbHitTestResultVO(
        List<KbHitTestHitVO> hits,
        KbEffectiveParamsVO effectiveParams,
        Long elapsedMs,
        String emptyResultStrategy,
        Boolean degraded,
        KbSynonymExpansionVO synonym) {
}
