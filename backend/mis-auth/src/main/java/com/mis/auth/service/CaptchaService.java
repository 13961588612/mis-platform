package com.mis.auth.service;

import com.mis.auth.config.AuthProperties;
import com.mis.auth.dto.CaptchaResponse;
import com.mis.common.core.constant.CacheConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;

/**
 * 图形验证码：Redis 存码 + SVG 抗 OCR 渲染（噪点 / 干扰线 / 逐字扭曲）。
 */
@Service
public class CaptchaService {

    private static final SecureRandom RANDOM = new SecureRandom();

    /** 前景字色：偏暗、对比足够可读 */
    private static final String[] TEXT_COLORS = {
            "#2a3344", "#334155", "#1e3a5f", "#3b2f5c", "#1f4d3a", "#4a3728"
    };
    /** 干扰线/噪点色：浅灰蓝，弱化但不影响人眼识读 */
    private static final String[] NOISE_COLORS = {
            "#94a3b8", "#a8b4c4", "#b0bec5", "#90a4ae", "#adb5bd", "#9aa5b5"
    };

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

    /**
     * 抗 OCR SVG：背景噪点 + 多层干扰线 + 逐字旋转/位移/字号抖动。
     * 人眼仍可读；简单模板匹配 / 直线 OCR 难度明显上升。
     */
    static String toSvgBase64(String code) {
        int n = Math.max(1, code.length());
        int width = Math.max(120, 28 * n + 24);
        int height = 44;

        StringBuilder svg = new StringBuilder(1024);
        svg.append("<svg xmlns='http://www.w3.org/2000/svg' width='")
                .append(width)
                .append("' height='")
                .append(height)
                .append("' viewBox='0 0 ")
                .append(width)
                .append(' ')
                .append(height)
                .append("'>");
        svg.append("<rect width='100%' height='100%' fill='#eef2f7'/>");

        // 背景噪点
        int dots = 28 + n * 6;
        for (int i = 0; i < dots; i++) {
            double cx = RANDOM.nextDouble() * width;
            double cy = RANDOM.nextDouble() * height;
            double r = 0.4 + RANDOM.nextDouble() * 1.2;
            svg.append("<circle cx='").append(fmt(cx)).append("' cy='").append(fmt(cy))
                    .append("' r='").append(fmt(r))
                    .append("' fill='").append(pick(NOISE_COLORS)).append("' opacity='0.55'/>");
        }

        // 底层干扰线（穿过字符区域）
        appendInterferenceLines(svg, width, height, 3 + n / 2);

        // 逐字绘制
        double slot = (width - 16.0) / n;
        for (int i = 0; i < n; i++) {
            char ch = code.charAt(i);
            double x = 8 + slot * i + slot / 2 + (RANDOM.nextDouble() * 4 - 2);
            double y = height / 2.0 + (RANDOM.nextDouble() * 8 - 4);
            int rotate = RANDOM.nextInt(31) - 15;
            int fontSize = 18 + RANDOM.nextInt(5);
            int weight = RANDOM.nextBoolean() ? 600 : 700;
            svg.append("<text x='").append(fmt(x)).append("' y='").append(fmt(y))
                    .append("' text-anchor='middle' dominant-baseline='middle'")
                    .append(" font-family='DejaVu Sans Mono, Consolas, monospace'")
                    .append(" font-size='").append(fontSize).append("'")
                    .append(" font-weight='").append(weight).append("'")
                    .append(" fill='").append(pick(TEXT_COLORS)).append("'")
                    .append(" transform='rotate(").append(rotate).append(' ').append(fmt(x))
                    .append(' ').append(fmt(y)).append(")'>")
                    .append(escapeXml(ch))
                    .append("</text>");
        }

        // 顶层细线，打断连续笔画轮廓
        appendInterferenceLines(svg, width, height, 2 + n / 2);

        // 少量短划噪点
        for (int i = 0; i < 8 + n; i++) {
            double x1 = RANDOM.nextDouble() * width;
            double y1 = RANDOM.nextDouble() * height;
            double x2 = x1 + RANDOM.nextDouble() * 8 - 4;
            double y2 = y1 + RANDOM.nextDouble() * 8 - 4;
            svg.append("<line x1='").append(fmt(x1)).append("' y1='").append(fmt(y1))
                    .append("' x2='").append(fmt(x2)).append("' y2='").append(fmt(y2))
                    .append("' stroke='").append(pick(NOISE_COLORS))
                    .append("' stroke-width='").append(fmt(0.6 + RANDOM.nextDouble() * 0.8))
                    .append("' opacity='0.7'/>");
        }

        svg.append("</svg>");
        return "data:image/svg+xml;base64,"
                + Base64.getEncoder().encodeToString(svg.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static void appendInterferenceLines(StringBuilder svg, int width, int height, int count) {
        for (int i = 0; i < count; i++) {
            double x1 = RANDOM.nextDouble() * width * 0.25;
            double y1 = RANDOM.nextDouble() * height;
            double cx1 = width * (0.25 + RANDOM.nextDouble() * 0.25);
            double cy1 = RANDOM.nextDouble() * height;
            double cx2 = width * (0.5 + RANDOM.nextDouble() * 0.25);
            double cy2 = RANDOM.nextDouble() * height;
            double x2 = width * (0.75 + RANDOM.nextDouble() * 0.25);
            double y2 = RANDOM.nextDouble() * height;
            svg.append("<path d='M ").append(fmt(x1)).append(' ').append(fmt(y1))
                    .append(" C ").append(fmt(cx1)).append(' ').append(fmt(cy1))
                    .append(',').append(fmt(cx2)).append(' ').append(fmt(cy2))
                    .append(',').append(fmt(x2)).append(' ').append(fmt(y2))
                    .append("' fill='none' stroke='").append(pick(NOISE_COLORS))
                    .append("' stroke-width='").append(fmt(0.9 + RANDOM.nextDouble() * 1.4))
                    .append("' opacity='0.65'/>");
        }
    }

    private static String pick(String[] palette) {
        return palette[RANDOM.nextInt(palette.length)];
    }

    private static String fmt(double v) {
        return String.format(java.util.Locale.ROOT, "%.1f", v);
    }

    private static String escapeXml(char ch) {
        return switch (ch) {
            case '&' -> "&amp;";
            case '<' -> "&lt;";
            case '>' -> "&gt;";
            case '"' -> "&quot;";
            case '\'' -> "&apos;";
            default -> String.valueOf(ch);
        };
    }
}
