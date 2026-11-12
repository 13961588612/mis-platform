package com.mis.adminbff.controller;

import com.mis.adminbff.config.IqdProperties;
import com.mis.adminbff.dto.iqd.IqdAskRequest;
import com.mis.adminbff.dto.iqd.IqdAskResponse;
import com.mis.adminbff.service.iqd.IqdAskFacadeService;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

/**
 * 问数 Ask 端点（BFF → Worker 编排链）。
 *
 * <p>双闸门：
 * <ol>
 *   <li><b>功能码</b>：{@code ai:chat:use}（V69 绑定；无则 40300）</li>
 *   <li><b>范围</b>：Worker ScopeResolver 空范围 → 45204（§7.2）</li>
 * </ol>
 *
 * <p>view 裁定：持有 {@code iqd:trace:view} → admin（含 SQL），否则 user（剥 SQL 键）。
 *
 * <p>SSE 帧格式（§7.3）：{@code plan_step | delta | citations | result | error | done}，
 * result 帧为唯一权威终态。BFF 1:1 透传 Worker 帧，事件名与 data 不变。
 */
@RestController
@RequestMapping("/api/v1/iqd")
public class IqdAskController {

    private static final Logger log = LoggerFactory.getLogger(IqdAskController.class);

    private final IqdAskFacadeService iqdAskFacadeService;
    private final IqdProperties properties;

    public IqdAskController(IqdAskFacadeService iqdAskFacadeService, IqdProperties properties) {
        this.iqdAskFacadeService = iqdAskFacadeService;
        this.properties = properties;
    }

    /**
     * 非流式问数（缓冲返回 AskResponse）。
     */
    @PostMapping(value = "/ask", produces = MediaType.APPLICATION_JSON_VALUE)
    public Result<IqdAskResponse> ask(
            @Valid @RequestBody IqdAskRequest req,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        try {
            return Result.ok(iqdAskFacadeService.ask(req, authorization, traceId));
        } catch (BusinessException ex) {
            // 业务异常（含下游 INTERNAL_ERROR / 40300 / 45299 等）原样透出，不吞成 50000
            IqdAskResponse resp = new IqdAskResponse();
            resp.setStatus("error");
            resp.setErrorCode(String.valueOf(ex.getCode()));
            resp.setErrorMessage(ex.getMessage());
            return Result.ok(resp);
        } catch (Exception ex) {
            log.warn("iqd ask failed, traceId={}", traceId, ex);
            IqdAskResponse resp = new IqdAskResponse();
            resp.setStatus("error");
            resp.setErrorCode("50099");
            resp.setErrorMessage("问数服务暂时不可用: " + ex.getMessage());
            return Result.ok(resp);
        }
    }

    /**
     * 流式问数（SSE）。
     *
     * <p>直接返回 {@link Flux}（勿包进 ResponseEntity.body）：Spring MVC 才能走
     * ReactiveTypeHandler 写 SSE。sseEnabled=false 时回退非流式缓冲。
     */
    @PostMapping(value = "/ask-stream", produces = {MediaType.APPLICATION_JSON_VALUE, MediaType.TEXT_EVENT_STREAM_VALUE})
    public Object askStream(
            @Valid @RequestBody IqdAskRequest req,
            @RequestHeader(value = SecurityConstants.AUTHORIZATION_HEADER, required = false) String authorization,
            @RequestHeader(value = SecurityConstants.HEADER_TRACE_ID, required = false) String traceId) {
        if (properties.isSseEnabled()) {
            return iqdAskFacadeService.askStream(req, authorization, traceId);
        }
        // 降级：非流式缓冲（客户端仍按 ask 语义消费）
        return Result.ok(iqdAskFacadeService.ask(req, authorization, traceId));
    }
}
