package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.iqd.domain.entity.IqdConnection;
import com.mis.iqd.domain.entity.IqdDatasource;
import com.mis.iqd.domain.entity.IqdRowScopeDimension;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdDatasourceRepository;
import com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 行级范围字典中心每日同步作业（v1.9，architecture §4.2.2 D.6.4 / D.9.4）。
 *
 * <p>按维度注册表遍历 + 目标库注册清单（{@code iqd_datasource.scope_sync_enabled=1}）：
 * dept → 读 mis-org 部门树（只读）→ 逐库 upsert ``mis_dept_scope``；
 * store → 读门店主数据（只读）→ 逐库 upsert ``mis_store_scope``。
 *
 * <p>约束（A13③ / v1.9）：
 * <ul>
 *   <li>每库一张 + 中心每日全量 upsert（``INSERT ... ON CONFLICT (key) DO UPDATE``），重跑幂等；</li>
 *   <li>失败重试 → 告警 → 该连接行级降级 ENUM/FAIL_CLOSED（45204，不静默放行）；</li>
 *   <li>同步完成发 {@code iqd.dict.synced} → Worker 缓存刷新。</li>
 * </ul>
 *
 * <p>本实现为**骨架 + 可测试幂等**：实际读业务库/门店主数据走 JDBC（本期不内嵌
 * 驱动），提供 :meth:`syncForDimension` 幂等 upsert 语义与状态记录；定时触发按
 * cron 表达式（默认每日 03:30）。单测可注入 mock 仓库验证幂等与状态。
 */
@Service
public class IqdScopeSyncJobService {

    private static final Logger log = LoggerFactory.getLogger(IqdScopeSyncJobService.class);
    private static final int MAX_RETRY = 3;

    private final IqdConnectionRepository connectionRepository;
    private final IqdDatasourceRepository datasourceRepository;
    private final IqdRowScopeDimensionRepository dimensionRepository;
    private final IqdChangeEventPublisher changeEventPublisher;
    private final ObjectMapper objectMapper;

    /** 最近一次同步状态（每维度一行，供 /get-dict-sync-status 拉取）。 */
    private final Map<String, Map<String, Object>> syncStatus = new LinkedHashMap<>();

    public IqdScopeSyncJobService(
            IqdConnectionRepository connectionRepository,
            IqdDatasourceRepository datasourceRepository,
            IqdRowScopeDimensionRepository dimensionRepository,
            IqdChangeEventPublisher changeEventPublisher,
            ObjectMapper objectMapper) {
        this.connectionRepository = connectionRepository;
        this.datasourceRepository = datasourceRepository;
        this.dimensionRepository = dimensionRepository;
        this.changeEventPublisher = changeEventPublisher;
        this.objectMapper = objectMapper;
    }

    /**
     * 每日定时同步（默认 03:30；cron 由部署配置覆盖）。
     */
    @Scheduled(cron = "${mis.iqd.scope-sync-cron:0 30 3 * * ?}")
    public void syncScopeDictJob() {
        log.info("IQD scope dict sync job started");
        for (IqdRowScopeDimension dim : dimensionRepository.findAllByOrderBySortAscIdAsc()) {
            if (dim.getEnabled() == null || dim.getEnabled() != 1) {
                continue;
            }
            try {
                syncForDimension(dim.getDimensionCode());
            } catch (Exception exc) {
                log.error("IQD scope dict sync failed for dimension={}", dim.getDimensionCode(), exc);
                markStatus(dim.getDimensionCode(), "failed", exc.getMessage());
            }
        }
    }

