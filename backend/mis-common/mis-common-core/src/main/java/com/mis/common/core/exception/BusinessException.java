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

    /**
     * 可选的结构化错误明细，序列化进响应体的 {@code data} 字段。
     *
     * <p><b>为什么需要它：</b>部分业务错误光有 {@code message} 不足以驱动前端交互。
     * 典型是知识库同义词的词条冲突（40927）——前端要拿
     * {@code {term, ownerGroupId, ownerCanonicalTerm}} 三样才能拼出
     * 「「OKR」已属于术语组「关键结果法」」并提供跳转，缺任何一样都只能显示一个无意义的井号。
     *
     * <p><b>向后兼容：</b>本字段为增量新增，默认 {@code null}；既有三个构造器签名一字未改，
     * 既有调用方行为完全不变（{@code data} 仍为 {@code null}，与改造前的响应体逐字节一致）。
     */
    private final transient Object data;

    public BusinessException(ResultCode resultCode) {
        super(resultCode.getMessage());
        this.code = resultCode.getCode();
        this.data = null;
    }

    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
        this.data = null;
    }

    public BusinessException(ResultCode resultCode, String message) {
        super(message);
        this.code = resultCode.getCode();
        this.data = null;
    }

    /**
     * 带结构化明细的业务异常。
     *
     * @param code    业务响应码
     * @param message 错误提示
     * @param data    结构化明细；可为 {@code null}
     */
    public BusinessException(int code, String message, Object data) {
        super(message);
        this.code = code;
        this.data = data;
    }

    public int getCode() {
        return code;
    }

    /**
     * 结构化错误明细。
     *
     * @return 明细对象；未携带时为 {@code null}
     */
    public Object getData() {
        return data;
    }
}
