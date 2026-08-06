package com.mis.adminbff.support;

import com.mis.common.core.exception.BusinessException;

/**
 * 下游路由不存在 ⇒「能力尚未实现」。
 *
 * <p>由 {@code AgentOpsClient} 在下游返回 <b>404 / 405 / 501 且响应体不是
 * {@code {code,data,message,traceId}} 信封</b>时抛出。三个状态码的含义分别是：
 * <ul>
 *   <li><b>404</b> —— FastAPI 未注册该路径（绝大多数 T04 待建端点，例如
 *       {@code GET /api/v1/agents/{id}/config-files}）；</li>
 *   <li><b>405</b> —— 路径注册了但方法没注册。这不是理论情况：ai-platform 的
 *       {@code session.py} 只有 {@code @router.post("")}，<b>没有</b> {@code @router.get("")}，
 *       所以 §4.3 #27「会话列表」打过去拿到的是 405 而不是 404。
 *       只判 404 会让这一条漏进 {@code 50000}；</li>
 *   <li><b>501</b> —— 下游自己声明未实现。</li>
 * </ul>
 *
 * <p><b>「响应体不是信封」这个前置条件是关键。</b>ai-platform 的
 * {@code api/response.py:error_response()} 会带着<b>非 200 HTTP 状态</b>返回完整信封
 * （如 HTTP 404 + {@code {"code":40400,"message":"Skill 不存在"}}）。
 * 若只看 HTTP 状态码，「技能确实不存在」这种正常业务结果会被误报成「功能没做」，
 * 前端弹出的提示会从「技能不存在」变成「能力尚未实现」，属于误导性更强的错误。
 * 因此判定顺序恒为：<b>先看响应体有没有 {@code code} 字段，再看 HTTP 状态码</b>。
 *
 * <p>继承 {@link BusinessException} 使其天然走通既有 {@code GlobalExceptionHandler}
 * （HTTP 200 + body.code）；同时 {@code AgentOpsNotImplementedAdvice} 以更高优先级
 * 拦截本子类，改写为 HTTP 501 + body.code 50100，两种口径的消费者都能正确识别。
 */
public class DownstreamNotImplementedException extends BusinessException {

    private static final long serialVersionUID = 1L;

    /** 触发本异常的下游描述（形如 {@code GET /api/v1/agents/{id}/coordination}），仅用于日志与提示。 */
    private final String downstream;

    /**
     * @param downstream 下游端点描述，会拼进 message 供联调直接定位
     */
    public DownstreamNotImplementedException(String downstream) {
        super(AgentOpsErrorCodes.NOT_IMPLEMENTED,
                "下游能力尚未实现：" + downstream + "（该端点在 T04 批次交付，非故障）");
        this.downstream = downstream;
    }

    public String getDownstream() {
        return downstream;
    }
}
