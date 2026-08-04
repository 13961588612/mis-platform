package com.mis.kb.api.dto;

import java.util.List;

/**
 * 检索命中视图（仅含 MIS 业务 ID）。
 *
 * <p><b>Wave A（WA-11 / WA-02）扩展两个字段，纯增量、向后兼容：</b>
 * <ul>
 *   <li>{@code emptyResultStrategy}——未命中时调用方（mis-rag / 命中测试页）该怎么兜底。
 *       单库取库级设置，多库取全局默认（与参数合并口径一致，见 U7）。取值恒在
 *       {@code SUGGEST|EMPTY|TRANSFER} 三值域内；</li>
 *   <li>{@code effectiveParams}——本次检索实际生效的参数与降级原因，供排障。</li>
 * </ul>
 *
 * <p>mis-rag（Python）侧以 {@code dict.get()} 读取，新增字段不会破坏其解析；
 * 老调用方不读这两个键也完全正常（§7.5-5 向后兼容约定）。
 *
 * @param hits                命中片段列表
 * @param emptyResultStrategy 空结果策略码值
 * @param effectiveParams     本次生效参数快照
 */
public record RetrieveHitsVO(
        List<ChunkHitVO> hits,
        String emptyResultStrategy,
        EffectiveParamsVO effectiveParams) {

    /**
     * 兼容构造：仅命中列表。
     *
     * <p>保留给尚未关心策略与生效参数的老调用点，避免一次性改动面过大。
     *
     * @param hits 命中片段列表
     */
    public RetrieveHitsVO(List<ChunkHitVO> hits) {
        this(hits, null, null);
    }
}
