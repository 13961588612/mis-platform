package com.mis.adminbff.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.config.AiPlatformTrustConfig;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.common.security.jwt.JwtAuthenticationException;
import com.mis.common.security.jwt.JwtClaims;
import com.mis.common.security.jwt.PemPublicKeyLoader;
import com.mis.common.security.jwt.RsaJwtVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
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
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 反向身份信任拦截器（设计 §3 决策3 / Q3）。
 *
 * <p>仅作用于 {@code /api/v1/ai/skill/execute} 与 {@code /api/v1/ai/skill/apply} 两个反向端点，
 * 采用「平台服务凭证 + 用户 MIS JWT 委托」双因子，镜像 identity-jwt.md 的正向信任模型：
 * <ol>
 *   <li>因子一：校验 {@code X-Platform-Token}（与 ai-platform 共享密钥）。</li>
 *   <li>因子三：校验来源 IP 是否位于 {@code trusted-network} 信任域（若已配置）。</li>
 *   <li>因子二：验签 {@code X-Mis-Upstream-Jwt}（RS256，iss=mis-platform）取出 userId/tenantId；
 *       缺 JWT 时降级为 {@code X-User-Id}/{@code X-Tenant-Id} 头（design §9.2.6 临时替代）。</li>
 * </ol>
 *
 * <p>双模式：缺 {@code X-Platform-Token} 视为普通网关调用（mis-admin-web），放行交由既有
 * {@code ApiPermissionInterceptor} 处理，本拦截器不干预——保持既有前端行为零改动。
 *
 * <p>校验失败时直接写回 <strong>HTTP 401</strong> + {@code Result} 形态 JSON，并终止请求。
 */
