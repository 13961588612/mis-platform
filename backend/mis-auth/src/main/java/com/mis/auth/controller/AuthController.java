package com.mis.auth.controller;

import com.mis.auth.dto.CaptchaResponse;
import com.mis.auth.dto.LoginRequest;
import com.mis.auth.dto.RefreshRequest;
import com.mis.auth.dto.TokenResponse;
import com.mis.auth.service.AuthService;
import com.mis.auth.service.CaptchaService;
import com.mis.auth.service.RefreshTokenService;
import com.mis.common.core.result.Result;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
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
 * Refresh Token 通过 HttpOnly、SameSite=Strict Cookie 下发，不落 localStorage（ADR-002）。
 */
@RestController
@RequestMapping({"/internal/v1/auth", "/api/v1/auth"})
public class AuthController {

    private final AuthService authService;
    private final CaptchaService captchaService;

    public AuthController(AuthService authService, CaptchaService captchaService) {
        this.authService = authService;
        this.captchaService = captchaService;
    }

    @GetMapping("/captcha")
    public Result<CaptchaResponse> captcha() {
        return Result.ok(captchaService.generate());
    }

    @PostMapping("/login")
    public ResponseEntity<Result<com.mis.auth.dto.LoginResponse>> login(
            @Valid @RequestBody LoginRequest request) {
        AuthService.LoginResult result = authService.login(request);
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
        if (httpRequest.getCookies() != null) {
            for (Cookie cookie : httpRequest.getCookies()) {
                if (cookie.getName().startsWith("mis_refresh_")) {
                    ResponseCookie clearCookie = ResponseCookie.from(cookie.getName(), "")
                            .httpOnly(true)
                            .sameSite("Strict")
                            .path("/")
                            .maxAge(0)
                            .build();
                    // 多个 cookie 时仅最后一个 Set-Cookie 会生效；Phase 1 通常只有一个 APP
                    return ResponseEntity.ok()
                            .header(HttpHeaders.SET_COOKIE, clearCookie.toString())
                            .body(Result.ok());
                }
            }
        }
        return ResponseEntity.ok().body(Result.ok());
    }

    private static String resolveRefreshToken(RefreshRequest request, HttpServletRequest httpRequest) {
        if (request != null && request.refreshToken() != null && !request.refreshToken().isBlank()) {
            return request.refreshToken();
        }
        if (httpRequest.getCookies() != null) {
            for (Cookie cookie : httpRequest.getCookies()) {
                if (cookie.getName().startsWith("mis_refresh_")) {
                    return cookie.getValue();
                }
            }
        }
        return null;
    }

    private static ResponseCookie refreshCookie(String appCode, String refreshToken) {
        return ResponseCookie.from(RefreshTokenService.cookieName(appCode), refreshToken)
                .httpOnly(true)
                .sameSite("Strict")
                .path("/")
                .maxAge(Duration.ofDays(7))
                .build();
    }
}
