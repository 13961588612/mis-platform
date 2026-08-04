package com.mis.kb.domain.model;

/**
 * 知识库启停状态（对应 {@code kb_library.status} SMALLINT）。
 *
 * <p>{@code ENABLED=1} 启用（参与可见性计算）；{@code DISABLED=0} 停用（即使普通级/已授权也不可见）。
 */
public enum LibraryStatus {

    ENABLED(1),
    DISABLED(0);

    private final int code;

    LibraryStatus(int code) {
        this.code = code;
    }

    public int code() {
        return code;
    }

    public static boolean isEnabled(int code) {
        return ENABLED.code == code;
    }
}
