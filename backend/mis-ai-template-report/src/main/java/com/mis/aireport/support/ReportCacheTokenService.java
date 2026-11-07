package com.mis.aireport.support;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 成文回写短时 token：绑定 report_code / params_hash / userId / 过期时间。
 */
@Component
public class ReportCacheTokenService {

    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();
    private static final long DEFAULT_TTL_SEC = 3600L;

    private final ObjectMapper objectMapper;
    private final String secret;

    public ReportCacheTokenService(
            ObjectMapper objectMapper,
            @Value("${mis.ai-report.cache-token-secret:mis-ai-report-cache-dev-secret}") String secret) {
        this.objectMapper = objectMapper;
        this.secret = secret;
    }

    public String issue(String reportCode, String paramsHash, Long userId, boolean saveToCache) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("rc", reportCode);
            payload.put("ph", paramsHash);
            payload.put("uid", userId);
            payload.put("save", saveToCache);
            payload.put("exp", Instant.now().getEpochSecond() + DEFAULT_TTL_SEC);
            String body = B64.encodeToString(objectMapper.writeValueAsBytes(payload));
            String sig = B64.encodeToString(hmac(body));
            return body + "." + sig;
        } catch (Exception e) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "签发缓存写 token 失败");
        }
    }

    public ParsedToken parseAndVerify(String token, String reportCode, String paramsHash, Long userId) {
        if (!StringUtils.hasText(token) || !token.contains(".")) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "cache_write_token 无效");
        }
        String[] parts = token.split("\\.", 2);
        String body = parts[0];
        String sig = parts[1];
        String expect = B64.encodeToString(hmac(body));
        if (!expect.equals(sig)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "cache_write_token 签名校验失败");
        }
        try {
            Map<String, Object> payload = objectMapper.readValue(
                    B64D.decode(body), new TypeReference<Map<String, Object>>() {});
            String rc = String.valueOf(payload.getOrDefault("rc", ""));
            String ph = String.valueOf(payload.getOrDefault("ph", ""));
            long exp = payload.get("exp") instanceof Number n ? n.longValue() : 0L;
            boolean save = Boolean.TRUE.equals(payload.get("save"))
                    || "true".equalsIgnoreCase(String.valueOf(payload.get("save")));
            Long uid = payload.get("uid") instanceof Number n ? n.longValue() : null;
            if (!reportCode.equals(rc) || !paramsHash.equals(ph)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "token 与报告参数不匹配");
            }
            if (userId != null && uid != null && !userId.equals(uid)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "token 用户不匹配");
            }
            if (Instant.now().getEpochSecond() > exp) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "cache_write_token 已过期");
            }
            if (!save) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "本次不允许写入缓存");
            }
            return new ParsedToken(rc, ph, uid, save);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "cache_write_token 解析失败");
        }
    }

    private byte[] hmac(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return mac.doFinal(body.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC 失败", e);
        }
    }

    public record ParsedToken(String reportCode, String paramsHash, Long userId, boolean saveToCache) {}
}
