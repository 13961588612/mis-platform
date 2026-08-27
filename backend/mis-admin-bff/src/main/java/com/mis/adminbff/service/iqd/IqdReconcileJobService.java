package com.mis.adminbff.service.iqd;

import com.mis.adminbff.client.AiPlatformClient;
import com.mis.adminbff.client.IqdClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * 问数 catalog 编辑对账清扫（二期 S3 / 周期任务）。
 *
 * <p>每 60s 扫描存在偏离的连接（{@code current_edit_revision > built_edit_revision}
 * 或 {@code stale_drift=true}），调 ai-platform {@code /iqd/enhance/reconcile}
 * 重新比对 WrenAI 实际 mdl_hash 并重建 model，使平台基线重新收敛为权威。
 *
 * <p>不硬编码任何连接 id（Q4）：仅按 mis-iqd 返回的连接清单 + 同步状态判定偏离。
 * 单连接失败仅告警，不阻断其它连接的清扫（fail-closed 哲学一致）。
 */
@Service
public class IqdReconcileJobService {

    private static final Logger log = LoggerFactory.getLogger(IqdReconcileJobService.class);

    private final IqdClient iqdClient;
    private final AiPlatformClient aiPlatformClient;

    public IqdReconcileJobService(IqdClient iqdClient, AiPlatformClient aiPlatformClient) {
        this.iqdClient = iqdClient;
        this.aiPlatformClient = aiPlatformClient;
    }

    /** 周期扫描偏离连接并触发对账（fixedDelay=60s）。 */
    @Scheduled(fixedDelay = 60000)
    public void scanDivergedConnections() {
        List<Map<String, Object>> connections;
        try {
            connections = iqdClient.getConnections();
        } catch (Exception exc) {
            log.warn("IQD reconcile scan: list connections failed: {}", exc.getMessage());
            return;
        }
        if (connections == null || connections.isEmpty()) {
            return;
        }
        for (Map<String, Object> conn : connections) {
            Object idObj = conn.get("id");
            if (!(idObj instanceof Number)) {
                continue;
            }
            Long connectionId = ((Number) idObj).longValue();
            try {
                Map<String, Object> status = iqdClient.getCatalogSyncStatus(connectionId);
                if (isDiverged(status)) {
                    log.info("IQD reconcile scan: connectionId={} diverged, triggering reconcile",
                            connectionId);
                    aiPlatformClient.reconcile(connectionId);
                }
            } catch (Exception exc) {
                log.warn("IQD reconcile scan: connectionId={} skipped: {}", connectionId, exc.getMessage());
            }
        }
    }

    /** 判定连接是否偏离（需重新对账）。 */
    private static boolean isDiverged(Map<String, Object> status) {
        if (status == null) {
            return false;
        }
        if (Boolean.TRUE.equals(status.get("stale_drift"))) {
            return true;
        }
        Object cur = status.get("current_edit_revision");
        Object built = status.get("built_edit_revision");
        if (cur instanceof Number c && built instanceof Number b) {
            return c.longValue() > b.longValue();
        }
        return false;
    }
}
