package com.mis.kb.api.dto;

/**
 * 文档切片统计条（「查看文档切分效果」抽屉顶部）。
 *
 * <p>切片配置以 <b>MIS 本地</b>为准（来源判定 {@code source}）：
 * 文档级覆盖字段任一非空 → {@code FILE_OVERRIDE}（展示文档级值）；
 * 否则 {@code LIBRARY}（展示库级有效值，缺失时兜底 {@code RagSettings.withDefaults()}）。
 *
 * <p><b>双口径</b>（设计 §7 共享知识 #3）：{@code chunkCount} 为文档<b>全量</b>切片数
 * （引擎 {@code doc.chunk_count}，不受关键字过滤影响，可空）；{@code totalChunks} 为
 * <b>关键字过滤后</b>命中切片数（与响应顶层 {@code total} 一致）。{@code tokenCount}
 * 为文档级总 token 数（引擎 {@code doc.token_count}，可空）。
 * {@code totalCharacterCount} 为<b>当前页</b>全部切片清洗后正文合计字符数（供「本页字符」标注，
 * 不表示全文档）。
 *
 * @param totalChunks         关键字过滤后的命中切片数（与顶层 {@code total} 一致）
 * @param totalCharacterCount 当前页切片清洗后正文合计字符数
 * @param chunkMethod         切片方法（naive/qa/paper/book/laws/presentation/table/picture/one）
 * @param chunkTokenNum       切片 token 数
 * @param separator           切片分隔符（可能为纯空白）
 * @param source              来源：FILE_OVERRIDE / LIBRARY
 * @param chunkCount          文档全量切片数（引擎 doc.chunk_count；可空）
 * @param tokenCount          文档级总 token 数（引擎 doc.token_count；可空）
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
