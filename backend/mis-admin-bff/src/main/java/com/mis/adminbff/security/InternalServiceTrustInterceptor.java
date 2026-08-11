package com.mis.adminbff.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.config.AiPlatformTrustConfig;
import com.mis.common.core.exception.ResultCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * {@code /internal/**} 服务间端点的<b>严格</b>信任闸门。
 *
 * <p>与 {@link ReverseTrustInterceptor} 的关键差异（别把两者合并）：
 * <ul>
 *   <li><b>凭证不是可选的。</b>{@code ReverseTrustInterceptor} 是「双模式」——
 *       缺 {@code X-Platform-Token} 就视为普通网关调用直接放行，交给
 *       {@code ApiPermissionInterceptor}（只挂在 {@code /api/v1/**}）兜底。
 *       {@code /internal/**} <b>不在</b> {@code /api/v1/**} 之下，也不在
 *       {@code mis-gateway} 的路由表里（网关只把 {@code /api/v1/**} 转给 BFF），
 *       所以那套「放行交给下一道闸门」在这里没有下一道闸门 —— 放行 = 裸奔。
 *       因此本拦截器：缺凭证 / 凭证不符 / 服务端未配置凭证，一律 401。</li>
 *   <li><b>不受 {@code reverse-trust-enabled} 开关影响。</b>那个开关是给反向写端点
 *       「退化为仅依赖网关 PEP」用的；{@code /internal/**} 没有网关 PEP 可退，
 *       关掉它就等于把权限码查询接口对内网裸放。本闸门恒生效。</li>
 *   <li><b>不解析委托用户身份。</b>{@code /internal/permissions} 是「查<i>某个</i>
 *       userId 的权限码」的只读查询，主体由查询参数给出，调用方并不以该用户身份行事，
 *       所以不需要（也不该要求）{@code X-Mis-Upstream-Jwt}。工具执行链路（E1–E5）
 *       本来就没有端用户 JWT，强求 JWT 会让权限闸门永远 fail-closed —— 那正是本次
 *       要修的故障。身份因子由「共享服务凭证 + 来源网段」两因子承担。</li>
 * </ul>
 *
 * <p>复用 {@link AiPlatformTrustConfig} 的 {@code service-token} 与
 * {@code trusted-network}，与反向信任同一份密钥、同一个信任域，不新造鉴权体系。
 */
@Component
public class InternalServiceTrustInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(InternalServiceTrustInterceptor.class);

    private static final String HEADER_PLATFORM_TOKEN = "X-Platform-Token";

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private final AiPlatformTrustConfig trustConfig;

    public InternalServiceTrustInterceptor(AiPlatformTrustConfig trustConfig) {
        this.trustConfig = trustConfig;
    }

    @Override
    public boolean preHandle(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull Object handler) throws Exception {
        String expectedToken = trustConfig.getServiceToken();
        if (expectedToken == null || expectedToken.isBlank()) {
            // 服务端没配密钥 ⇒ 无法判定调用方可信 ⇒ 拒绝（绝不「没配就放行」）。
            log.warn("内部端点未配置 service-token，拒绝调用 path={}", request.getRequestURI());
            return writeUnauthorized(response, "内部服务凭证未配置");
        }

        String platformToken = request.getHeader(HEADER_PLATFORM_TOKEN);
        if (platformToken == null || platformToken.isBlank()) {
            log.warn("内部端点缺少 {} path={} ip={}",
                    HEADER_PLATFORM_TOKEN, request.getRequestURI(), request.getRemoteAddr());
            return writeUnauthorized(response, "缺少内部服务凭证");
        }
        if (!ServiceTrustSupport.constantTimeEquals(platformToken, expectedToken)) {
            log.warn("内部端点服务凭证不匹配 path={} ip={}",
                    request.getRequestURI(), request.getRemoteAddr());
            return writeUnauthorized(response, "无效的内部服务凭证");
        }

        String trustedNetwork = trustConfig.getTrustedNetwork();
        if (trustedNetwork != null && !trustedNetwork.isBlank()
                && !ServiceTrustSupport.isInTrustedNetwork(request.getRemoteAddr(), trustedNetwork)) {
            log.warn("内部端点来源不在信任域 ip={} path={}",
                    request.getRemoteAddr(), request.getRequestURI());
            return writeUnauthorized(response, "调用来源不在信任域");
        }

        return true;
    }

    /**
     * 写回 HTTP 401 + {@code Result} 形态 JSON，并终止请求。
     *
     * <p>刻意用<b>非 2xx</b>：调用方 {@code MisPermissionResolver._fetch_from_bff} 据此
     * 判定「权限源不可用」并 fail-closed 拒绝执行，而不是把它误读成「该用户没有权限码」。
     *
     * @param response HTTP 响应
     * @param message  拒绝原因（面向运维，不含密钥内容）
     * @return 恒为 {@code false}，表示中断处理链
     */
    private static boolean writeUnauthorized(HttpServletResponse response, String message) {
        try {
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding("UTF-8");
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("code", ResultCode.UNAUTHORIZED.getCode());
            body.put("message", message);
            response.getWriter().write(OBJECT_MAPPER.writeValueAsString(body));
            response.getWriter().flush();
        } catch (IOException ignored) {
            // best effort
        }
        return false;
    }
}
