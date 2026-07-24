package com.mis.auth.controller;

import com.mis.auth.config.AuthProperties;
import com.mis.auth.dto.CaptchaResponse;
import com.mis.auth.dto.ChangePasswordRequest;
import com.mis.auth.dto.LoginClientInfo;
import com.mis.auth.dto.LoginRequest;
import com.mis.auth.dto.RefreshRequest;
import com.mis.auth.dto.TokenResponse;
import com.mis.auth.service.AuthService;
import com.mis.auth.service.CaptchaService;
import com.mis.auth.service.RefreshTokenService;
import com.mis.common.core.result.Result;
import com.mis.common.security.jwt.JwtProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

/**
 * 认证 HTTP 接口。
 * <p>
 * 同时映射 {@code /api/v1/auth}（经 Gateway 对外）与 {@code /internal/v1/auth}（供未来 BFF 聚合）。
 * <p>
 * Refresh Token 通过 HttpOnly Cookie 下发，属性见 {@link AuthProperties#getCookie()}（ADR-002）。
 */
@RestController
@RequestMapping({"/internal/v1/auth", "/api/v1/auth"})
public class AuthController {

    private final AuthService authService;
    private final CaptchaService captchaService;
    private final RefreshTokenService refreshTokenService;
    private final AuthProperties authProperties;
    private final JwtProperties jwtProperties;

    public AuthController(
            AuthService authService,
            CaptchaService captchaService,
            RefreshTokenService refreshTokenService,
            AuthProperties authProperties,
            JwtProperties jwtProperties) {
        this.authService = authService;
        this.captchaService = captchaService;
        this.refreshTokenService = refreshTokenService;
        this.authProperties = authProperties;
        this.jwtProperties = jwtProperties;
    }

    @GetMapping("/captcha")
    public Result<CaptchaResponse> captcha() {
        return Result.ok(captchaService.generate());
    }

    @PostMapping("/login")
    public ResponseEntity<Result<com.mis.auth.dto.LoginResponse>> login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpRequest) {
        AuthService.LoginResult result = authService.login(request, clientInfo(httpRequest));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshCookie(result.appCode(), result.refreshToken()).toString())
                .body(Result.ok(result.response()));
    }

    @PostMapping("/refresh")
    public ResponseEntity<Result<TokenResponse>> refresh(
            @RequestBody(required = false) RefreshRequest request,
            HttpServletRequest httpRequest) {
        String refreshToken = resolveRefreshToken(request, httpRequest);
        AuthService.RefreshResult result = authService.refresh(refreshToken);
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshCookie(result.appCode(), result.refreshToken()).toString())
                .body(Result.ok(result.response()));
    }

    @PostMapping("/logout")
    public ResponseEntity<Result<Void>> logout(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @RequestBody(required = false) RefreshRequest request,
            HttpServletRequest httpRequest) {
        authService.logout(authorization, resolveRefreshToken(request, httpRequest));
        String prefix = authProperties.getRefreshCookiePrefix();
        if (httpRequest.getCookies() != null) {
            for (Cookie cookie : httpRequest.getCookies()) {
                if (cookie.getName().startsWith(prefix)) {
                    return ResponseEntity.ok()
                            .header(HttpHeaders.SET_COOKIE, clearCookie(cookie.getName()).toString())
                            .body(Result.ok());
                }
            }
        }
        return ResponseEntity.ok().body(Result.ok());
    }

    @PutMapping("/password")
    public Result<Void> changePassword(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @Valid @RequestBody ChangePasswordRequest request) {
        authService.changePassword(authorization, request.oldPassword(), request.newPassword());
        return Result.ok();
    }

    private String resolveRefreshToken(RefreshRequest request, HttpServletRequest httpRequest) {
        if (request != null && request.refreshToken() != null && !request.refreshToken().isBlank()) {
            return request.refreshToken();
        }
        String prefix = authProperties.getRefreshCookiePrefix();
        if (httpRequest.getCookies() != null) {
            for (Cookie cookie : httpRequest.getCookies()) {
                if (cookie.getName().startsWith(prefix)) {
                    return cookie.getValue();
                }
            }
        }
        return null;
    }

    private ResponseCookie refreshCookie(String appCode, String refreshToken) {
        AuthProperties.Cookie cookieProps = authProperties.getCookie();
        long refreshTtlSeconds = jwtProperties.getRefreshTokenTtlSeconds();
        if (refreshTtlSeconds <= 0) {
            refreshTtlSeconds = 604800L;
        }
        ResponseCookie.ResponseCookieBuilder builder = ResponseCookie.from(
                        refreshTokenService.cookieName(appCode), refreshToken)
                .httpOnly(true)
                .path(cookieProps.getPath())
                .maxAge(Duration.ofSeconds(refreshTtlSeconds));
        applySameSite(builder, cookieProps.getSameSite());
        if (cookieProps.isSecure()) {
            builder.secure(true);
        }
        return builder.build();
    }

    private ResponseCookie clearCookie(String name) {
        AuthProperties.Cookie cookieProps = authProperties.getCookie();
        ResponseCookie.ResponseCookieBuilder builder = ResponseCookie.from(name, "")
                .httpOnly(true)
                .path(cookieProps.getPath())
                .maxAge(0);
        applySameSite(builder, cookieProps.getSameSite());
        if (cookieProps.isSecure()) {
            builder.secure(true);
        }
        return builder.build();
    }

    private static void applySameSite(ResponseCookie.ResponseCookieBuilder builder, String sameSite) {
        if (sameSite != null && !sameSite.isBlank()) {
            builder.sameSite(sameSite.trim());
        }
    }

    private static LoginClientInfo clientInfo(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip != null && !ip.isBlank()) {
            int comma = ip.indexOf(',');
            ip = comma > 0 ? ip.substring(0, comma).trim() : ip.trim();
        } else {
            ip = request.getRemoteAddr();
        }
        return new LoginClientInfo(ip, request.getHeader("User-Agent"));
    }
}
