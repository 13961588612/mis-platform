package com.mis.adminbff.support;

import com.mis.common.core.result.Result;
import com.mis.common.web.trace.TraceContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 把「下游能力尚未实现」翻译成 <b>HTTP 501</b>，而不是让它伪装成 200 或 500。
 *
 * <h2>为什么必须单独拦一次</h2>
 * {@link DownstreamNotImplementedException} 继承自 {@code BusinessException}，
 * 若不拦截，会落到 {@code GlobalExceptionHandler#handleBusinessException} 走
 * <b>HTTP 200 + body.code=50100</b>。那条通道对普通业务错误是合理的，
 * 对「这个功能还没做」却是有害的：
 * <ul>
 *   <li>联调同学用 curl / 浏览器 Network 面板看到的是<b>绿色的 200</b>，
 *       要展开响应体才知道其实没通 —— 而 T02 交付时 §4.3 的 58 条里有 19 条处于这个状态，
 *       19 次「看起来成功」足以让人误判整个批次已经打通；</li>
 *   <li>网关、探活脚本、前端的 {@code axios} 拦截器大多只看 HTTP 状态码，
 *       200 会让它们把未完工端点当成正常端点缓存 / 计入成功率。</li>
 * </ul>
 * 501（Not Implemented）在 HTTP 语义里的定义正是「服务器不支持完成请求所需的功能」，
 * 与本场景严格对应；同时 body 里仍保留 {@code code=50100}，
 * 让按业务码判断的前端逻辑不受影响 —— 两种口径同时成立，不需要调用方二选一。
 *
 * <h2>为什么是 HIGHEST_PRECEDENCE</h2>
 * Spring 解析异常处理器时，<b>先按 {@code @ControllerAdvice} 之间的顺序</b>挑 advice，
 * 命中后才在该 advice 内部找最匹配的 {@code @ExceptionHandler}。
 * {@code GlobalExceptionHandler} 没有标注顺序，即 {@code LOWEST_PRECEDENCE}；
 * 它内部的 {@code handleBusinessException} 能接住本异常（子类可赋值给父类型）。
 * 因此只有把本 advice 排到最前，才能保证 501 分支被优先选中。
 * 依赖「子类更精确」在跨 advice 的场景下<b>不成立</b>，这一点是本注解存在的全部理由。
 *
 * <p>{@code 500} 与 {@code 501} 的区别不是文字游戏：前者要求有人去查日志、定位故障，
 * 后者只需要等 T04 排期。把两者混在一个码里，等于每次都要人工二次分诊。
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AgentOpsNotImplementedAdvice {

    private static final Logger log = LoggerFactory.getLogger(AgentOpsNotImplementedAdvice.class);

    /**
     * @param ex 下游未实现异常，{@code getDownstream()} 携带具体端点，便于日志定位
     * @return HTTP 501 + {@code {code:50100, message, traceId}}
     */
    @ExceptionHandler(DownstreamNotImplementedException.class)
    public ResponseEntity<Result<Void>> handleNotImplemented(DownstreamNotImplementedException ex) {
        // 用 info 而非 error：这是已知的排期状态，不是故障。
        // 打成 error 会污染告警基线，让真正的下游异常淹没在 19 条噪声里。
        log.info("下游能力尚未实现，返回 501：{}", ex.getDownstream());
        Result<Void> body = Result.fail(ex.getCode(), ex.getMessage());
        body.setTraceId(TraceContext.currentTraceId());
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body(body);
    }
}
