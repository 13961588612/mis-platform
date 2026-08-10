package com.mis.kb.domain.service;

import com.mis.kb.domain.model.EngineModelPool;
import com.mis.kb.engine.KnowledgeEnginePort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;

/**
 * 模型池探测服务（T02，R-P0-01/02/04；60s TTL 手写缓存，设计 §3.2.4）。
 *
 * <p><b>热路径零网络铁律（设计 §8-8）：</b>检索/问答链路只允许 {@link #peekPool()}
 * （只读缓存，绝不触发网络）；网络调用只发生在 UI 显式刷新 {@link #getPool()}。
 * 若在 Resolver 里误用 {@code getPool()}，一次问答会打一次 RAGFlow，拖垮热路径。
 *
 * <p><b>降级语义（设计 §8-6）：</b>探测失败返回 {@code EngineModelPool.unavailable(...)}
 * （available=false + 原因），绝不当空列表；下次 {@code getPool()} 60s 后自动重试。
 *
 * <p>实现刻意不用 Caffeine：60s TTL 足够，volatile 快照 + synchronized 双检锁即可，
 * 代码 ~40 行，避免新增第三方依赖（设计 §1.2）。
 */
@Service
public class EngineModelPoolService {

    private static final Logger log = LoggerFactory.getLogger(EngineModelPoolService.class);

    /** 缓存有效期。 */
    private static final Duration TTL = Duration.ofSeconds(60);

    private final KnowledgeEnginePort enginePort;

    /** 当前缓存快照；{@code null} = 从未探测成功过。 */
    private volatile EngineModelPool cache;

    /** 缓存过期时刻；初始 EPOCH 保证首次调用必触发探测。 */
    private volatile Instant expireAt = Instant.EPOCH;

    /** 刷新锁（防并发重复打引擎）。 */
    private final Object lock = new Object();

    public EngineModelPoolService(KnowledgeEnginePort enginePort) {
        this.enginePort = enginePort;
    }

    /**
     * UI 用：拿模型池，缓存过期才真正打引擎（网络只发生在这里）。
     *
     * @return 模型池快照，恒非 {@code null}（失败时为 unavailable 降级态）
     */
    public EngineModelPool getPool() {
        EngineModelPool current = cache;
        if (current != null && Instant.now().isBefore(expireAt)) {
            return current;
        }
        synchronized (lock) {
            current = cache;
            if (current != null && Instant.now().isBefore(expireAt)) {
                return current;
            }
            EngineModelPool probed;
            try {
                probed = enginePort.probeModelPool();
                log.info("模型池探测成功 embedding={} rerank={} probedAt={}",
                        probed == null ? 0 : probed.embedding().size(),
                        probed == null ? 0 : probed.rerank().size(),
                        probed == null ? null : probed.probedAt());
            } catch (Exception e) {
                log.warn("模型池探测失败，整体降级（60s 后自动重试）: {}", e.getMessage());
                probed = EngineModelPool.unavailable("模型池探测失败：" + e.getMessage(), null);
            }
            cache = probed;
            expireAt = Instant.now().plus(TTL);
            return probed;
        }
    }

    /**
     * 热路径用：只读缓存，绝不触发网络。
     *
     * <p>缓存未过期返回快照；未探测/已过期返回 {@code null}（调用方按「无法判定」保守处理，
     * 例如 T03 Resolver 跳过池校验、直接信任库级/全局模型 id）。
     *
     * @return 有效缓存快照；无有效缓存返回 {@code null}
     */
    public EngineModelPool peekPool() {
        EngineModelPool current = cache;
        return (current != null && Instant.now().isBefore(expireAt)) ? current : null;
    }

    /**
     * 手动失效（引擎健康变化等场景），下一次 {@link #getPool()} 会重新探测。
     */
    public void invalidate() {
        cache = null;
        expireAt = Instant.EPOCH;
    }
}
