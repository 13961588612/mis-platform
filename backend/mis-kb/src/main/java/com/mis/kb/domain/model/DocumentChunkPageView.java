package com.mis.kb.domain.model;

import java.util.List;

/**
 * 文档切片分页视图（引擎层返回，仅含 MIS 业务 id 与清洗后文本）。
 *
 * <p>{@code total} 为引擎侧总条数（关键字过滤后），供上层组装全局连续序号
 * 与统计条；{@code chunks} 恒非 {@code null}。{@code chunkCount}/{@code tokenCount}
 * 来自引擎 {@code doc} 文档级摘要（全量切片数与 token 数，均不受关键字过滤影响，
 * 可空——引擎未提供或降级空页时为 {@code null}），供统计条展示「全量 chunk 数 +
 * 总 token」双口径（设计 §7 共享知识 #3）。
 *
 * @param chunks      当前页切片列表（恒非 {@code null}，可能为空列表）
 * @param total       关键字过滤后的总条数
 * @param page        当前页码（1-based）
 * @param pageSize    每页条数
 * @param chunkCount  文档全量切片数（引擎 doc.chunk_count；可空）
 * @param tokenCount  文档级 token 数（引擎 doc.token_count；可空）
 */
public record DocumentChunkPageView(
        List<DocumentChunkView> chunks,
        int total,
        int page,
        int pageSize,
        Integer chunkCount,
        Integer tokenCount) {

    /**
     * 空页（引擎不支持 / 无映射 / 降级时用）。
     *
     * @param page     期望页码
     * @param pageSize 期望每页条数
     * @return 空切片页，total=0，chunkCount/tokenCount=null
     */
    public static DocumentChunkPageView empty(int page, int pageSize) {
        return new DocumentChunkPageView(
                List.of(), 0, Math.max(page, 1), Math.max(pageSize, 1), null, null);
    }
}
