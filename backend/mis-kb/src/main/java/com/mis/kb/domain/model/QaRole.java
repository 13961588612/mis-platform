package com.mis.kb.domain.model;

/**
 * 问答消息角色。role ∈ {user, assistant}。
 */
public enum QaRole {

    USER("user"),
    ASSISTANT("assistant");

    private final String code;

    QaRole(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static boolean isValid(String role) {
        if (role == null) {
            return false;
        }
        for (QaRole value : values()) {
            if (value.code.equals(role)) {
                return true;
            }
        }
        return false;
    }
}
