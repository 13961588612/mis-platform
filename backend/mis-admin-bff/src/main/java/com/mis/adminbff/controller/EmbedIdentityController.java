package com.mis.adminbff.controller;

import com.mis.adminbff.dto.embed.EmbedExchangeRequest;
import com.mis.adminbff.dto.embed.EmbedExchangeResponse;
import com.mis.adminbff.service.EmbedIdentityService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * D12 嵌入身份兑换端点（POST /api/v1/embed/identity/exchange）。
 *
 * <p><b>鉴权方式与其它 /api/v1 端点不同</b>：调用方是<b>外部系统后端</b>
 * （内网/HTTPS，01-architecture §4.1 方案①），没有 MIS JWT，携带宿主自签
 * externalToken（HS256）验证身份。因此本端点已从
 * {@code ApiPermissionInterceptor}（MIS-JWT 权限拦截）中豁免
 * （见 {@code ApiPermissionConfiguration} 的 excludePathPatterns），
 * 改由 {@link EmbedIdentityService} 内部完成「externalToken 验签 + 三级映射 +
 * 签发 RS256 MIS JWT」全流程，且不登记 sys_api（登记会使外部无 MIS JWT 调用
 * 在拦截器即 401，详见交付说明）。
 *
 * <p>安全红线 R1-R6 落点在 {@code EmbedIdentityService}；本类只做参数转发。
 */
@RestController
@RequestMapping("/api/v1/embed/identity")
public class EmbedIdentityController {

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
}
