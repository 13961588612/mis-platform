package com.mis.recon.service.pull;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.custom.CustomFetcher;
import com.mis.recon.custom.FetchContext;
import com.mis.recon.dao.LedgerDao;
import com.mis.recon.dao.PullRunDao;
import com.mis.recon.domain.config.ReconConnection;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.repository.ConnectionRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.service.engine.CustomLoader;
import com.mis.recon.service.engine.ReadinessGateEvaluator;
import com.mis.recon.service.ledger.HealthEvaluator;
import com.mis.recon.service.ledger.LedgerService;
import com.mis.recon.service.ledger.SeqWatermarkService;
import com.mis.recon.service.support.ConnectionPoolManager;
import com.mis.recon.service.support.DbDialect;
import com.mis.recon.service.support.SqlParamBinder;
import com.mis.recon.util.JsonUtil;
import com.mis.recon.util.KeyExprEvaluator;
import com.mis.recon.domain.dto.SqlTestResp;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 拉取引擎主流程（F90，对齐任务分解 §7.1 时序）。
 * <ul>
 *   <li>窗口衔接：window_start = 上次成功 window_end − overlap（fetch_overlap_sec 默认 300），G4</li>
 *   <li>键集分页：SourceFetcher 二元组 (time_field, keyset_pk_field)，禁 OFFSET，G3</li>
 *   <li>批事务：每 2000 行一个 TransactionTemplate（upsert + 水位提交同事务），G5</li>
 *   <li>并发互斥：running map，G6</li>
 *   <li>取数方式：db（SourceFetcher）/ api（ApiFetcher）/ custom（CustomFetcherAdapter），第四批</li>
 * </ul>
 */
@Slf4j
@Component
public class PullRunner {

    public static final int BATCH_SIZE = 2000;

    private final DatasourceRepository datasourceRepository;
    private final ConnectionRepository connectionRepository;
    private final ConnectionPoolManager connectionPoolManager;
    private final LedgerService ledgerService;
    private final SeqWatermarkService seqWatermarkService;
    private final PullRunDao pullRunDao;
    private final HealthEvaluator healthEvaluator;
    private final PlatformTransactionManager txManager;
    private final ReadinessGateEvaluator readinessGateEvaluator;
    private final CustomLoader customLoader;

    private final ConcurrentHashMap<String, Boolean> running = new ConcurrentHashMap<>();

    public PullRunner(DatasourceRepository datasourceRepository,
                      ConnectionRepository connectionRepository,
                      ConnectionPoolManager connectionPoolManager,
                      LedgerService ledgerService,
                      SeqWatermarkService seqWatermarkService,
                      PullRunDao pullRunDao,
                      HealthEvaluator healthEvaluator,
                      PlatformTransactionManager txManager,
                      ReadinessGateEvaluator readinessGateEvaluator,
                      CustomLoader customLoader) {
        this.datasourceRepository = datasourceRepository;
        this.connectionRepository = connectionRepository;
        this.connectionPoolManager = connectionPoolManager;
        this.ledgerService = ledgerService;
        this.seqWatermarkService = seqWatermarkService;
        this.pullRunDao = pullRunDao;
        this.healthEvaluator = healthEvaluator;
        this.txManager = txManager;
        this.readinessGateEvaluator = readinessGateEvaluator;
        this.customLoader = customLoader;
    }

    /** 窗口拉取（窗口自动衔接，G4）。返回 pull_run id。 */
    public long run(String dsCode) {
        return run(dsCode, null, null);
    }

    /** 窗口拉取（start/end 覆盖默认；null → G4 衔接计算）。 */
    public long run(String dsCode, LocalDateTime startOverride, LocalDateTime endOverride) {
        if (running.putIfAbsent(dsCode, Boolean.TRUE) != null) {
            throw new BizException(ErrorCode.PULL_IN_PROGRESS);
        }
        try {
            return doRun(dsCode, startOverride, endOverride);
        } finally {
            running.remove(dsCode);
        }
    }

    /** 单条重拉（G7：不写 pull_run；db/api 支持，custom 走 backfill 不支持）。 */
    public Map<String, Object> fetchOne(String dsCode, String recordKey) {
        PullCtx ctx = loadCtx(dsCode);
        Map<String, Object> row = ctx.fetcher.fetchOne(recordKey);
        if (row == null) {
            return Map.of("found", false);
        }
        LedgerDao.BatchResult result = ledgerService.upsertOne(
                dsCode, ctx.ds.getRecordKeyExpression(), row, 0L,
                ctx.ds.getTimeField(), ctx.amountSpec);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("found", true);
        resp.put("record_key", recordKey);
        resp.put("insert", result.insertCount);
        resp.put("update", result.updateCount);
        return resp;
    }

