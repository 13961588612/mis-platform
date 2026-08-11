package com.mis.kb.domain.model;

import java.util.Set;

/**
 * 文件级切片配置（方案 B：库级默认 + 文件级覆盖）。
 *
 * <p>对应 {@code kb_document} 三列（V23）：{@code chunkMethod} / {@code chunkTokenNum} /
 * {@code separator}。三字段全 {@code null} = 继承库级；任一非空 = 「文件指定」。
 *
 * <p><b>校验常量唯一事实源（设计 §3.2.2）：</b>{@link RagSettingsService} 等校验层
 * 一律引用本类的常量与方法，禁止各自硬编码一份列表，避免两处漂移。
 *
 * @param chunkMethod   切片方法（naive/qa/paper/book/laws/presentation/table/picture/one）
 * @param chunkTokenNum 切片 token 数（正整数）
 * @param separator     切片分隔符（允许纯空白）
 */
public record DocumentChunkConfig(String chunkMethod, Integer chunkTokenNum, String separator) {

    /** 合法切片方法码值（对齐 RAGFlow chunk_method）。 */
    public static final Set<String> VALID_CHUNK_METHODS = Set.of(
            "naive", "qa", "paper", "book", "laws", "presentation", "table", "picture", "one");

    /** token 数允许下界（256 起；低于 256 切片过碎，无检索价值）。 */
    public static final int MIN_TOKEN_NUM = 256;
    /** token 数允许上界。 */
    public static final int MAX_TOKEN_NUM = 4096;

    /**
     * 任一字段非空 = 文件指定（PRD §5.3 来源判定 / 设计 §8-5 两级切片语义）。
     *
     * @return 任一字段非空返回 {@code true}
     */
    public boolean hasAnyOverride() {
        return (chunkMethod != null && !chunkMethod.isBlank())
                || chunkTokenNum != null
                || separator != null;
    }

    /**
     * 切片方法码值是否合法。
     *
     * @param method 原始码值，可为 {@code null}
     * @return 空/非法返回 {@code false}
     */
    public static boolean isValidChunkMethod(String method) {
        return method != null && VALID_CHUNK_METHODS.contains(method.trim().toLowerCase());
    }

    /**
     * token 数是否合法（可空；null 表示未指定）。
     *
     * @param n token 数
     * @return null 或落在 [256, 4096] 返回 {@code true}
     */
    public static boolean isValidTokenNum(Integer n) {
        return n == null || (n >= MIN_TOKEN_NUM && n <= MAX_TOKEN_NUM);
    }
}
