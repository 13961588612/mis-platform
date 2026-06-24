package com.mis.common.core.exception;

import com.mis.common.core.result.Result;

/**
 * 可预期的业务异常，由 {@code mis-common-web} 全局异常处理器转换为 {@link Result}。
 * <p>
 * {@link #getCode()} 取值必须来自 {@link ResultCode}（或与之不冲突的模块扩展码），
 * 对应响应 JSON 的 {@code code} 字段，而非 HTTP 状态码。
 */
public class BusinessException extends RuntimeException {

    private final int code;

    public BusinessException(ResultCode resultCode) {
        super(resultCode.getMessage());
        this.code = resultCode.getCode();
    }

    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
    }

    public BusinessException(ResultCode resultCode, String message) {
        super(message);
        this.code = resultCode.getCode();
    }

    public int getCode() {
        return code;
    }
}