    /** 试拉（BR-18，需求说明书 §3.3）：小窗口取数返回最近 1 条样例 + 字段数，不写台账。 */
    public com.mis.recon.domain.dto.ProbeResp probe(String dsCode) {
        PullCtx ctx = loadCtx(dsCode);
        LocalDateTime end = LocalDateTime.now();
        LocalDateTime start = initialStart(ctx.fetchConfig, end);
        List<Map<String, Object>> rows = ctx.fetcher.probe(start, end);
        if (rows.isEmpty()) {
            return new com.mis.recon.domain.dto.ProbeResp(true, 0, Map.of(), "连接成功，窗口内无数据");
        }
        Map<String, Object> sample = rows.get(0);
        return new com.mis.recon.domain.dto.ProbeResp(true, sample.size(), sample, "连接成功");
    }

    /**
     * 取数 SQL 检测（表单未保存的临时 SQL，不入库）：
     * 按 conn_code 解析源库连接池数据源与方言，绑定窗口参数试跑，
     * 成功返回列 + 样例行，失败返回错误信息（不抛异常）。
     */
    public SqlTestResp sqlTest(String connCode, String sql, LocalDateTime start, LocalDateTime end, Integer limit) {
        long t0 = System.currentTimeMillis();
        ReconConnection conn = connectionRepository.findByConnCode(connCode)
                .orElseThrow(() -> new BizException(ErrorCode.CONN_NOT_FOUND, "连接不存在: " + connCode));
        DbDialect dialect;
        try {
            dialect = DbDialect.from(conn.getType());
        } catch (IllegalArgumentException e) {
            throw new BizException(ErrorCode.CONN_NOT_READY, e.getMessage());
        }
        DataSource dataSource = connectionPoolManager.getDataSource(connCode);
        try {
            LocalDateTime endT = end != null ? end : LocalDateTime.now();
            LocalDateTime startT = start != null ? start : endT.minusDays(1);
            Map<String, Object> params = new HashMap<>();
            params.put("p_start", Timestamp.valueOf(startT));
            params.put("p_end", Timestamp.valueOf(endT));
            SqlParamBinder.BoundSql bound = SqlParamBinder.bind(sql, params);
            int lim = (limit == null || limit < 1) ? 10 : Math.min(limit, 100);
            JdbcTemplate src = new JdbcTemplate(dataSource);
            // SQL 检测用 JDBC 层 setMaxRows 限速，避免方言分页后缀
            // （Oracle 11g 不支持 FETCH FIRST / MySQL 无 OFFSET FETCH 语法差异等）
            src.setMaxRows(lim);
            src.setFetchSize(Math.min(lim, 1000));
            List<Map<String, Object>> rows = src.queryForList(bound.sql, bound.args);
            List<String> columns = rows.isEmpty() ? new ArrayList<>() : new ArrayList<>(rows.get(0).keySet());
            return SqlTestResp.builder().ok(true).columns(columns).rows(rows).rowCount(rows.size())
                    .costMs(System.currentTimeMillis() - t0).build();
        } catch (Exception e) {
            String msg = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
            if (msg == null || msg.isBlank()) {
                msg = e.toString();
            }
            return SqlTestResp.builder().ok(false).message(msg)
                    .costMs(System.currentTimeMillis() - t0).build();
        }
    }

