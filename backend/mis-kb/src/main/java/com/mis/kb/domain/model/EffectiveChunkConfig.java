package com.mis.kb.domain.model;

/**
 * 两级切片合并结果：生效值 + 单一来源标记（PRD §5.3 / 设计 §3.2.2）。
 *
 * <p>由 {@link DocumentChunkConfigResolver} 产出，供前端「切片方式」列与来源徽标使用。
 * 引擎下发时<b>不</b>直接使用本对象——上传/改参只下发文件级非空字段（设计 §3.2.2 引擎下发差异）。
 *
 * <p><b>T4 扩展（RAGFlow 切片设置参数对齐）：</b>追加 {@code pageIndex} /
 * {@code imageTableContextWindow} / {@code autoKeywords} / {@code autoQuestions}，
 * 与库级合并后展示有效值（文件级 ?? 库级 ?? 全局默认）。
 *
 * @param chunkMethod             生效切片方法
 * @param chunkTokenNum           生效切片 token 数
 * @param separator               生效切片分隔符
 * @param pageIndex               生效页码索引/TOC 提取开关（只展示，文件级不下发）
 * @param imageTableContextWindow 生效图像/表格上下文窗口 token 数（只展示，文件级不下发）
 * @param autoKeywords            生效自动关键字数量（0=关闭）
 * @param autoQuestions           生效自动问题数量（0=关闭）
 * @param source                  来源标记，见 {@link #SOURCE_FILE_OVERRIDE} / {@link #SOURCE_LIBRARY}
 */
public record EffectiveChunkConfig(
        String chunkMethod,
        Integer chunkTokenNum,
        String separator,
        Boolean pageIndex,
        Integer imageTableContextWindow,
        Integer autoKeywords,
        Integer autoQuestions,
        String source) {

    /** 来源：文件级任一字段非空，按文件级覆盖。 */
    public static final String SOURCE_FILE_OVERRIDE = "FILE_OVERRIDE";
    /** 来源：文件级全空，继承库级（含全局默认）。 */
    public static final String SOURCE_LIBRARY = "LIBRARY";

    /**
     * 是否文件级覆盖。
     *
     * @return source 等于 {@link #SOURCE_FILE_OVERRIDE} 返回 {@code true}
     */
    public boolean isFileOverride() {
        return SOURCE_FILE_OVERRIDE.equals(source);
    }

    /**
     * 转为文件级配置对象（七字段，丢来源标记）。
     *
     * <p>供服务层「清空文件级覆盖 → 快照式下发库级有效值」（T5）构造引擎入参使用；
     * 合并语义仍由 {@link DocumentChunkConfigResolver} 唯一收口，本方法只做
     * {@link EffectiveChunkConfig} → {@link DocumentChunkConfig} 的纯字段搬运。
     *
     * @return 携带七字段生效值的 {@link DocumentChunkConfig}
     */
    public DocumentChunkConfig toDocumentChunkConfig() {
        return new DocumentChunkConfig(
                chunkMethod, chunkTokenNum, separator,
                pageIndex, imageTableContextWindow, autoKeywords, autoQuestions);
    }
}
