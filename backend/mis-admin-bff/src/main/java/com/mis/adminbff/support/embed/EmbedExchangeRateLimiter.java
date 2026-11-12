package com.mis.adminbff.support.embed;

import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.common.core.exception.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 兑换端点限流（R6：按 hostId + clientId 限流，防撞库）。
 *
 * <p>实现为<b>进程内固定窗口计数器</b>：键 = hostId + clientId，窗口 = 1 分钟。
 * 超出 {@code EmbedIdentityProperties.rateLimitPerMinute} 上限后拒绝并返回
 * 40303（fail-closed；限流是保护性拒绝，不暴露业务语义）。
 *
 * <p>局限说明：进程内限流在多实例部署下为 per-instance 宽松限流（N× 上限），
 * 本交付不做 Redis 分布式限流（P1 可升级）；对「防撞库」的防护目标已足够。
 */
public class EmbedExchangeRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(EmbedExchangeRateLimiter.class);

    private static final long WINDOW_MS = 60_000L;

    private final int limitPerWindow;
    private final Map<String, WindowCounter> counters = new ConcurrentHashMap<>();

    public EmbedExchangeRateLimiter(int limitPerWindow) {
        this.limitPerWindow = Math.max(limitPerWindow, 1);
    }

    /**
     * 校验并计入一次请求；超限抛 {@link BusinessException}（40303，fail-closed）。
     *
     * @param hostId   宿主标识
     * @param clientId 客户端标识（agent_external_host.client_id）
     */
    public void assertAllowed(String hostId, String clientId) {
        String key = hostId + ":" + (clientId == null ? "" : clientId);
        long now = System.currentTimeMillis();
        WindowCounter counter = counters.compute(key, (k, existing) -> {
            if (existing == null || now - existing.windowStart >= WINDOW_MS) {
                return new WindowCounter(now, new AtomicLong(0));
            }
            return existing;
        });
        long count = counter.count.incrementAndGet();
        if (count > limitPerWindow) {
            log.warn("嵌入身份兑换触发限流: key={}, count={}, limit={}", key, count, limitPerWindow);
            throw new BusinessException(
                    AgentOpsErrorCodes.ACL_UNAVAILABLE, "兑换请求过于频繁，请稍后重试");
        }
    }

    private record WindowCounter(long windowStart, AtomicLong count) {
    }
}
