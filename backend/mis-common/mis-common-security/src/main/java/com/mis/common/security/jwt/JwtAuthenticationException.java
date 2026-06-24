package com.mis.common.security.jwt;

import com.mis.common.core.exception.ResultCode;

/**
 * JWT 验签或解析失败；{@link #getResultCode()} 写入 {@link com.mis.common.core.result.Result#code}。
 */
public class JwtAuthenticationException extends RuntimeException {

    private final ResultCode resultCode;

    public JwtAuthenticationException(ResultCode resultCode, String message) {
        super(message);
        this.resultCode = resultCode;
    }

    public JwtAuthenticationException(ResultCode resultCode, String message, Throwable cause) {
        super(message, cause);
        this.resultCode = resultCode;
    }

    public ResultCode getResultCode() {
        return resultCode;
    }
}
