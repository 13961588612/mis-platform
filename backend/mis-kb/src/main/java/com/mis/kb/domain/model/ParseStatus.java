package com.mis.kb.domain.model;

import java.util.Arrays;

/**
 * 文档解析状态。
 *
 * <p>{@code pending} 待解析；{@code parsing} 解析中；{@code success} 成功；{@code failed} 失败。
 * 存于 {@code kb_document.parse_status}（VARCHAR 码值）。
 */
public enum ParseStatus {

    PENDING("pending"),
    PARSING("parsing"),
    SUCCESS("success"),
    FAILED("failed");

    private final String code;

    ParseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static boolean isValid(String code) {
        return code != null && Arrays.stream(values()).anyMatch(v -> v.code.equals(code));
    }
}
