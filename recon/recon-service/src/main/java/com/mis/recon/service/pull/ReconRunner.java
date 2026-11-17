package com.mis.recon.service.pull;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.custom.CustomCheckContext;
import com.mis.recon.custom.CustomCheckExecutor;
import com.mis.recon.custom.CustomDiff;
import com.mis.recon.custom.CustomMatcher;
import com.mis.recon.dao.BacklogWindowDao;
import com.mis.recon.dao.CursorDao;
import com.mis.recon.dao.LedgerDao;
import com.mis.recon.dao.PullRunDao;
import com.mis.recon.dao.ReconRunDao;
import com.mis.recon.dao.WatermarkDao;
import com.mis.recon.domain.ledger.ReconSourceRecord;
import com.mis.recon.domain.runtime.BacklogWindow;
import com.mis.recon.domain.runtime.CompareResult;
import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchResult;
import com.mis.recon.domain.runtime.Mismatch;
import com.mis.recon.service.engine.CompareEngine;
import com.mis.recon.service.engine.ConfigSnapshot;
import com.mis.recon.service.engine.CustomLoader;
import com.mis.recon.service.engine.MatchEngine;
import com.mis.recon.service.engine.MatchedIndexService;
import com.mis.recon.service.engine.PoolService;
import com.mis.recon.service.engine.VerdictService;
import com.mis.recon.util.WindowExprResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 对账引擎主流程（F95，T05-spec §9）：配置快照 → 健康闸门 → 冻结上界 → per-check 事务
 * （合流 → 匹配 → 比较 → 判定 → 游标推进）→ run 统计。
 */
@Service
public class ReconRunner {

    private static final Logger log = LoggerFactory.getLogger(ReconRunner.class);
    private static final DateTimeFormatter ABS_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final ConfigSnapshot configSnapshot;
    private final WatermarkDao watermarkDao;
    private final CursorDao cursorDao;
    private final LedgerDao ledgerDao;
    private final PullRunDao pullRunDao;
    private final ReconRunDao reconRunDao;
    private final BacklogWindowDao backlogWindowDao;
    private final MatchEngine matchEngine;
    private final CompareEngine compareEngine;
    private final CustomLoader customLoader;
    private final PoolService poolService;
    private final MatchedIndexService matchedIndexService;
    private final VerdictService verdictService;
    private final TransactionTemplate txTemplate;
    private final ObjectMapper objectMapper;
    private final Map<String, Boolean> running = new ConcurrentHashMap<>();

    public ReconRunner(ConfigSnapshot configSnapshot, WatermarkDao watermarkDao, CursorDao cursorDao,
                       LedgerDao ledgerDao, PullRunDao pullRunDao, ReconRunDao reconRunDao,
                       BacklogWindowDao backlogWindowDao,
                       MatchEngine matchEngine, CompareEngine compareEngine, CustomLoader customLoader,
                       PoolService poolService, MatchedIndexService matchedIndexService,
                       VerdictService verdictService, PlatformTransactionManager txManager, ObjectMapper objectMapper) {
        this.configSnapshot = configSnapshot;
        this.watermarkDao = watermarkDao;
        this.cursorDao = cursorDao;
        this.ledgerDao = ledgerDao;
        this.pullRunDao = pullRunDao;
        this.reconRunDao = reconRunDao;
        this.backlogWindowDao = backlogWindowDao;
        this.matchEngine = matchEngine;
        this.compareEngine = compareEngine;
        this.customLoader = customLoader;
        this.poolService = poolService;
        this.matchedIndexService = matchedIndexService;
        this.verdictService = verdictService;
        this.txTemplate = new TransactionTemplate(txManager);
        this.txTemplate.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.objectMapper = objectMapper;
    }

    /** 手动触发：同步执行返回 run id */
    public long run(String scenarioCode) {
        return run(scenarioCode, null, null);
    }

