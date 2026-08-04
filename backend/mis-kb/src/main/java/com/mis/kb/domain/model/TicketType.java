package com.mis.kb.domain.model;

import java.util.Arrays;

/**
 * 工单类型（A-02c / F-10 问答一键报错）。
 *
 * <p>码值约束见 {@code V15__kb_incremental.sql} 的 {@code chk_kb_ticket_type}。
 */
public enum TicketType {

    /** 答案错误。 */
    ANSWER_ERROR("answer_error", "答案错误"),
    /** 引用错误（引用与答案不符/引用失效）。 */
    CITE_ERROR("cite_error", "引用错误"),
    /** 缺少文档（知识库无此内容）。 */
    MISSING_DOC("missing_doc", "缺少文档"),
    /** 权限问题（应可见却查不到）。 */
    PERMISSION("permission", "权限问题"),
    /** 其他。 */
    OTHER("other", "其他");

    private final String code;
    private final String label;

    TicketType(String code, String label) {
        this.code = code;
        this.label = label;
    }

    public String code() {
        return code;
    }

    public String label() {
        return label;
    }

    public static TicketType fromCode(String code) {
        if (code == null || code.isBlank()) {
            return null;
        }
        String lower = code.trim().toLowerCase();
        return Arrays.stream(values())
                .filter(v -> v.code.equals(lower))
                .findFirst()
                .orElse(null);
    }

    public static boolean isValid(String code) {
        return fromCode(code) != null;
    }
}
