package com.mis.auth.service;

import com.mis.auth.config.AuthProperties;
import com.mis.auth.dto.CaptchaResponse;
import com.mis.common.core.constant.CacheConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;

@Service
public class CaptchaService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final StringRedisTemplate redisTemplate;
    private final AuthProperties authProperties;

    public CaptchaService(StringRedisTemplate redisTemplate, AuthProperties authProperties) {
        this.redisTemplate = redisTemplate;
        this.authProperties = authProperties;
    }

    public CaptchaResponse generate() {
        String captchaId = UUID.randomUUID().toString();
        int length = Math.max(1, authProperties.getCaptchaLength());
        String code = randomCode(length, authProperties.getCaptchaChars());
        long ttlSeconds = Math.max(1L, authProperties.getCaptchaTtlSeconds());
        redisTemplate.opsForValue().set(
                CacheConstants.AUTH_CAPTCHA.formatted(captchaId),
                code.toLowerCase(),
                Duration.ofSeconds(ttlSeconds));
        return new CaptchaResponse(captchaId, toSvgBase64(code));
    }

    public void validate(String captchaId, String captchaCode) {
        if (captchaId == null || captchaId.isBlank() || captchaCode == null || captchaCode.isBlank()) {
            throw new BusinessException(ResultCode.CAPTCHA_INVALID);
        }
        String key = CacheConstants.AUTH_CAPTCHA.formatted(captchaId);
        String stored = redisTemplate.opsForValue().get(key);
        redisTemplate.delete(key);
        if (stored == null || !stored.equalsIgnoreCase(captchaCode.trim())) {
            throw new BusinessException(ResultCode.CAPTCHA_INVALID);
        }
    }

    private static String randomCode(int length, String charset) {
        if (charset == null || charset.isEmpty()) {
            throw new IllegalStateException("mis.auth.captcha-chars must not be empty");
        }
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(charset.charAt(RANDOM.nextInt(charset.length())));
        }
        return sb.toString();
    }

    private static String toSvgBase64(String code) {
        String svg = """
                <svg xmlns='http://www.w3.org/2000/svg' width='120' height='40'>
                  <rect width='100%%' height='100%%' fill='#f5f5f5'/>
                  <text x='50%%' y='50%%' dominant-baseline='middle' text-anchor='middle'
                        font-family='monospace' font-size='20' fill='#333'>%s</text>
                </svg>
                """.formatted(code);
        return "data:image/svg+xml;base64," + Base64.getEncoder().encodeToString(svg.getBytes());
    }
}
