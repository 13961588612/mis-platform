package com.mis.adminbff.dto.kb;

/**
 * 文档切片统计条（BFF 侧镜像，与 mis-kb {@code KbDocumentChunkStatsVO} 对齐）。
 *
 * <p>双口径（设计 §7 共享知识 #3）：{@code chunkCount} 为文档全量切片数（引擎
 * {@code doc.chunk_count}，不受关键字过滤影响，可空）；{@code totalChunks} 为
 * 关键字过滤后命中切片数。{@code tokenCount} 为文档级总 token 数（可空）；
 * {@code totalCharacterCount} 为当前页字符合计。
 *
 * @param totalChunks         关键字过滤后的命中切片数
 * @param totalCharacterCount 当前页切片清洗后正文合计字符数
 * @param chunkMethod         切片方法
 * @param chunkTokenNum       切片 token 数
 * @param separator           切片分隔符
 * @param source              来源：FILE_OVERRIDE / LIBRARY
 * @param chunkCount          文档全量切片数（可空）
 * @param tokenCount          文档级总 token 数（可空）
 */
public record KbDocumentChunkStatsVO(
        int totalChunks,
        int totalCharacterCount,
        String chunkMethod,
        Integer chunkTokenNum,
        String separator,
        String source,
        Integer chunkCount,
        Integer tokenCount) {
}
