package com.mis.recon.common;

/**
 * 业务异常：携带 ErrorCode 码（code+message 内聚，G2），由 GlobalExceptionHandler 统一转为 ApiResponse。
 */
public class BizException extends RuntimeException {

    private final int code;

    public BizException(ErrorCode ec) {
        super(ec.getMessage());
        this.code = ec.getCode();
    }

    public BizException(ErrorCode ec, String message) {
        super(message);
        this.code = ec.getCode();
    }

    public int getCode() {
        return code;
    }
}
