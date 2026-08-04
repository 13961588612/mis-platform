package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 知识库视图（BFF 侧镜像）。
 *
 * <p>只含 MIS 业务 ID，不含引擎原生 id；{@code docCount} 由下游聚合返回。
 */
public record KbLibraryVO(
        Long id,
        Long categoryId,
        String name,
        String secrecy,
        Integer status,
        Long owner,
        String engineType,
        KbRagSettings settings,
        Long docCount,
        Instant createdAt,
        Instant updatedAt) {
}
