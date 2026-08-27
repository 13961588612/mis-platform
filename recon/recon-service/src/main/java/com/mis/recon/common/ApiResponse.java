package com.mis.recon.common;

import lombok.Data;

/**
 * 统一响应体（G1）：HTTP 恒为 200，业务成败由 code 表达（0=成功，非 0=ErrorCode）。
 */
@Data
public class ApiResponse<T> {
    private int code;
    private T data;
    private String message;

    public static <T> ApiResponse<T> ok() {
        return ok(null);
    }

    public static <T> ApiResponse<T> ok(T data) {
        ApiResponse<T> r = new ApiResponse<>();
        r.code = 0;
        r.data = data;
        return r;
    }

    public static <T> ApiResponse<T> fail(int code, String message) {
        ApiResponse<T> r = new ApiResponse<>();
        r.code = code;
        r.message = message;
        return r;
    }

    public static <T> ApiResponse<T> fail(ErrorCode ec) {
        return fail(ec.getCode(), ec.getMessage());
    }
}