    public long run(String scenarioCode, LocalDateTime startOverride, LocalDateTime endOverride) {
        if (running.putIfAbsent(scenarioCode, Boolean.TRUE) != null) {
            throw new BizException(ErrorCode.RECON_IN_PROGRESS);
        }
        try {
            return doRun(scenarioCode, startOverride, endOverride);
        } finally {
            running.remove(scenarioCode);
        }
    }

    private long doRun(String scenarioCode, LocalDateTime startOverride, LocalDateTime endOverride) {
        ConfigSnapshot.LoadedScenario scenario = configSnapshot.load(scenarioCode);
        if (scenario.checks.isEmpty()) {
            throw new BizException(ErrorCode.CHECK_NOT_FOUND, "场景无可用 check（enabled=1 且配置完整）");
        }
        long runId = reconRunDao.insertRun(scenarioCode);
        log.info("recon start: scenario={} runId={} checks={} usesDs={}", scenarioCode, runId,
                scenario.checks.stream().map(c -> c.checkName).toList(), scenario.usesDsCodes);

        String gate = checkHealthGate(scenario);
        if (gate != null) {
            reconRunDao.skipRun(runId, gate);
            LocalDateTime now = LocalDateTime.now();
            for (ConfigSnapshot.CheckSpec check : scenario.checks) {
                reconRunDao.insertBacklog(scenarioCode, check.checkName, now.minusDays(1), now);
            }
            log.warn("recon skip by health gate: {}", gate);
            return runId;
        }

        Map<String, Long> watermarks = new HashMap<>();
        for (String ds : scenario.usesDsCodes) {
            watermarks.put(ds, watermarkDao.get(ds));
        }

        VerdictService.Stats total = new VerdictService.Stats();
        Map<String, Map<String, Object>> consumed = new LinkedHashMap<>();
        List<String> errors = new ArrayList<>();

        for (ConfigSnapshot.CheckSpec check : scenario.checks) {
            try {
                txTemplate.executeWithoutResult(status -> {
                    VerdictService.Stats s = runCheck(scenario, check, watermarks, consumed, startOverride, endOverride);
                    total.add(s);
                });
            } catch (Exception e) {
                errors.add(check.checkName + ": " + e.getMessage());
                log.warn("check {} failed, continue next", check.checkName, e);
            }
        }

        String finalStatus = errors.isEmpty() ? "success" : "failed";
        reconRunDao.finishRun(runId, finalStatus, total.matched, total.diff, total.resolved,
                consumed, String.join("; ", errors));
        log.info("recon {} done: status={} matched={} diff={} resolved={}", scenarioCode,
                finalStatus, total.matched, total.diff, total.resolved);
        return runId;
    }

