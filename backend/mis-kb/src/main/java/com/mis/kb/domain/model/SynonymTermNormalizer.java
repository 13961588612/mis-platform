package com.mis.kb.domain.model;

import java.text.Normalizer;
import java.util.Locale;

/**
 * 词条归一化与匹配边界工具（Wave D）。
 *
 * <p><b>归一化口径（主理人裁决 U4，已推翻设计文档 §8.1-U4 的原口径）：</b>
 * <pre>
 * normalize(s) = trim  →  Normalizer.normalize(s, Form.NFKC)  →  toLowerCase(Locale.ROOT)
 * </pre>
 *
 * <p>为什么加 NFKC：全角「ＯＫＲ」与半角「OKR」在用户眼里是同一个词，中文输入法下
 * 全角英文是高频误输入。NFKC 是 JDK 标准库能力（{@code java.text.Normalizer}），
 * <b>零新增依赖</b>，代价只有一行。
 *
 * <p><b>边界（明确不做的事）：</b>NFKC <b>不做繁简折叠</b>。
 * {@code normalize("軟體") != normalize("软件")}，这是既定行为，不是缺陷。
 * 繁简折叠需要额外词表且会改变唯一性约束的语义（「我明明没录过这个词」类困惑），
 * 超出本波次范围。
 *
 * <p><b>为什么 {@code toLowerCase} 放在 NFKC 之后：</b>NFKC 会把兼容字符
 * （如全角字母、罗马数字符号、上标数字）折叠成基本形式，折叠后再统一小写，
 * 才能保证「Ｏ」→「O」→「o」这条链完整走通。顺序反了会漏掉一部分字符。
 *
 * <p>{@code term_norm} 是数据库唯一约束的载体（{@code uk_synonym_term_norm}，
 * <b>不带 status 条件</b>，Q3 裁决：停用仍占用），因此本方法的输出必须是稳定、幂等的。
 */
public final class SynonymTermNormalizer {

    private SynonymTermNormalizer() {
    }

    /**
     * 归一化词条：{@code trim → NFKC → toLowerCase(Locale.ROOT)}。
     *
     * <p>幂等：{@code normalize(normalize(x)).equals(normalize(x))}。
     *
     * @param raw 录入原文，可为 {@code null}
     * @return 归一化词形；入参为 {@code null} 时返回空串（不返回 null，省掉下游判空）
     */
    public static String normalize(String raw) {
        if (raw == null) {
            return "";
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return "";
        }
        // NFKC：兼容分解 + 标准合成。全角 → 半角、上下标 → 基本字符、部分符号 → 规范形式。
        String folded = Normalizer.normalize(trimmed, Normalizer.Form.NFKC);
        // 折叠后可能出现新的首尾空白（如全角空格 U+3000 被折成半角空格），再 trim 一次。
        return folded.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * 词条是否短于参与自动匹配的门槛。
     *
     * @param norm 已归一化的词形
     * @param min  最小长度门槛（{@code SynonymBudget.minTermLength}）
     * @return 空或长度小于 {@code min} 返回 {@code true}
     */
    public static boolean tooShort(String norm, int min) {
        return norm == null || norm.isEmpty() || norm.length() < min;
    }

    /**
     * 是否为纯 ASCII 单词（字母 / 数字 / 下划线 / 连字符）。
     *
     * <p>只有这类词才需要做词边界校验 —— 中文没有天然分隔符，强行要求边界会导致
     * 「请假流程」里的「请假」匹配不上。
     *
     * @param norm 已归一化的词形
     * @return 全部字符落在 ASCII 词字符集内返回 {@code true}；空串返回 {@code false}
     */
    public static boolean isAsciiWord(String norm) {
        if (norm == null || norm.isEmpty()) {
            return false;
        }
        for (int i = 0; i < norm.length(); i++) {
            if (!isAsciiWordChar(norm.charAt(i))) {
                return false;
            }
        }
        return true;
    }

    /**
     * 校验 ASCII 词在原文中的匹配区间是否落在词边界上。
     *
     * <p>存在理由（D6-3）：词条 {@code IT} 若不校验边界，会命中 {@code WITH} 中间的
     * {@code IT}，把「WITH 语句怎么写」扩成一堆 IT 部门相关的噪声词。
     *
     * @param text  被扫描的原文
     * @param start 匹配区间起点（含）
     * @param end   匹配区间终点（不含）
     * @return 前一字符与后一字符均非 ASCII 词字符（或已越界）返回 {@code true}
     */
    public static boolean boundaryOk(String text, int start, int end) {
        if (text == null || start < 0 || end > text.length() || start >= end) {
            return false;
        }
        if (start > 0 && isAsciiWordChar(text.charAt(start - 1))) {
            return false;
        }
        return end >= text.length() || !isAsciiWordChar(text.charAt(end));
    }

    /** ASCII 词字符集：字母、数字、下划线、连字符。 */
    private static boolean isAsciiWordChar(char c) {
        return (c >= 'a' && c <= 'z')
                || (c >= 'A' && c <= 'Z')
                || (c >= '0' && c <= '9')
                || c == '_'
                || c == '-';
    }
}
