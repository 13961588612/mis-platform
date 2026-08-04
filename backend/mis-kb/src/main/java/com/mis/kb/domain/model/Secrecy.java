package com.mis.kb.domain.model;

import java.util.Arrays;

/**
 * 知识库密级码值。
 *
 * <p>复用 {@code sys_dict}（type={@code kb_secrecy}）的 {@code value}；{@code kb_library.secrecy}
 * 存该码值（应用层校验字典存在，详见系统设计与 §13 裁定）。仅 {@link #PUBLIC} 全员可读，
 * 其余须通过 {@code kb_acl} 显式授予 {@code read} 权限。
 */
public enum Secrecy {

    PUBLIC("public"),
    INTERNAL("internal"),
    SECRET("secret"),
    CONFIDENTIAL("confidential");

    private final String code;

    Secrecy(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    /** 校验码值是否合法（对应 sys_dict kb_secrecy 的 4 个 value）。 */
    public static boolean isValid(String code) {
        return code != null && Arrays.stream(values()).anyMatch(v -> v.code.equals(code));
    }

    /** 是否为全员可读的普通级。 */
    public static boolean isPublic(String code) {
        return PUBLIC.code.equals(code);
    }
}
