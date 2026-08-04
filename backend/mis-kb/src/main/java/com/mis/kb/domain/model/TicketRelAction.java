package com.mis.kb.domain.model;

import java.util.Arrays;

/**
 * 工单关联动作（A-02c）——运营处理工单时登记的后续动作，便于闭环追踪。
 *
 * <p>码值约束见 {@code V15__kb_incremental.sql} 的 {@code chk_kb_ticket_rel_action}。
 */
public enum TicketRelAction {

    NONE("none", "无需处理"),
    ADD_DOC("add_doc", "补充文档"),
    FIX_DOC("fix_doc", "修正文档"),
    ADJUST_ACL("adjust_acl", "调整权限"),
    ADJUST_RAG("adjust_rag", "调整RAG参数");

    private final String code;
    private final String label;

    TicketRelAction(String code, String label) {
        this.code = code;
        this.label = label;
    }

    public String code() {
        return code;
    }

    public String label() {
        return label;
    }

    public static TicketRelAction fromCode(String code) {
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
