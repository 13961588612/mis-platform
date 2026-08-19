package com.mis.kb.domain.model;

import java.util.Set;

/**
 * 文件级切片配置（方案 B：库级默认 + 文件级覆盖）。
 *
 * <p>对应 {@code kb_document} 三列（V23）：{@code chunkMethod} / {@code chunkTokenNum} /
 * {@code separator}。三字段全 {@code null} = 继承库级；任一非空 = 「文件指定」。
 *
 * <p><b>T4 扩展（RAGFlow 切片设置参数对齐）：</b>追加 {@code pageIndex} /
 * {@code imageTableContextWindow} / {@code autoKeywords} / {@code autoQuestions}
 * （对应 {@code kb_document} 新增四列，V62）。与库级同名语义一致：
 * <ul>
 *   <li>{@code pageIndex}（布尔）→ 文件级 {@code toc_extraction} 语义——但<b>文件级 PUT
 *       白名单不含 toc/context/overlap 键</b>（T0-b B3 实测 code:102 拒整单），仅持久化 +
 *       回显 + 合并展示，不下发；</li>
 *   <li>{@code imageTableContextWindow}（[1,4096]）同只落库不下发；</li>
 *   <li>{@code autoKeywords}（0~32）/ {@code autoQuestions}（0~10）→ 文件级 PUT 白名单
 *       {@code auto_keywords} / {@code auto_questions}（T0-b B2 实测接受）。</li>
 * </ul>
 * 七字段全 {@code null} = 继承库级（快照语义，T5）。
 *
 * <p><b>校验常量唯一事实源（设计 §3.2.2）：</b>{@link RagSettingsService} 等校验层
 * 一律引用本类的常量与方法，禁止各自硬编码一份列表，避免两处漂移。
 *
 * @param chunkMethod             切片方法（naive/qa/paper/book/laws/presentation/table/picture/one）
 * @param chunkTokenNum           切片 token 数（正整数）
 * @param separator               切片分隔符（允许纯空白）
 * @param pageIndex               文件级页码索引/TOC 提取开关（null = 继承库级；只落库不下发）
 * @param imageTableContextWindow 文件级图像/表格上下文窗口 token 数（null = 继承库级；只落库不下发）
 * @param autoKeywords            文件级自动关键字数量（0=关闭，0~32；null = 继承库级）
 * @param autoQuestions           文件级自动问题数量（0=关闭，0~10；null = 继承库级）
 */
public record DocumentChunkConfig(
        String chunkMethod,
        Integer chunkTokenNum,
        String separator,
        Boolean pageIndex,
        Integer imageTableContextWindow,
        Integer autoKeywords,
        Integer autoQuestions) {

    /** 合法切片方法码值（对齐 RAGFlow chunk_method）。 */
    public static final Set<String> VALID_CHUNK_METHODS = Set.of(
            "naive", "qa", "paper", "book", "laws", "presentation", "table", "picture", "one");

    /** token 数允许下界（256 起；低于 256 切片过碎，无检索价值）。 */
    public static final int MIN_TOKEN_NUM = 256;
    /** token 数允许上界。 */
    public static final int MAX_TOKEN_NUM = 4096;

    /**
     * 兼容构造：3 参数旧签名（V23 三字段），T4 四字段置 {@code null}（继承库级）。
     *
     * <p>record 是位置参数，新字段必须追加末位（设计 §8-1 铁律）；既有 3 参构造点
     * （上传接口、存量测试）保持零改动，「未设置」语义天然继承库级。
     *
     * @param chunkMethod   切片方法
     * @param chunkTokenNum 切片 token 数
     * @param separator     切片分隔符
     */
    public DocumentChunkConfig(String chunkMethod, Integer chunkTokenNum, String separator) {
        this(chunkMethod, chunkTokenNum, separator, null, null, null, null);
    }

    /**
     * 任一字段非空 = 文件指定（PRD §5.3 来源判定 / 设计 §8-5 两级切片语义）。
     *
     * <p>T4：纳入 4 个新字段（pageIndex / imageTableContextWindow / autoKeywords /
     * autoQuestions）——任一非空即算文件覆盖。
     *
     * @return 任一字段非空返回 {@code true}
     */
    public boolean hasAnyOverride() {
        return (chunkMethod != null && !chunkMethod.isBlank())
                || chunkTokenNum != null
                || separator != null
                || pageIndex != null
                || imageTableContextWindow != null
                || autoKeywords != null
                || autoQuestions != null;
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

    /**
     * 图像/表格上下文窗口是否合法（可空；null 表示未指定）。
     *
     * <p>常量与 {@link RagSettings} 同源（{@code MIN/MAX_IMAGE_TABLE_CONTEXT_WINDOW}），
     * 校验层共用一份区间，避免漂移。
     *
     * @param n 窗口 token 数
     * @return null 或落在 [1, 4096] 返回 {@code true}
     */
    public static boolean isValidImageTableContextWindow(Integer n) {
        return n == null || (n >= RagSettings.MIN_IMAGE_TABLE_CONTEXT_WINDOW
                && n <= RagSettings.MAX_IMAGE_TABLE_CONTEXT_WINDOW);
    }

    /**
     * 自动关键字数量是否合法（可空；null 表示未指定；0 = 关闭）。
     *
     * @param n 数量
     * @return null 或落在 [0, 32] 返回 {@code true}
     */
    public static boolean isValidAutoKeywords(Integer n) {
        return n == null || (n >= 0 && n <= RagSettings.MAX_AUTO_KEYWORDS);
    }

    /**
     * 自动问题数量是否合法（可空；null 表示未指定；0 = 关闭）。
     *
     * @param n 数量
     * @return null 或落在 [0, 10] 返回 {@code true}
     */
    public static boolean isValidAutoQuestions(Integer n) {
        return n == null || (n >= 0 && n <= RagSettings.MAX_AUTO_QUESTIONS);
    }
}
