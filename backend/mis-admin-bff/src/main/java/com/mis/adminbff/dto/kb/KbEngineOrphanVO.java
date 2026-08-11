package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 引擎侧游离 dataset 视图（P1-T3，BFF 透传层）。
 *
 * <p>字段与 mis-kb {@code KbEngineOrphanVO} 一一对应，仅做协议透传。
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
}
