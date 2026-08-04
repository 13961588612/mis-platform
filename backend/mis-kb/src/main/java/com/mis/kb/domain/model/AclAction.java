package com.mis.kb.domain.model;

import java.util.Arrays;

/**
 * ACL 动作枚举。
 *
 * <p>{@code read} 读取；{@code manage} 管理（增删文档/设置）；{@code acl} 授权管理。
 * 存于 {@code kb_acl.action}（VARCHAR 码值）。
 */
public enum AclAction {

    READ("read"),
    MANAGE("manage"),
    ACL("acl");

    private final String code;

    AclAction(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static boolean isValid(String code) {
        return code != null && Arrays.stream(values()).anyMatch(v -> v.code.equals(code));
    }
}
