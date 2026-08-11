package com.mis.kb.api.dto;

import com.mis.kb.domain.entity.KbEngineOrphan;

import java.time.Instant;

/**
 * 引擎侧游离 dataset 视图（P1-T3）。
 *
 * <p>与 {@link KbEngineOrphan} 一一对应，单独建 VO 是为了让传输契约独立于实体演进，
 * 并在列表接口里带出 P1 新增的处置字段（{@code resolvedAction} / {@code resolvedAt} / 等）。
 *
 * @param id             行 ID
 * @param engineType    引擎类型
 * @param nativeId      引擎原生 dataset id
 * @param nativeName    引擎侧 dataset 名
 * @param docCount      引擎侧文档数
 * @param firstSeenAt   首次发现时刻
 * @param lastSeenAt    最近一次可见时刻
 * @param resolved      0=待处理 1=已处置
 * @param resolvedAction 处置动作（bind_existing/adopt_new/ignore），未处置为 {@code null}
 * @param resolvedAt    处置时刻
 * @param resolvedNote  处置备注（ignore 必填）
 * @param resolvedBy    处置人用户 ID
 */
public record KbEngineOrphanVO(
        Long id,
        String engineType,
        String nativeId,
        String nativeName,
        Integer docCount,
        Instant firstSeenAt,
        Instant lastSeenAt,
        Integer resolved,
        String resolvedAction,
        Instant resolvedAt,
        String resolvedNote,
        Long resolvedBy) {

    /** 由实体转换。 */
    public static KbEngineOrphanVO from(KbEngineOrphan o) {
        return new KbEngineOrphanVO(
                o.getId(), o.getEngineType(), o.getNativeId(), o.getNativeName(), o.getDocCount(),
                o.getFirstSeenAt(), o.getLastSeenAt(), o.getResolved(),
                o.getResolvedAction(), o.getResolvedAt(), o.getResolvedNote(), o.getResolvedBy());
    }
}
