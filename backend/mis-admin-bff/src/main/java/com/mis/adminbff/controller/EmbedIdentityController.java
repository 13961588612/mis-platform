package com.mis.adminbff.controller;

import com.mis.adminbff.dto.embed.EmbedExchangeRequest;
import com.mis.adminbff.dto.embed.EmbedExchangeResponse;
import com.mis.adminbff.dto.embed.EmbedTicketExchangeRequest;
import com.mis.adminbff.service.EmbedIdentityService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * D12 嵌入身份兑换端点。
 *
 * <ul>
 *   <li>{@code POST /exchange}：外部系统后端自签 externalToken（无 MIS JWT）</li>
 *   <li>{@code POST /ticket-exchange}：MIS embed 同源页传 ticket，BFF 出站验票（无 MIS JWT）</li>
 * </ul>
 *
 * <p>二者均从 {@code ApiPermissionInterceptor} 豁免；安全落点在 {@link EmbedIdentityService}。
 */
@RestController
@RequestMapping("/api/v1/embed/identity")
public class EmbedIdentityController {

    private static final Logger log = LoggerFactory.getLogger(EmbedIdentityController.class);

    private final EmbedIdentityService embedIdentityService;

    public EmbedIdentityController(EmbedIdentityService embedIdentityService) {
        this.embedIdentityService = embedIdentityService;
    }

    /**
     * 外部身份兑换：externalToken → MIS userId（三级映射）→ 短时 RS256 MIS JWT。
     *
     * @param request 兑换请求（hostId + externalToken + 冗余身份字段）
     * @return {@code { code: 0, data: { misJwt, expiresIn, mappedUserId, mappedBy, permissions } }}
     */
    @PostMapping("/exchange")
    public Result<EmbedExchangeResponse> exchange(@Valid @RequestBody EmbedExchangeRequest request) {
        return Result.ok(embedIdentityService.exchange(request));
    }

    /**
     * Ticket 兑换：hostId + ticket → 出站验票 → 三级映射 → 短时 RS256 MIS JWT。
     */
    @PostMapping("/ticket-exchange")
    public Result<EmbedExchangeResponse> ticketExchange(
            @Valid @RequestBody EmbedTicketExchangeRequest request) {
        String hostId = request.hostId() == null ? "" : request.hostId().trim();
        log.info("embed ticket-exchange http: hostId={}", hostId);
        return Result.ok(embedIdentityService.exchangeByTicket(request));
    }
}
