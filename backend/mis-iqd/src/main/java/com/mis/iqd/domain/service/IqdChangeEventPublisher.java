package com.mis.iqd.domain.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedDeque;

/**
 * 问数配置变更事件发布器（W2，architecture §4.2.2 D.7.3）。
 *
 * <p>变更事件推送链路：mis-iqd 管理面 CRUD 保存后 → 本发布器记录事件
 * （有界内存队列）→ Worker {@code IqdConfigClient} 经内部 API
 * {@code /internal/v1/iqd/get-change-events} 增量拉取 → 按事件失效本地缓存桶
 * （默认 ≤10s 生效；缓存不可得 fail-closed 45204）。
 *
 * <p>事件名与 Worker 端 {@code EVENT_BUCKET_MAP} 一一对应：
 * {@code iqd.config.changed} / {@code iqd.acl.changed} / {@code iqd.scope.changed} /
 * {@code iqd.dimension.changed} / {@code iqd.mask.changed} / {@code iqd.dict.synced}。
 *
 * <p>有界队列（默认保留最近 512 条），Worker 拉取后游标推进即消费；事件是幂等提示，
 * 丢失只影响缓存刷新时效（TTL 兜底），不破坏一致性。
 */
@Component
public class IqdChangeEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(IqdChangeEventPublisher.class);
    private static final int MAX_EVENTS = 512;

    /** 事件游标：单调递增序号。 */
    private long cursor = 0L;

    /** 有界事件队列（头=最旧）。 */
    private final ConcurrentLinkedDeque<Map<String, Object>> events = new ConcurrentLinkedDeque<>();

    /**
     * 发布一条变更事件。
     *
     * @param eventName 事件名（如 {@code iqd.acl.changed}）
     * @param detail    附加明细（如变更主体/表键；可空）
     */
    public synchronized void publish(String eventName, String detail) {
        long seq = ++cursor;
        Map<String, Object> event = Map.of(
                "seq", seq,
                "event", eventName,
                "time", Instant.now().toString(),
                "detail", detail == null ? "" : detail
        );
        events.addLast(event);
        while (events.size() > MAX_EVENTS) {
            events.pollFirst();
        }
        log.info("IQD config change event published event={} seq={}", eventName, seq);
    }

    /**
     * 拉取自游标之后的新事件（Worker 增量拉取入口）。
     *
     * @param sinceSeq 上次消费游标；0 = 全量拉取。
     * @return 事件列表（升序 seq）；为空返回空列表。
     */
    public synchronized List<Map<String, Object>> drainSince(long sinceSeq) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> event : events) {
            Object seqObj = event.get("seq");
            if (seqObj instanceof Number n && n.longValue() > sinceSeq) {
                out.add(event);
            }
        }
        return out;
    }

    /** 当前最大游标（Worker 推进用）。 */
    public synchronized long currentCursor() {
        return cursor;
    }
}