    private long doRun(String dsCode, LocalDateTime startOverride, LocalDateTime endOverride) {
        PullCtx ctx = loadCtx(dsCode);   // 配置校验（ds 不存在/enabled=0 先抛业务异常）

        // 就绪门（T06-spec §4.3/G19）：NOT_READY → 本轮不拉取（不写 pull_run）；DEGRADED → 降级继续
        ReadinessGateEvaluator.Evaluation gate = readinessGateEvaluator.evaluateForDs(dsCode, System.currentTimeMillis());
        if (gate.result == ReadinessGateEvaluator.GateResult.NOT_READY) {
            log.info("pull {} skipped by readiness gate (not ready)", dsCode);
            return 0;
        }

        ReconConnection conn = ctx.conn;
        LocalDateTime end = endOverride != null ? endOverride : LocalDateTime.now();
        LocalDateTime start = startOverride;
        if (start == null) {
            LocalDateTime lastEnd = pullRunDao.findLastSuccessWindowEnd(dsCode);
            int overlap = conn == null ? 300
                    : (conn.getFetchOverlapSec() == null ? 300 : conn.getFetchOverlapSec());
            start = lastEnd != null ? lastEnd.minusSeconds(overlap) : initialStart(ctx.fetchConfig, end);
        }
        long runId = pullRunDao.start(dsCode, start, end);
        if (gate.result == ReadinessGateEvaluator.GateResult.DEGRADED) {
            pullRunDao.updateReadiness(runId, 0, 1, gate.logJson);
            log.warn("pull {} degraded by readiness gate (max_wait exceeded)", dsCode);
        } else {
            pullRunDao.updateReadiness(runId, 1, 0, gate.logJson);
        }
        long t0 = System.currentTimeMillis();
        log.info("pull start: ds={} runId={} window={}~{} gate={}", dsCode, runId, start, end, gate.result);
        int rowCount = 0;
        int insertCount = 0;
        int updateCount = 0;
        int batchNo = 0;
        List<String> errorRows = new ArrayList<>();
        try {
            TransactionTemplate tt = new TransactionTemplate(txManager);
            String timeField = ctx.ds.getTimeField();
            String pkField = "db".equals(ctx.fetchType) ? keysetPkField(ctx) : null;
            LocalDateTime lastTime = null;
            String lastPk = null;
            while (true) {
                FetchBatch batch = ctx.fetcher.fetchBatch(
                        start, end, lastTime, lastPk, timeField, pkField, BATCH_SIZE);
                if (batch.rows().isEmpty()) {
                    break;
                }
                LedgerDao.BatchResult r = tt.execute(status -> {
                    LedgerDao.BatchResult br = ledgerService.upsertRows(
                            dsCode, ctx.ds.getRecordKeyExpression(), batch.rows(), runId,
                            timeField, ctx.amountSpec);
                    seqWatermarkService.commit(dsCode, br.maxSeq);     // G5：批内原子
                    return br;
                });
                if (r == null) {
                    break;
                }
                batchNo++;
                rowCount += batch.rows().size();
                insertCount += r.insertCount;
                updateCount += r.updateCount;
                errorRows.addAll(r.errorRows);
                lastTime = batch.lastTime();
                lastPk = batch.lastPk();
                if (batchNo % 5 == 0) {
                    log.info("pull progress: ds={} runId={} rows={} insert={} update={} batch={} lastTime={}",
                            dsCode, runId, rowCount, insertCount, updateCount, batchNo, lastTime);
                }
            }
            Integer lastSuccessCount = pullRunDao.findLastSuccessRowCount(dsCode);
            HealthEvaluator.HealthResult health = healthEvaluator.eval(ctx.ds, rowCount, lastSuccessCount, null);
            ObjectNode detail = JsonUtil.parseObject(health.detailJson);
            detail.put("error_rows", JsonUtil.toString(errorRows));
            pullRunDao.finishSuccess(runId, health.status, detail.toString(),
                    rowCount, insertCount, updateCount, null);
            log.info("pull done: ds={} runId={} status=success rows={} insert={} update={} health={} errorRows={} elapsedMs={}",
                    dsCode, runId, rowCount, insertCount, updateCount, health.status, errorRows.size(),
                    System.currentTimeMillis() - t0);
            return runId;
        } catch (Exception e) {
            log.error("pull failed ds={} runId={} rows={} elapsedMs={}", dsCode, runId, rowCount,
                    System.currentTimeMillis() - t0, e);
            HealthEvaluator.HealthResult health = healthEvaluator.eval(ctx.ds, rowCount, null, e.getMessage());
            pullRunDao.finishFailed(runId, e.getMessage(), health.detailJson);
            throw e;
        }
    }

