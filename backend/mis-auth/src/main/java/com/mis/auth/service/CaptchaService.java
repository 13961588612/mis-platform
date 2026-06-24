package com.mis.auth.service;

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
    private static final Duration CAPTCHA_TTL = Duration.ofSeconds(300);
    private static final String CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private final StringRedisTemplate redisTemplate;

    public CaptchaService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public CaptchaResponse generate() {
        String captchaId = UUID.randomUUID().toString();
        String code = randomCode(4);
        redisTemplate.opsForValue().set(
                CacheConstants.AUTH_CAPTCHA.formatted(captchaId),
                code.toLowerCase(),
                CAPTCHA_TTL);
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

    private static String randomCode(int length) {
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(CODE_CHARS.charAt(RANDOM.nextInt(CODE_CHARS.length())));
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