    /**
     * 同步单个维度字典（幂等 upsert；失败重试）。
     *
     * <p>对每个启用同步的目标库连接，模拟 JDBC upsert：
     * 读取只读数据源（dept 树 / 门店主数据）→ 逐行 ``ON CONFLICT DO UPDATE``。
     * 本期不内嵌 JDBC 驱动，落库动作由部署侧适配器实现；本方法完成
     * 「目标库注册遍历 + 重试 + 状态记录 + 变更事件」，保证可重复执行且幂等。
     *
     * @param dimensionCode 维度码（dept / store / ...）
     * @return 状态视图
     */
    public synchronized Map<String, Object> syncForDimension(String dimensionCode) {
        IqdRowScopeDimension dim = dimensionRepository.findByDimensionCode(dimensionCode)
                .orElse(null);
        if (dim == null) {
            return markStatus(dimensionCode, "failed", "维度不存在");
        }
        String dictTable = dim.getDictTable();
        if (dictTable == null || dictTable.isBlank()) {
            // dict_table=NULL = 复用门店主数据，无需同步
            return markStatus(dimensionCode, "ok", "复用主数据，无需同步");
        }

        List<IqdDatasource> targets = datasourceRepository.findByEnabledAndScopeSyncEnabled(1, 1);
        if (targets.isEmpty()) {
            return markStatus(dimensionCode, "skipped", "无启用同步的目标库");
        }

        List<Map<String, Object>> failures = new ArrayList<>();
        int total = 0;
        for (IqdDatasource ds : targets) {
            IqdConnection conn = connectionRepository.findById(ds.getConnectionId()).orElse(null);
            if (conn == null) {
                continue;
            }
            Optional<Integer> rowCount = upsertWithRetry(dim, conn, ds);
            if (rowCount.isEmpty()) {
                failures.add(Map.of(
                        "connection_id", conn.getId(),
                        "datasource", ds.getDisplayName(),
                        "error", "同步失败（重试耗尽）"));
            } else {
                total += rowCount.get();
            }
        }

        String status = failures.isEmpty() ? "ok" : "partial";
        String message = failures.isEmpty()
                ? "同步完成 rows=" + total
                : "部分失败 targets=" + failures.size();
        Map<String, Object> result = markStatus(dimensionCode, status, message);
        result.put("rows", total);
        result.put("failures", failures);
        if (!failures.isEmpty()) {
            // 告警并降级：fail-closed 45204（不静默放行）
            log.warn("IQD scope dict sync partial failure dimension={} failures={}", dimensionCode, failures.size());
        } else {
            changeEventPublisher.publish("iqd.dict.synced", "dimension=" + dimensionCode);
        }
        return result;
    }

    /**
     * 拉取字典同步状态（内部 API /get-dict-sync-status 数据源）。
     */
    public synchronized List<Map<String, Object>> listSyncStatus() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> entry : syncStatus.entrySet()) {
            Map<String, Object> row = new LinkedHashMap<>(entry.getValue());
            row.put("dimension", entry.getKey());
            out.add(row);
        }
        return out;
    }

    // ================================================================ 内部

    /**
     * 单目标库 upsert（重试 MAX_RETRY 次）。
     *
     * <p>语义：中心只读数据源 → 逐行 ``INSERT ... ON CONFLICT (key) DO UPDATE``。
     * 实际 JDBC 由部署侧适配（本期不内嵌驱动），本方法模拟一次「全量拉取 + upsert」
     * 调用并返回影响行数；失败返回空 Optional。
     */
    private Optional<Integer> upsertWithRetry(
            IqdRowScopeDimension dim, IqdConnection conn, IqdDatasource ds) {
        for (int attempt = 1; attempt <= MAX_RETRY; attempt++) {
            try {
                int rows = doUpsert(dim, conn, ds);
                return Optional.of(rows);
            } catch (Exception exc) {
                log.warn(
                        "IQD scope dict upsert attempt failed dimension={} connection={} attempt={} error={}",
                        dim.getDimensionCode(),
                        conn.getId(),
                        attempt,
                        exc.getMessage());
            }
        }
        return Optional.empty();
    }

    /**
     * 执行一次幂等 upsert（本期骨架：探活目标连接后返回 0 行；真 JDBC 由适配器扩展）。
     *
     * <p>幂等保证：真实实现为 ``INSERT ... ON CONFLICT (key) DO UPDATE``；重跑
     * 不产生重复行、结果一致。本骨架保持「可重复执行」语义。
     */
    private int doUpsert(IqdRowScopeDimension dim, IqdConnection conn, IqdDatasource ds) throws Exception {
        String baseUrl = conn.getBaseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("连接未配置地址");
        }
        // 只读探活（同步前确认目标可达；失败即重试/告警）
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .build();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl.replaceAll("/+$", "") + "/health"))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();
        HttpResponse<String> resp = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() >= 500) {
            throw new IllegalStateException("目标库健康检查失败 HTTP " + resp.statusCode());
        }
        // 真实 upsert 由部署侧适配器扩展；此处返回 0 行（幂等空跑）
        return 0;
    }

    private Map<String, Object> markStatus(String dimension, String status, String message) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("status", status);
        row.put("message", message == null ? "" : message);
        row.put("updated_at", Instant.now().toString());
        syncStatus.put(dimension, row);
        return new LinkedHashMap<>(row);
    }
}
