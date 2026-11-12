package com.mis.iqd.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 问数配置变更事件发布器（architecture §4.2.2 D.7.3）。
 *
 * <p>mis-iqd 保存配置（ACL / 范围 / 脱敏规则 / 维度注册表 / 清单 in_scope）成功后，
 * 向 Redis pub/sub 通道 {@code iqd.config.changed} 发布事件；Worker 侧
 * {@code IqdConfigClient}（可选订阅）收到后刷新本地缓存。
 *
 * <p><b>降级语义</b>：Redis 不可达 / 未配置时发布失败仅记 warning——配置变更仍会经
 * Worker 缓存 TTL（默认 ≤10s）+ 每日定期兜底生效，不影响主链路写入。绝不因事件
 * 发布失败回滚已落库的配置。
 *
 * <p>通道名与载荷约定（与 Worker 端 iqd_config_client 订阅器对齐）：
 * <pre>
 *   channel: iqd.config.changed
 *   payload: {"type":"acl|scope|mask|dimension|catalog|dict_sync","connection_id":1,"changed_at":"..."}
 * </pre>
 */
@Component
public class IqdConfigChangePublisher {

    private static final Logger log = LoggerFactory.getLogger(IqdConfigChangePublisher.class);

    /** 事件通道（Worker IqdConfigClient 订阅同名通道）。 */
    public static final String CHANNEL = "iqd.config.changed";

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public IqdConfigChangePublisher(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * 发布配置变更事件。
     *
     * @param type         事件类型：acl / scope / mask / dimension / catalog / dict_sync
     * @param connectionId 变更涉及的连接 id（可为 null）
     */
    public void publish(String type, Long connectionId) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("type", type);
            payload.put("connection_id", connectionId);
            payload.put("changed_at", Instant.now().toString());
            String json = objectMapper.writeValueAsString(payload);
            redisTemplate.convertAndSend(CHANNEL, json);
            log.info("IQD config change published type={} connectionId={}", type, connectionId);
        } catch (Exception exc) {
            // 降级：Redis 不可用仅告警，配置变更仍经 TTL/每日兜底生效
            log.warn("IQD config change publish skipped (redis unavailable) type={} connectionId={}",
                    type, connectionId, exc);
        }
    }
}