    /** per-check 事务体：合流 → 匹配 → 判定 → 游标推进 */
    private VerdictService.Stats runCheck(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                                          Map<String, Long> watermarks,
                                          Map<String, Map<String, Object>> consumed,
                                          LocalDateTime startOverride, LocalDateTime endOverride) {
        long t0 = System.currentTimeMillis();
        Map<String, List<LedgerRow>> dataset = new HashMap<>();
        Set<String> incrHashes = new HashSet<>();
        Map<String, String> dsAlias = new HashMap<>();
        for (ConfigSnapshot.DsConsume c : check.consumes) {
            dsAlias.put(c.dsCode, c.alias);
        }

        // 欠账补算（T06-spec §5）：健康闸门 skip 时写入的 backlog 窗口，本轮先补算（不跳过正常窗口）
        mergeBacklog(scenario.scenarioCode, check, dataset);

        for (ConfigSnapshot.DsConsume c : check.consumes) {
            if ("time_window".equals(c.mode)) {
                LocalDateTime start = startOverride != null ? startOverride : parseWindow(c.start);
                LocalDateTime end = endOverride != null ? endOverride : parseWindow(c.end);
                if (start == null || end == null || !end.isAfter(start)) {
                    throw new BizException(ErrorCode.WINDOW_RANGE_INVALID);
                }
                List<LedgerRow> rows = toRows(ledgerDao.queryByTime(c.dsCode, start, end), "incr");
                merge(dataset, rows);
                log.info("recon check consume: scenario={} check={} ds={} mode=time_window range={}~{} rows={}",
                        scenario.scenarioCode, check.checkName, c.dsCode, start, end, rows.size());
                consumed.computeIfAbsent(check.checkName, k -> new LinkedHashMap<>())
                        .put(c.dsCode + "|window", start + "~" + end);
            } else {
                long cur = cursorDao.get(scenario.scenarioCode, check.checkName, c.dsCode);
                long hi = watermarks.getOrDefault(c.dsCode, 0L);
                List<LedgerRow> rows = toRows(ledgerDao.queryBySeq(c.dsCode, cur, hi), "incr");
                merge(dataset, rows);
                // 有内置匹配键才预收集增量行 hash（索引回查用）；custom/custom_check 无匹配键 → 跳过
                if (check.match != null) {
                    for (LedgerRow row : rows) {
                        String h = matchEngine.computeKeyHash(check.match, c.dsCode, row);
                        if (h != null) {
                            incrHashes.add(h);
                        }
                    }
                }
                log.info("recon check consume: scenario={} check={} ds={} mode=seq cursor={}~{} rows={}",
                        scenario.scenarioCode, check.checkName, c.dsCode, cur, hi, rows.size());
                consumed.computeIfAbsent(check.checkName, k -> new LinkedHashMap<>()).put(c.dsCode, hi);
            }
        }

        // 合流：匹配索引回查（exact/composite 有匹配键）+ 未平差异池还原（sum_check 无匹配键，仅池还原）
        if (check.match != null && !check.match.keyFields.isEmpty()) {
            merge(dataset, matchedIndexService.restoreFromIndex(scenario.scenarioCode, check.checkName, "-", incrHashes));
        }
        merge(dataset, poolService.openAndRestore(scenario.scenarioCode, check.checkName, scenario.poolMaxAgeDays));

        VerdictService.Stats stats;
        if ("sum_check".equals(check.strategy)) {
            stats = runSumCheck(scenario, check, dataset);
        } else if ("custom".equals(check.strategy)) {
            stats = runCustomMatch(scenario, check, dataset, dsAlias);
        } else if ("custom_check".equals(check.strategy)) {
            stats = runCustomCheck(scenario, check, dataset);
        } else {
            MatchResult result = matchEngine.match(check.match, dataset);
            long emptyKey = result.getAnomalies().stream().filter(a -> "empty_key".equals(a.getReason())).count();
            log.info("recon check match: scenario={} check={} dataset={} pairs={} unmatchedLeft={} unmatchedRight={} anomalies={}(emptyKey={})",
                    scenario.scenarioCode, check.checkName,
                    dataset.entrySet().stream().map(e -> e.getKey() + "=" + e.getValue().size()).toList(),
                    result.pairCount(), result.getUnmatchedLeft().size(), result.getUnmatchedRight().size(),
                    result.anomalyCount(), emptyKey);
            stats = verdictService.apply(scenario, check, result, dsAlias);
        }

        for (ConfigSnapshot.DsConsume c : check.consumes) {
            if (!"time_window".equals(c.mode)) {
                cursorDao.advance(scenario.scenarioCode, check.checkName, c.dsCode,
                        watermarks.getOrDefault(c.dsCode, 0L));
            }
        }
        log.info("recon check done: scenario={} check={} matched={} diff={} resolved={} elapsedMs={}",
                scenario.scenarioCode, check.checkName, stats.matched, stats.diff, stats.resolved,
                System.currentTimeMillis() - t0);
        return stats;
    }

