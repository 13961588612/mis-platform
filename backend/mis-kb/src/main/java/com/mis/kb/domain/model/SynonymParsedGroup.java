package com.mis.kb.domain.model;

import java.util.List;

/**
 * 从导入文件中解析出的<b>一个术语组</b>（Wave D · T08）。
 *
 * <p>这是 CSV 与 JSON 两条解析路径的<b>唯一汇合点</b>：两个 Codec 各自处理格式细节，
 * 之后所有的冲突判定、计划生成、落库执行都只认这个结构。AC-09 要求
 * 「同一术语组分别用 CSV 与 JSON 导入干净环境，结果完全一致」——
 * 能保证这一点的前提就是：格式差异<b>到此为止</b>，不允许再往下渗透。
 *
 * <p>{@link #lineNo} 是<b>原始文件中的物理行号</b>（CSV 为记录起始行，JSON 为
 * {@code groups} 数组下标 + 1）。PRD §4.4.4 要求跳过明细必须写清「第 27 行」，
 * 所以行号必须在解析阶段就固定下来——之后任何过滤、排序都不能重算它。
 *
 * @param lineNo        原始行号（1 起）
 * @param canonicalTerm 规范词原文；可能为空白（空白由计划阶段判为 SKIP，解析阶段不拦）
 * @param aliases       别名原文列表，保持文件内顺序；恒非 {@code null}
 * @param remark        备注；可为 {@code null}
 * @param status        1=启用 0=停用；缺省为启用
 */
public record SynonymParsedGroup(
        int lineNo,
        String canonicalTerm,
        List<String> aliases,
        String remark,
        Integer status) {

    /** 状态文本：启用。 */
    public static final String STATUS_TEXT_ENABLED = "enabled";
    /** 状态文本：停用。 */
    public static final String STATUS_TEXT_DISABLED = "disabled";

    /**
     * 紧凑构造：把 {@code aliases} 收敛为不可变非空列表，{@code status} 收敛为 0/1。
     *
     * <p>在这里收敛而不是在调用方，是为了让「解析产物一定是干净的」成为类型层面的保证——
     * 下游 3 个消费点（计划生成、落库、回吐未导入行）就不必各写一遍空值防御。
     */
    public SynonymParsedGroup {
        aliases = aliases == null ? List.of() : List.copyOf(aliases);
        status = status != null && status == KbSynonymStatus.DISABLED
                ? KbSynonymStatus.DISABLED
                : KbSynonymStatus.ENABLED;
    }

    /**
     * 解析状态文本。
     *
     * <p>只有明确写了 {@code disabled}（或 {@code 0}）才判停用，其余一律启用——
     * 包括拼错的 {@code disable}、{@code false} 之类。理由：导入是批量操作，
     * 「拼错一个单词导致整批术语静默停用」比「拼错后仍然启用」危险得多，
     * 后者管理员一眼能看见，前者要等到用户反馈搜不到才发现。
     *
     * @param text 状态文本；{@code null}/空白视为启用
     * @return 1=启用 0=停用
     */
    public static int parseStatus(String text) {
        if (text == null) {
            return KbSynonymStatus.ENABLED;
        }
        String trimmed = text.trim();
        if (STATUS_TEXT_DISABLED.equalsIgnoreCase(trimmed) || "0".equals(trimmed)) {
            return KbSynonymStatus.DISABLED;
        }
        return KbSynonymStatus.ENABLED;
    }

    /**
     * 状态码转文本（导出与回吐未导入行用）。
     *
     * @param status 状态码
     * @return {@code enabled} 或 {@code disabled}
     */
    public static String statusText(Integer status) {
        return status != null && status == KbSynonymStatus.DISABLED
                ? STATUS_TEXT_DISABLED
                : STATUS_TEXT_ENABLED;
    }
}
