package com.mis.kb.api.dto;

/**
 * 引用视图（仅 MIS 业务 ID）。
 *
 * <p>F-04：{@code offset}/{@code page}/{@code source} 为溯源定位信息。
 * 注意实体侧列名为 {@code chunk_offset}/{@code page_no}（避开 SQL 保留字），
 * 对外契约字段名固定为 {@code offset}/{@code page}，前端按此消费。
 */
public record QaCitationVO(
        Long id,
        Long libraryId,
        Long documentId,
        String chunkText,
        Double score,
        Integer offset,
        Integer page,
        String source) {
}
