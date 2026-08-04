package com.mis.kb.support;

import com.mis.common.core.exception.BusinessException;
import com.mis.kb.domain.model.KbResultCode;

/**
 * 知识库模块业务异常。
 *
 * <p>{@link BusinessException} 只接受 {@code ResultCode} 或裸 {@code (code, message)}，
 * 本类把模块扩展码 {@link KbResultCode} 适配为前者的 {@code (code, message)} 形式，
 * 使 Service 层仍可写 {@code throw new KbBusinessException(KbResultCode.XXX)}，
 * 并由 {@code mis-common-web} 的全局异常处理器统一转换为 {@code Result.fail}。
 */
public class KbBusinessException extends BusinessException {

    private static final long serialVersionUID = 1L;

    public KbBusinessException(KbResultCode resultCode) {
        super(resultCode.getCode(), resultCode.getMessage());
    }

    public KbBusinessException(KbResultCode resultCode, String message) {
        super(resultCode.getCode(), message);
    }
}