    /**
     * sum_check 分支（T05-spec-sum-check §8）：单源逐行勾稽 → applySumCheck。
     * <p>无匹配/索引构建：逐行逐规则 compareSum，任一规则不一致 → 行差异；
     * 全部一致 → applySumCheck 配平出池（findIdentity → resolved，幂等）。</p>
     */
    private VerdictService.Stats runSumCheck(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                                             Map<String, List<LedgerRow>> dataset) {
        ConfigSnapshot.DsConsume consume = check.consumes.get(0);
        List<LedgerRow> rows = dataset.getOrDefault(consume.dsCode, List.of());
        VerdictService.Stats stats = new VerdictService.Stats();
        log.info("recon check sum_check: scenario={} check={} ds={} alias={} rows={}",
                scenario.scenarioCode, check.checkName, consume.dsCode, consume.alias, rows.size());
        for (LedgerRow row : rows) {
            List<Mismatch> mismatches = new ArrayList<>();
            Long diffAmount = null;
            boolean consistent = true;
            for (CompareEngine.SumRuleConfig rule : check.sumRules) {
                CompareResult cr = compareEngine.compareSum(consume.alias, row.getRecordData(), rule);
                if (!cr.isConsistent()) {
                    consistent = false;
                    mismatches.addAll(cr.getMismatches());
                    if (diffAmount == null) {
                        diffAmount = cr.getDiffAmountCent();
                    }
                }
            }
            CompareResult rowResult = consistent
                    ? CompareResult.ok(check.sumRules.size())
                    : CompareResult.fail(mismatches, diffAmount, check.sumRules.size());
            verdictService.applySumCheck(scenario, check, row, rowResult, stats);
        }
        return stats;
    }

    /**
     * custom 分支（第三批 C2，custom-需求规格 §3.1/§4）：CustomLoader 加载 → 自定义匹配 →
     * 复用既有两两匹配判定链路（VerdictService.apply）。
     * <p>无内置匹配键/索引回查（前段已跳过）；匹配键、pairs/unmatched/anomalies 均由实现类决定；
     * 可选附带 diagnosisContext 合并进 diff_diagnosis_json。</p>
     */
    private VerdictService.Stats runCustomMatch(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                                                Map<String, List<LedgerRow>> dataset, Map<String, String> dsAlias) {
        CustomMatcher matcher = customLoader.load(check.customClass, CustomMatcher.class);
        MatchResult result = matcher.match(dataset, check.customParams);
        if (result == null) {
            result = MatchResult.builder().pairs(new ArrayList<>()).unmatchedLeft(new ArrayList<>())
                    .unmatchedRight(new ArrayList<>()).anomalies(new ArrayList<>()).build();
        }
        log.info("recon check custom_match: scenario={} check={} class={} pairs={} unmatchedLeft={} unmatchedRight={} anomalies={}",
                scenario.scenarioCode, check.checkName, check.customClass,
                result.pairCount(), result.getUnmatchedLeft().size(), result.getUnmatchedRight().size(),
                result.anomalyCount());
        return verdictService.apply(scenario, check, result, dsAlias);
    }

    /**
     * custom_check 分支（第三批 C3，custom-需求规格 §3.3）：CustomLoader 加载整检查执行器 →
     * 多数据集行集 + 参数构造上下文 → 执行产出差异直接 confirmed 落池。
     * <p>无匹配键/Tab C（前段已跳过索引回查）；差异身份由实现类决定（CustomDiff.matchKeyHash）。</p>
     */
    private VerdictService.Stats runCustomCheck(ConfigSnapshot.LoadedScenario scenario, ConfigSnapshot.CheckSpec check,
                                                Map<String, List<LedgerRow>> dataset) {
        CustomCheckExecutor executor = customLoader.load(check.customClass, CustomCheckExecutor.class);
        CustomCheckContext ctx = CustomCheckContext.builder()
                .scenarioCode(scenario.scenarioCode)
                .checkName(check.checkName)
                .dataset(dataset)
                .params(check.customParams)
                .build();
        List<CustomDiff> diffs = executor.execute(ctx);
        VerdictService.Stats stats = new VerdictService.Stats();
        log.info("recon check custom_check: scenario={} check={} class={} diffs={}",
                scenario.scenarioCode, check.checkName, check.customClass,
                diffs == null ? 0 : diffs.size());
        verdictService.applyCustomCheck(scenario, check, diffs, stats);
        return stats;
    }

