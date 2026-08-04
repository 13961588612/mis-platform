package com.mis.kb.api.dto;

import java.util.List;

/**
 * 命中测试结果（WA-07 / WA-11 / WA-14）。
 *
 * <p>比普通检索多三样东西，都是「调参」这个场景刚需的：
 * <ul>
 *   <li>{@code effectiveParams}——这次到底用了什么参数、从哪来、降级了没；</li>
 *   <li>{@code elapsedMs}——耗时，rerank 开关对延迟的影响一眼可见；</li>
 *   <li>{@code emptyResultStrategy}——零命中时该库配置的兜底行为（WA-11 的可见性载体）。</li>
 * </ul>
 *
 * <p><b>Wave D 新增末位字段 {@code synonym}</b>（WD-06 / WD-19）：本 VO 是<b>整个平台唯一</b>
 * 被允许回显同义词扩展轨迹的响应体。命中测试的价值就在于「让管理员看见系统实际做了什么」，
 * 而扩展会实打实改变送进引擎的查询串——不给看，管理员根本无从判断
 * 「这条没召回，是词典没配好，还是阈值太高」。
 * 对称地，问答链路的 {@link RetrieveHitsVO} <b>一个字段都不许加</b>。
 *
 * @param hits                命中片段列表；可能为空
 * @param effectiveParams     本次生效参数
 * @param elapsedMs           引擎检索耗时（毫秒，不含鉴权与组装）
 * @param emptyResultStrategy 该库生效的空结果策略
 * @param degraded            是否发生过参数降级（等价于 {@code effectiveParams.degradedReasons} 非空）
 * @param synonym             同义词扩展轨迹（四态之一，<b>恒非 null</b>，
 *                            零命中时也要显式返回 {@code NO_MATCH} —— 不返回会被前端理解成
 *                            「功能坏了」，PRD §5.2-1）
 */
public record HitTestResultVO(
        List<ChunkHitVO> hits,
        EffectiveParamsVO effectiveParams,
        long elapsedMs,
        String emptyResultStrategy,
        boolean degraded,
        SynonymExpansionVO synonym) {
}