    /** 配置快照 + 取数通道 + AmountSpec（一次装载，批循环内零 JPA，技术适配 §2.4）。 */
    private PullCtx loadCtx(String dsCode) {
        ReconDatasource ds = datasourceRepository.findByDsCode(dsCode)
                .orElseThrow(() -> new BizException(ErrorCode.DS_NOT_FOUND));
        if (ds.getEnabled() == null || ds.getEnabled() != 1) {
            throw new BizException(ErrorCode.PULL_DS_DISABLED);
        }
        ObjectNode fetchConfig = JsonUtil.parseObject(ds.getFetchConfigJson());
        String fetchType = ds.getFetchType() == null ? "db" : ds.getFetchType();

        PullCtx ctx = new PullCtx();
        ctx.ds = ds;
        ctx.fetchConfig = fetchConfig;
        ctx.amountSpec = ledgerService.resolveAmountSpec(ds);
        ctx.fetchType = fetchType;

        switch (fetchType) {
            case "api" -> {
                if (fetchConfig == null || !fetchConfig.has("url")) {
                    throw new BizException(ErrorCode.FETCH_API_ERROR, "api 取数配置缺失 url");
                }
                ctx.fetcher = new ApiFetcher(fetchConfig);
            }
            case "custom" -> {
                String cls = fetchConfig == null ? null : fetchConfig.path("class").asText(null);
                CustomFetcher impl = customLoader.load(cls, CustomFetcher.class);
                Map<String, Object> params = parseCustomParams(fetchConfig);
                ctx.fetcher = new CustomFetcherAdapter(impl, params);
            }
            default -> {
                // db：连接池 + 方言 + SQL 模板
                String fetchMode = fetchConfig == null ? null : fetchConfig.path("fetch_mode").asText(null);
                if (!"time".equals(fetchMode)) {
                    throw new BizException(ErrorCode.FETCH_SQL_MISSING,
                            "拉取模式暂只支持 time（当前: " + fetchMode + "）");
                }
                String fetchSql = fetchConfig.path("sql").asText(null);
                if (fetchSql == null || fetchSql.isBlank()) {
                    throw new BizException(ErrorCode.FETCH_SQL_MISSING);
                }
                ReconConnection conn = connectionRepository.findByConnCode(ds.getConnCode())
                        .orElseThrow(() -> new BizException(ErrorCode.CONN_NOT_READY,
                                "数据源引用的连接不存在: " + ds.getConnCode()));
                DataSource dataSource = connectionPoolManager.getDataSource(ds.getConnCode());
                DbDialect dialect;
                try {
                    dialect = DbDialect.from(conn.getType());
                } catch (IllegalArgumentException e) {
                    throw new BizException(ErrorCode.CONN_NOT_READY, e.getMessage());
                }
                ctx.conn = conn;
                ctx.dataSource = dataSource;
                String fetchOneSql = fetchConfig.path("fetch_one_sql").asText(null);
                ctx.fetcher = new SourceFetcher(dataSource, dialect, fetchSql, fetchOneSql);
            }
        }
        return ctx;
    }

    /** custom 拉取参数：fetch_config_json.config_json 原样透传（取数层需求规格 §4.4）。 */
    private Map<String, Object> parseCustomParams(ObjectNode fetchConfig) {
        if (fetchConfig == null || !fetchConfig.has("config_json") || !fetchConfig.get("config_json").isObject()) {
            return Map.of();
        }
        return OM.convertValue(fetchConfig.get("config_json"),
                new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {
                });
    }

    private LocalDateTime initialStart(ObjectNode fetchConfig, LocalDateTime end) {
        String initial = fetchConfig == null ? null : fetchConfig.path("initial_start").asText(null);
        if (initial != null && !initial.isBlank()) {
            try {
                return LocalDateTime.parse(initial, TIME_FMT);
            } catch (Exception e) {
                return end.minusDays(1);
            }
        }
        return end.minusDays(1);
    }

    /** G3：keyset_pk_field 默认 = record_key_expression 首个 {field}。 */
    private String keysetPkField(PullCtx ctx) {
        String explicit = ctx.fetchConfig.path("keyset_pk_field").asText(null);
        if (explicit != null && !explicit.isBlank()) {
            return explicit;
        }
        List<String> fields = KeyExprEvaluator.extractFields(ctx.ds.getRecordKeyExpression());
        if (fields.isEmpty()) {
            throw new BizException(ErrorCode.RECORD_KEY_MISSING);
        }
        return fields.get(0);
    }

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private static final com.fasterxml.jackson.databind.ObjectMapper OM = new com.fasterxml.jackson.databind.ObjectMapper();

    private static class PullCtx {
        ReconDatasource ds;
        ReconConnection conn;
        ObjectNode fetchConfig;
        String fetchType;
        DataSource dataSource;
        LedgerDao.AmountSpec amountSpec;
        PullFetcher fetcher;
    }
}