    /** 欠账补算（T06-spec §5.1）：未 resolved backlog 窗口 → 覆盖该 check time_window ds 窗口区间补算 → 标记 resolved。 */
    private void mergeBacklog(String scenarioCode, ConfigSnapshot.CheckSpec check,
                              Map<String, List<LedgerRow>> dataset) {
        List<BacklogWindow> backlogs = backlogWindowDao.scanUnresolved(scenarioCode, check.checkName);
        if (backlogs.isEmpty()) {
            return;
        }
        LocalDateTime minStart = null;
        LocalDateTime maxEnd = null;
        for (BacklogWindow b : backlogs) {
            if (minStart == null || b.getWindowStart().isBefore(minStart)) {
                minStart = b.getWindowStart();
            }
            if (maxEnd == null || b.getWindowEnd().isAfter(maxEnd)) {
                maxEnd = b.getWindowEnd();
            }
        }
        for (ConfigSnapshot.DsConsume c : check.consumes) {
            if (!"time_window".equals(c.mode)) {
                continue;
            }
            merge(dataset, toRows(ledgerDao.queryByTime(c.dsCode, minStart, maxEnd), "incr"));
        }
        for (BacklogWindow b : backlogs) {
            backlogWindowDao.markResolved(b.getId());
        }
        log.info("backlog merged: scenario={} check={} windows={} range={}~{}",
                scenarioCode, check.checkName, backlogs.size(), minStart, maxEnd);
    }

    /** 健康闸门（最小版）：on_*=block 且最近 pull_run 对应 health → skip 整轮 */
    private String checkHealthGate(ConfigSnapshot.LoadedScenario scenario) {
        for (String ds : scenario.usesDsCodes) {
            String health = pullRunDao.findLatestHealth(ds);
            if (health == null) {
                continue;
            }
            boolean blocked = "degraded".equals(health) && "block".equals(scenario.onDegraded)
                    || "error".equals(health) && "block".equals(scenario.onError)
                    || "empty".equals(health) && "block".equals(scenario.onEmpty);
            if (blocked) {
                return "ds=" + ds + " health=" + health + " 触发健康闸门 on_*=block";
            }
        }
        return null;
    }

    /** 合流去重：按 (ds_code, record_key)，来源优先级 pool > incr > matched_index */
    private void merge(Map<String, List<LedgerRow>> dataset, List<LedgerRow> rows) {
        for (LedgerRow row : rows) {
            List<LedgerRow> list = dataset.computeIfAbsent(row.getDsCode(), k -> new ArrayList<>());
            boolean dup = false;
            for (int i = 0; i < list.size(); i++) {
                LedgerRow existing = list.get(i);
                if (existing.getRecordKey().equals(row.getRecordKey())) {
                    if ("pool".equals(row.getSource()) && !"pool".equals(existing.getSource())) {
                        list.set(i, row);
                    }
                    dup = true;
                    break;
                }
            }
            if (!dup) {
                list.add(row);
            }
        }
    }

    private List<LedgerRow> toRows(List<ReconSourceRecord> records, String source) {
        List<LedgerRow> rows = new ArrayList<>(records.size());
        for (ReconSourceRecord rec : records) {
            LedgerRow row = LedgerRow.of(rec, source);
            if (rec.getRecordData() != null) {
                try {
                    row.setRecordData(objectMapper.readTree(rec.getRecordData()));
                } catch (Exception e) {
                    row.setRecordData(null);
                }
            }
            rows.add(row);
        }
        return rows;
    }

    private LocalDateTime parseWindow(String expr) {
        if (expr == null || expr.isBlank()) {
            return null;
        }
        String e = expr.trim();
        if (WindowExprResolver.isRelative(e)) {
            return WindowExprResolver.resolve(e, LocalDateTime.now());
        }
        try {
            return LocalDateTime.parse(e, ABS_TIME);
        } catch (Exception ex) {
            log.warn("窗口表达式暂不支持: {}", expr);
            return null;
        }
    }
}
