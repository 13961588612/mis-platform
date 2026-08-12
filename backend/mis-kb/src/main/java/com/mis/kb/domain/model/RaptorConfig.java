package com.mis.kb.domain.model;

/**
 * RAPTOR 摘要配置常量与校验（Wave C RAPTOR，T01）。
 *
 * <p><b>常量唯一事实源（设计 §3.2.2 同款铁律）：</b>{@link RagSettingsService} 校验层、
 * {@code RagflowClient} 下发层一律引用本类的常量与方法，禁止各自硬编码一份列表，
 * 避免多处漂移。
 *
 * <p><b>语义区分：</b>{@code raptorMaxTokenNum} 与 {@code chunkTokenNum} 不同——
 * 后者是「切片粒度」（文件切块，{@link DocumentChunkConfig} 常量），
 * 前者是「RAPTOR 摘要 chunk 的最大 token 数」（递归摘要节点，引擎
 * {@code parser_config.raptor.max_token}）。两者独立校验、独立下发。
 *
 * <p><b>T00 P1b 实测区间（{@code ragflow-raptor-probe-2026-08-12.md}）：</b>
 * 引擎合法区间 {@code [1, 2048]}，但 MIS 按用户期望收窄为 {@code [512, 2048]}
 * （低于 512 的摘要过碎，无归纳价值）；默认 {@code 1024}（引擎建库默认 256，
 * MIS 默认值按分析报告 §2.0 收口为 1024——合法但更符合中文长文档归纳习惯）。
 * 严禁下发 4096（引擎 code:101 拒整单）。
 *
 * <p><b>U6 裁定：不暴露 {@code random_seed}</b>——引擎字段名是 {@code random_seed}
 * （写 {@code seed} 会 code:101 被拒），MIS 不下发该键，走引擎默认（0）。
 *
 * <p><b>T00 P1g 实测：</b>{@code prompt} 引擎<b>不强制</b> {@code {cluster_content}}
 * 占位符（缺省也 code:0），MIS 长度校验可宽松（≤2000）。
 */
public final class RaptorConfig {

    private RaptorConfig() {
    }

    /** 摘要 chunk 最大 token 数允许下界（MIS 收窄口径，T00 P1b）。 */
    public static final int MIN_TOKEN_NUM = 512;

    /** 摘要 chunk 最大 token 数允许上界（引擎硬上限，T00 P1b 实测 2048）。 */
    public static final int MAX_TOKEN_NUM = 2048;

    /** 摘要 chunk 最大 token 数默认值（分析报告 §2.0 收口；引擎建库默认 256）。 */
    public static final int DEFAULT_MAX_TOKEN_NUM = 1024;

    /** 聚类相似度阈值默认值（引擎默认 0.1，T00 P1a）。 */
    public static final double DEFAULT_THRESHOLD = 0.1D;

    /** 最大聚类数默认值（引擎默认 64，T00 P1a）。 */
    public static final int DEFAULT_MAX_CLUSTER = 64;

    /** 提示词最大长度（≤2000；引擎不强制 {@code {cluster_content}}，T00 P1g）。 */
    public static final int MAX_PROMPT_LENGTH = 2000;

    /**
     * 官方递归摘要提示词（T00 P1a 建库默认值原样固化）。
     *
     * <p>引擎建库默认即此值；MIS 默认用同一份，保证「未显式设置」与引擎默认一致。
     */
    public static final String DEFAULT_PROMPT =
            "Please summarize the following paragraphs. Be careful with the numbers, "
                    + "do not make things up. Paragraphs as following:\n"
                    + "      {cluster_content}\n"
                    + "The above is the content you need to summarize.";

    /**
     * 摘要 chunk 最大 token 数是否合法（可空；null 表示未指定）。
     *
     * @param n token 数
     * @return null 或落在 {@code [512, 2048]} 返回 {@code true}
     */
    public static boolean isValidMaxTokenNum(Integer n) {
        return n == null || (n >= MIN_TOKEN_NUM && n <= MAX_TOKEN_NUM);
    }

    /**
     * 聚类相似度阈值是否合法（可空；null 表示未指定）。
     *
     * <p>合法区间 {@code [0, 1]}（<b>含 0</b>——T00 P1b 实测引擎接受 0，与
     * {@code scoreThreshold} 同款含 0 语义）。
     *
     * @param v 阈值
     * @return null 或落在 {@code [0, 1]} 返回 {@code true}
     */
    public static boolean isValidThreshold(Double v) {
        return v == null || (v >= 0D && v <= 1D);
    }

    /**
     * 最大聚类数是否合法（可空；null 表示未指定）。
     *
     * @param n 聚类数
     * @return null 或落在 {@code [1, 1024]} 返回 {@code true}
     */
    public static boolean isValidMaxCluster(Integer n) {
        return n == null || (n >= 1 && n <= 1024);
    }

    /**
     * 提示词是否合法（可空；null 表示未指定）。
     *
     * @param prompt 提示词
     * @return null 或长度 ≤ {@value #MAX_PROMPT_LENGTH} 返回 {@code true}
     */
    public static boolean isValidPrompt(String prompt) {
        return prompt == null || prompt.length() <= MAX_PROMPT_LENGTH;
    }
}
