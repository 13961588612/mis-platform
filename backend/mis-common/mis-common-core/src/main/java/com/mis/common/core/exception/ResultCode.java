package com.mis.common.core.exception;

import com.mis.common.core.result.Result;

/**
 * 统一 API 响应码，与 {@link Result#getCode()} 一一对应。
 * <p>
 * <b>重要约定</b>（全项目统一，前后端/网关/审计日志均遵循）：
 * <ol>
 *   <li><b>{@code code == 0}</b> 表示成功；非 0 表示失败（含 {@link #SUCCESS} 以外的所有枚举值）。</li>
 *   <li><b>与 HTTP 状态码分离</b>：{@code Result.code} 为 5 位业务 int；HTTP 状态由 Controller / Gateway 另行决定。
 *       Phase 1 默认：{@link BusinessException} → HTTP 200 + body.code；认证类可由 Gateway 返回 HTTP 401。</li>
 *   <li><b>与实体 {@code code} 字段无关</b>：{@code sys_api.code}、{@code sys_menu.code}、{@code app.code}、
 *       {@code sys_dept.code} 等为层级或业务编码（多为字符串），禁止与本枚举混用。</li>
 *   <li><b>码段规划</b>（扩展时保持段位，模块内递增后两位）：
 *       <ul>
 *         <li>{@code 0} — 成功</li>
 *         <li>{@code 401xx} — 认证（未登录、Access/Refresh Token、登录失败、锁定）
 *             <ul>
 *               <li>{@code 40101 TOKEN_EXPIRED} — Access 过期，前端可尝试 refresh</li>
 *               <li>{@code 40104 TOKEN_INVALID} — Access 无效/吊销/验签失败，应重新登录</li>
 *               <li>{@code 40105 REFRESH_TOKEN_INVALID} — Refresh 无效或缺失，应重新登录</li>
 *               <li>{@code 40106 REFRESH_TOKEN_EXPIRED} — Refresh 过期，应重新登录</li>
 *             </ul>
 *         </li>
 *         <li>{@code 40300} — 权限不足</li>
 *         <li>{@code 400xx} — 参数校验、验证码等客户端错误</li>
 *         <li>{@code 40400} — 资源不存在</li>
 *         <li>{@code 409xx} — 冲突（重复创建、存在子节点等）</li>
 *         <li>{@code 50000} — 未预期系统错误</li>
 *       </ul>
 *   </li>
 *   <li><b>使用方式</b>：Service 抛 {@link BusinessException}；Controller 返回 {@link Result#fail(ResultCode)}；
 *       操作审计 {@code sys_oper_log.response_code} 记录本 code。</li>
 *   <li><b>扩展</b>：通用码保留在本枚举；模块专属码可新增 {@code XxxResultCode} 枚举，code 勿与上表冲突。</li>
 * </ol>
 *
 * @see Result
 * @see BusinessException
 */
public enum ResultCode {

    SUCCESS(0, "ok"),
    UNAUTHORIZED(40100, "未认证"),
    TOKEN_EXPIRED(40101, "Access Token 已过期"),
    LOGIN_FAILED(40102, "用户名或密码错误"),
    ACCOUNT_LOCKED(40103, "账号已锁定"),
    TOKEN_INVALID(40104, "Access Token 无效"),
    REFRESH_TOKEN_INVALID(40105, "Refresh Token 无效"),
    REFRESH_TOKEN_EXPIRED(40106, "Refresh Token 已过期"),
    FORBIDDEN(40300, "无权限"),
    NOT_FOUND(40400, "资源不存在"),
    VALIDATION_ERROR(40001, "参数校验失败"),
    CAPTCHA_INVALID(40002, "验证码错误"),
    USER_EXISTS(40901, "用户名已存在"),
    ORG_HAS_CHILDREN(40902, "存在子部门"),
    INTERNAL_ERROR(50000, "系统错误");

    private final int code;
    private final String message;

    ResultCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public int getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    public boolean isSuccess() {
        return code == SUCCESS.code;
    }

    /** 认证类失败（HTTP 通常返回 401）；前端可据此决定 refresh 或跳登录。 */
    public boolean isAuthFailure() {
        return code >= 40100 && code < 40200;
    }
}
