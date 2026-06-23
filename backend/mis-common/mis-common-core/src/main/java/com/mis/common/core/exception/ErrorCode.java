package com.mis.common.core.exception;

/**
 * 业务错误码。
 */
public enum ErrorCode {

    SUCCESS(0, "ok"),
    UNAUTHORIZED(40100, "未认证"),
    TOKEN_EXPIRED(40101, "Token 已过期"),
    FORBIDDEN(40300, "无权限"),
    NOT_FOUND(40400, "资源不存在"),
    USER_EXISTS(40901, "用户名已存在"),
    ORG_HAS_CHILDREN(40902, "存在子部门"),
    INTERNAL_ERROR(50000, "系统错误");

    private final int code;
    private final String message;

    ErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public int getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }
}
