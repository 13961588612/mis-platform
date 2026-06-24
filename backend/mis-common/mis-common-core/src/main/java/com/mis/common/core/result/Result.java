package com.mis.common.core.result;

import com.mis.common.core.exception.ResultCode;

import java.io.Serializable;

/**
 * 统一 API 响应包装（见 {@code docs/api/api-specification.md} §1.2）。
 * <p>
 * {@link #code} 为业务响应码，定义见 {@link ResultCode}；{@code code == 0} 表示成功。
 * {@link #traceId} 由 Web 层 / Gateway 在写出响应前填充，对应 {@code X-Trace-Id}。
 */
public class Result<T> implements Serializable {

    private int code;
    private String message;
    private T data;
    private String traceId;

    public Result() {
    }

    public Result(int code, String message, T data, String traceId) {
        this.code = code;
        this.message = message;
        this.data = data;
        this.traceId = traceId;
    }

    public static <T> Result<T> ok() {
        return ok(null);
    }

    public static <T> Result<T> ok(T data) {
        return new Result<>(ResultCode.SUCCESS.getCode(), ResultCode.SUCCESS.getMessage(), data, null);
    }

    public static <T> Result<T> fail(int code, String message) {
        return new Result<>(code, message, null, null);
    }

    public static <T> Result<T> fail(ResultCode resultCode) {
        return fail(resultCode.getCode(), resultCode.getMessage());
    }

    public int getCode() {
        return code;
    }

    public void setCode(int code) {
        this.code = code;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public T getData() {
        return data;
    }

    public void setData(T data) {
        this.data = data;
    }

    public String getTraceId() {
        return traceId;
    }

    public void setTraceId(String traceId) {
        this.traceId = traceId;
    }

    public boolean isSuccess() {
        return code == ResultCode.SUCCESS.getCode();
    }
}
