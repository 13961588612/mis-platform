package com.mis.kb.domain.model;

import java.util.Arrays;

/**
 * 检索空结果策略（F-06）。
 *
 * <p>当召回为空（或全部低于阈值）时，决定问答链路的兜底行为：
 * <ul>
 *   <li>{@link #SUGGEST} —— 返回「未找到」提示并附带推荐相关问题（默认）</li>
 *   <li>{@link #EMPTY}   —— 直接返回空答案，不做任何补偿</li>
 *   <li>{@link #TRANSFER}—— 引导转人工，前端提示提交工单</li>
 * </ul>
 *
 * <p>码值存于 {@code kb_library.rag_settings_json} 的 {@code emptyResultStrategy} 字段（大写）。
 */
public enum EmptyResultStrategy {

    SUGGEST("SUGGEST"),
    EMPTY("EMPTY"),
    TRANSFER("TRANSFER");

    private final String code;

    EmptyResultStrategy(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    /**
     * 由码值解析枚举。
     *
     * @param code 码值（大小写不敏感）
     * @return 匹配的枚举；{@code null}/非法值一律回退 {@link #SUGGEST}
     */
    public static EmptyResultStrategy fromCode(String code) {
        if (code == null || code.isBlank()) {
            return SUGGEST;
        }
        String upper = code.trim().toUpperCase();
        return Arrays.stream(values())
                .filter(v -> v.code.equals(upper))
                .findFirst()
                .orElse(SUGGEST);
    }

    /**
     * 归一化码值，用于持久化前的清洗。
     *
     * @param code 原始码值
     * @return 合法大写码值，非法输入回退 {@code "SUGGEST"}
     */
    public static String normalize(String code) {
        return fromCode(code).code();
    }

    /** 校验码值是否合法（不做回退，供参数校验使用）。 */
    public static boolean isValid(String code) {
        return code != null && Arrays.stream(values())
                .anyMatch(v -> v.code.equalsIgnoreCase(code.trim()));
    }
}