@Component
public class ReverseTrustInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(ReverseTrustInterceptor.class);

    /** 反向信任解析结果在请求属性中的键（供 Controller 读取）。 */
    public static final String ATTRIBUTE_NAME = "com.mis.adminbff.security.ReverseTrustContext";

    /** 标记本拦截器是否已写入 SecurityContextHolder，用于 afterCompletion 精准清理。 */
    private static final String ATTR_TRUST_APPLIED = "com.mis.adminbff.security.ReverseTrustApplied";

    private static final String HEADER_PLATFORM_TOKEN = "X-Platform-Token";
    private static final String HEADER_UPSTREAM_JWT = "X-Mis-Upstream-Jwt";
    private static final String HEADER_CHANNEL = "X-Channel";

    /** 反向调用所需权限（覆盖写类端点 ai:*:use，确保既有 PEP 通过）。 */
    private static final Set<String> REVERSE_PERMISSIONS = Set.of("ai:*:use");

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private final AiPlatformTrustConfig trustConfig;

    /** 缓存已构建的 JWT 验签器（公钥变更时才重建）。 */
    private volatile RsaJwtVerifier cachedVerifier;
    private String cachedKey;

    public ReverseTrustInterceptor(AiPlatformTrustConfig trustConfig) {
        this.trustConfig = trustConfig;
    }

    @Override
    public boolean preHandle(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull Object handler) throws Exception {
        if (!trustConfig.isReverseTrustEnabled()) {
            return true;
        }

        String platformToken = request.getHeader(HEADER_PLATFORM_TOKEN);
        // 双模式：无平台凭证 → 普通网关调用，交由既有 PEP 处理，本拦截器不干预。
        if (platformToken == null || platformToken.isBlank()) {
            return true;
        }

        // 因子一：校验共享服务凭证
        String expectedToken = trustConfig.getServiceToken();
        if (expectedToken == null || expectedToken.isBlank()) {
            log.warn("反向信任未配置 service-token，拒绝调用 path={}", request.getRequestURI());
            return writeUnauthorized(response, "反向信任服务凭证未配置");
        }
        if (!constantTimeEquals(platformToken, expectedToken)) {
            log.warn("反向信任服务凭证不匹配 path={}", request.getRequestURI());
            return writeUnauthorized(response, "无效的反向调用平台凭证");
        }

        // 因子三：校验来源网段（若配置）
        String trustedNetwork = trustConfig.getTrustedNetwork();
        if (trustedNetwork != null && !trustedNetwork.isBlank()
                && !isInTrustedNetwork(request.getRemoteAddr(), trustedNetwork)) {
            log.warn("反向调用来源不在信任域 ip={} path={}", request.getRemoteAddr(), request.getRequestURI());
            return writeUnauthorized(response, "调用来源不在信任域");
        }

        // 因子二：解析委托用户身份（JWT 优先，缺则降级到 X-User-Id 头）
        ReverseTrustContext ctx;
        try {
            ctx = resolveIdentity(request);
        } catch (JwtAuthenticationException ex) {
            log.warn("上游 JWT 验签失败: {}", ex.getMessage());
            return writeUnauthorized(response, "上游用户 JWT 验签失败");
        } catch (IllegalArgumentException ex) {
            log.warn("反向信任身份解析失败: {}", ex.getMessage());
            return writeUnauthorized(response, ex.getMessage());
        }

        // 写入请求属性 + SecurityContextHolder（供 PEP 与下游写处理器复用委托身份）
        request.setAttribute(ATTRIBUTE_NAME, ctx);
        LoginUser loginUser = new LoginUser();
        loginUser.setUserId(ctx.userId());
        loginUser.setTenantId(ctx.tenantId());
        loginUser.setUsername(ctx.username());
        loginUser.setPermissions(REVERSE_PERMISSIONS);
        SecurityContextHolder.setLoginUser(loginUser);
        request.setAttribute(ATTR_TRUST_APPLIED, Boolean.TRUE);
        return true;
    }

    @Override
    public void afterCompletion(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull Object handler,
            Exception ex) {
        // 仅清理本拦截器写入的上下文，不触碰网关注入的上下文。
        if (Boolean.TRUE.equals(request.getAttribute(ATTR_TRUST_APPLIED))) {
            SecurityContextHolder.clear();
        }
    }

    // ===== 身份解析 =====

    private ReverseTrustContext resolveIdentity(HttpServletRequest request) {
        String upstreamJwt = request.getHeader(HEADER_UPSTREAM_JWT);
        if (upstreamJwt == null || upstreamJwt.isBlank()) {
            String auth = request.getHeader(SecurityConstants.AUTHORIZATION_HEADER);
            if (auth != null && auth.startsWith(SecurityConstants.BEARER_PREFIX)) {
                upstreamJwt = auth.substring(SecurityConstants.BEARER_PREFIX.length()).trim();
            }
        }

        if (upstreamJwt != null && !upstreamJwt.isBlank()) {
            // 因子二（主）：验签委托 MIS JWT
            String publicKey = trustConfig.getMisJwtPublicKey();
            if (publicKey == null || publicKey.isBlank()) {
                throw new IllegalArgumentException("未配置上游 JWT 公钥（mis.ai-platform.mis-jwt-public-key）");
            }
            JwtClaims claims = verifier().verify(upstreamJwt);
            // 签发方强校验（RsaJwtVerifier 不校验 iss，这里补验）
            String issuer = extractIssuer(upstreamJwt);
            if (issuer == null || !issuer.equals(trustConfig.getMisJwtIssuer())) {
                throw new IllegalArgumentException("上游 JWT 签发方不符，期望 " + trustConfig.getMisJwtIssuer());
            }
            if (claims.tenantId() == null) {
                throw new IllegalArgumentException("上游 JWT 缺少 tenantId");
            }
            return new ReverseTrustContext(
                    claims.userId(),
                    claims.tenantId(),
                    claims.username(),
                    request.getHeader(HEADER_CHANNEL),
                    true,
                    request.getRemoteAddr());
        }

        // 因子二（降级，design §9.2.6）：使用 X-User-Id / X-Tenant-Id 头
        String userIdStr = request.getHeader(SecurityConstants.HEADER_USER_ID);
        String tenantIdStr = request.getHeader(SecurityConstants.HEADER_TENANT_ID);
        if (userIdStr == null || userIdStr.isBlank()
                || tenantIdStr == null || tenantIdStr.isBlank()) {
            throw new IllegalArgumentException("缺少委托用户身份（上游 JWT 或 X-User-Id/X-Tenant-Id）");
        }
        Long userId = parseLong(userIdStr, SecurityConstants.HEADER_USER_ID);
        Long tenantId = parseLong(tenantIdStr, SecurityConstants.HEADER_TENANT_ID);
        return new ReverseTrustContext(
                userId,
                tenantId,
                request.getHeader(SecurityConstants.HEADER_USERNAME),
                request.getHeader(HEADER_CHANNEL),
                false,
                request.getRemoteAddr());
    }

    private RsaJwtVerifier verifier() {
        String key = trustConfig.getMisJwtPublicKey();
        RsaJwtVerifier v = cachedVerifier;
        if (v != null && key.equals(cachedKey)) {
            return v;
        }
        synchronized (this) {
            if (cachedVerifier != null && key.equals(cachedKey)) {
                return cachedVerifier;
            }
            RsaJwtVerifier built = new RsaJwtVerifier(PemPublicKeyLoader.load(key));
            cachedVerifier = built;
            cachedKey = key;
            return built;
        }
    }

    private static String extractIssuer(String jwt) {
        try {
            JWTClaimsSet claims = SignedJWT.parse(jwt).getJWTClaimsSet();
            return claims.getIssuer();
        } catch (Exception ex) {
            throw new JwtAuthenticationException(ResultCode.TOKEN_INVALID, "无法解析上游 JWT", ex);
        }
    }

    private static Long parseLong(String value, String name) {
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("非法的 " + name + " 值: " + value);
        }
    }

    // ===== 工具 =====

    /** 常量时间比较，避免共享密钥被时序侧信道攻击。 */
    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        byte[] ab = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        int diff = ab.length ^ bb.length;
        int min = Math.min(ab.length, bb.length);
        for (int i = 0; i < min; i++) {
            diff |= (ab[i] ^ bb[i]);
        }
        return diff == 0;
    }

    /** IPv4 CIDR 归属判断（仅支持 IPv4；IPv6 / 非法输入返回 false）。 */
    private static boolean isInTrustedNetwork(String ip, String cidr) {
        try {
            String[] parts = cidr.split("/", 2);
            int maskBits = Integer.parseInt(parts[1].trim());
            long ipLong = ipToLong(ip);
            long netLong = ipToLong(parts[0].trim());
            if (ipLong < 0 || netLong < 0 || maskBits < 0 || maskBits > 32) {
                return false;
            }
            long mask = (maskBits == 0) ? 0L : (0xFFFFFFFFL << (32 - maskBits)) & 0xFFFFFFFFL;
            return (ipLong & mask) == (netLong & mask);
        } catch (Exception ex) {
            log.warn("信任域配置非法 cidr={}: {}", cidr, ex.getMessage());
            return false;
        }
    }

    private static long ipToLong(String ip) {
        if (ip == null || ip.contains(":")) {
            return -1; // 仅支持 IPv4
        }
        String[] octets = ip.trim().split("\\.");
        if (octets.length != 4) {
            return -1;
        }
        long result = 0;
        for (String octet : octets) {
            int v = Integer.parseInt(octet);
            if (v < 0 || v > 255) {
                return -1;
            }
            result = (result << 8) | v;
        }
        return result & 0xFFFFFFFFL;
    }

    /** 写回 HTTP 401 + Result 形态 JSON，并终止请求。 */
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
