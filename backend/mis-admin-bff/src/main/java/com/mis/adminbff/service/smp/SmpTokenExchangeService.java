package com.mis.adminbff.service.smp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.config.SmpProperties;
import com.mis.adminbff.support.DownstreamAuthContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.SecurityContextHolder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 老 SMP auth-service 令牌兑换（可被多个下游复用）。
 *
 * <p>流程：client 凭证 + 当前 MIS JWT → 老 auth exchange → HC-SMP 可用令牌。
 * 契约：{@code docs/integration/smp-auth-service-exchange.md}。
 */
@Service
public class SmpTokenExchangeService {

    private static final Logger log = LoggerFactory.getLogger(SmpTokenExchangeService.class);

    private final SmpProperties properties;
    private final WebClient.Builder plainWebClientBuilder;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public SmpTokenExchangeService(
            SmpProperties properties,
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainWebClientBuilder,
            StringRedisTemplate redisTemplate,
            ObjectMapper objectMapper) {
        this.properties = properties;
        this.plainWebClientBuilder = plainWebClientBuilder;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    /** 使用配置默认 audience 兑换。 */
    public String getToken(Long misUserId) {
        return getToken(misUserId, null);
    }

    /**
     * 兑换老令牌（裸 token）。
     *
     * @param misUserId 缓存键用 MIS 用户 ID
     * @param audience  覆盖默认 audience；空则用配置
     */
    public String getToken(Long misUserId, String audience) {
        SmpProperties.TokenExchange tx = properties.getTokenExchange();
        assertReady(tx, misUserId);
        String effectiveAudience = resolveAudience(audience);
        Long userId = resolveUserId(misUserId);

        String cacheKey = cacheKey(userId, effectiveAudience);
        if (tx.getCache().isEnabled()) {
            String cached = redisTemplate.opsForValue().get(cacheKey);
            if (StringUtils.hasText(cached)) {
                return cached;
            }
        }
        return exchangeAndCache(userId, effectiveAudience);
    }

    public String refreshToken(Long misUserId) {
        return refreshToken(misUserId, null);
    }

    public String refreshToken(Long misUserId, String audience) {
        Long userId = resolveUserId(misUserId);
        String effectiveAudience = resolveAudience(audience);
        if (userId != null) {
            redisTemplate.delete(cacheKey(userId, effectiveAudience));
        }
        return getToken(userId, effectiveAudience);
    }

    private String exchangeAndCache(Long misUserId, String audience) {
        SmpProperties.TokenExchange tx = properties.getTokenExchange();
        String misJwt = DownstreamAuthContext.getToken();
        if (!StringUtils.hasText(misJwt)) {
            fail("缺少 MIS Access Token，无法兑换 SMP 令牌");
        }
        String misAccessToken = misJwt.startsWith("Bearer ")
                ? misJwt.substring("Bearer ".length()).trim()
                : misJwt.trim();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("clientId", tx.getClientId());
        body.put("clientSecret", tx.getClientSecret());
        if (StringUtils.hasText(audience)) {
            body.put("audience", audience);
        }
        body.put("misAccessToken", misAccessToken);

        try {
            WebClient client = plainWebClientBuilder.build();
            String raw = client.post()
                    .uri(tx.getTokenUrl())
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block(Duration.ofMillis(Math.max(properties.getExchangeTimeoutMs(), 3000)));

            if (!StringUtils.hasText(raw)) {
                fail("SMP auth 兑换响应为空");
            }

            JsonNode root = objectMapper.readTree(raw);
            if (root.has("code") && root.get("code").asInt(-1) != 0) {
                fail("SMP auth 兑换失败：" + root.path("message").asText("exchange_failed"));
            }

            String token = readToken(root, tx.getTokenJsonPath());
            if (!StringUtils.hasText(token)) {
                fail("SMP auth 响应未包含 token");
            }

            long expiresIn = root.path("data").path("expiresIn").asLong(1800);
            long skew = Math.max(0, tx.getCache().getSkewSeconds());
            long ttlSec = expiresIn > skew ? expiresIn - skew : 1800;

            if (misUserId != null && tx.getCache().isEnabled()) {
                redisTemplate.opsForValue().set(
                        cacheKey(misUserId, audience), token, ttlSec, TimeUnit.SECONDS);
            }
            return token;
        } catch (BusinessException ex) {
            throw ex;
        } catch (Exception ex) {
            log.warn("SMP 令牌兑换异常: {}", ex.toString());
            fail("SMP 令牌兑换异常：" + ex.getMessage());
            return null;
        }
    }

    private void assertReady(SmpProperties.TokenExchange tx, Long misUserId) {
        if (!tx.isEnabled()) {
            fail("SMP 令牌兑换未启用（mis.bff.smp.token-exchange.enabled=false）");
        }
        if (!StringUtils.hasText(tx.getTokenUrl())) {
            fail("未配置 mis.bff.smp.token-exchange.token-url");
        }
        if (!StringUtils.hasText(tx.getClientSecret())) {
            fail("未配置 mis.bff.smp.token-exchange.client-secret");
        }
        if (resolveUserId(misUserId) == null) {
            fail("缺少登录用户，无法兑换 SMP 令牌");
        }
    }

    private Long resolveUserId(Long misUserId) {
        if (misUserId != null) {
            return misUserId;
        }
        return SecurityContextHolder.getOptional().map(u -> u.getUserId()).orElse(null);
    }

    private String resolveAudience(String audience) {
        if (StringUtils.hasText(audience)) {
            return audience.trim();
        }
        String def = properties.getTokenExchange().getAudience();
        return def == null ? "" : def.trim();
    }

    private String cacheKey(Long misUserId, String audience) {
        String aud = audience == null || audience.isBlank() ? "_" : audience;
        return properties.getTokenExchange().getCache().getKeyPrefix() + misUserId + ":" + aud;
    }

    private static String readToken(JsonNode root, String jsonPath) {
        if ("$.data.token".equals(jsonPath) || jsonPath == null || jsonPath.isBlank()) {
            JsonNode n = root.path("data").path("token");
            return n.isMissingNode() || n.isNull() ? null : n.asText();
        }
        if (jsonPath.startsWith("$.")) {
            String[] parts = jsonPath.substring(2).split("\\.");
            JsonNode cur = root;
            for (String p : parts) {
                cur = cur.path(p);
            }
            return cur.isMissingNode() || cur.isNull() ? null : cur.asText();
        }
        return null;
    }

    private void fail(String message) {
        throw new BusinessException(ResultCode.INTERNAL_ERROR, message);
    }
}
