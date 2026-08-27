package com.mis.recon.service.pull;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import com.mis.recon.domain.runtime.MatchResult;
import com.mis.recon.service.engine.CompareEngine;
import com.mis.recon.service.engine.ConfigSnapshot;
import com.mis.recon.service.engine.CustomLoader;
import com.mis.recon.service.engine.MatchEngine;
import com.mis.recon.service.engine.MatchedIndexService;
import com.mis.recon.service.engine.PoolService;
import com.mis.recon.service.engine.VerdictService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * ReconRunner custom 分支单测（第三批 C2，M 组）：主流程分发 → CustomLoader 加载 → 自定义匹配 →
 * 复用既有判定链路；内置 MatchEngine 不参与。
 */
class ReconRunnerCustomTest {

    private ConfigSnapshot configSnapshot;
    private CustomLoader customLoader;
    private MatchEngine matchEngine;
    private VerdictService verdictService;
    private LedgerDao ledgerDao;
    private ReconRunner runner;

    @BeforeEach
    void setUp() {
        configSnapshot = mock(ConfigSnapshot.class);
        WatermarkDao watermarkDao = mock(WatermarkDao.class);
        CursorDao cursorDao = mock(CursorDao.class);
        ledgerDao = mock(LedgerDao.class);
        PullRunDao pullRunDao = mock(PullRunDao.class);
        ReconRunDao reconRunDao = mock(ReconRunDao.class);
        BacklogWindowDao backlogWindowDao = mock(BacklogWindowDao.class);
        matchEngine = mock(MatchEngine.class);
        CompareEngine compareEngine = mock(CompareEngine.class);
        customLoader = mock(CustomLoader.class);
        PoolService poolService = mock(PoolService.class);
        MatchedIndexService matchedIndexService = mock(MatchedIndexService.class);
        verdictService = mock(VerdictService.class);
        PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);

        runner = new ReconRunner(configSnapshot, watermarkDao, cursorDao, ledgerDao, pullRunDao,
                reconRunDao, backlogWindowDao, matchEngine, compareEngine, customLoader, poolService,
                matchedIndexService, verdictService, txManager, new ObjectMapper());

        when(watermarkDao.get(anyString())).thenReturn(0L);
        when(cursorDao.get(anyString(), anyString(), anyString())).thenReturn(0L);
        when(ledgerDao.queryBySeq(anyString(), anyLong(), anyLong())).thenReturn(List.of());
        when(backlogWindowDao.scanUnresolved(anyString(), anyString())).thenReturn(List.of());
        when(poolService.openAndRestore(anyString(), anyString(), anyInt())).thenReturn(List.of());
        when(reconRunDao.insertRun("s1")).thenReturn(1L);
        when(verdictService.apply(any(), any(), any(), anyMap())).thenReturn(new VerdictService.Stats());
    }

    private ConfigSnapshot.LoadedScenario customScenario() {
        ConfigSnapshot.LoadedScenario scenario = new ConfigSnapshot.LoadedScenario();
        scenario.scenarioCode = "s1";
        ConfigSnapshot.CheckSpec check = new ConfigSnapshot.CheckSpec();
        check.checkName = "c1";
        check.strategy = "custom";
        check.customClass = "com.mis.recon.custom.example.CrossSystemIdMatcher";
        check.customParams = Map.of("id_mapping_table", "t");
        check.match = new MatchEngine.MatchRuleConfig();
        check.match.strategy = "custom";
        check.match.datasets = List.of("d1", "d2");
        ConfigSnapshot.DsConsume left = new ConfigSnapshot.DsConsume();
        left.alias = "orders";
        left.dsCode = "d1";
        left.mode = "incremental";
        ConfigSnapshot.DsConsume right = new ConfigSnapshot.DsConsume();
        right.alias = "ext";
        right.dsCode = "d2";
        right.mode = "incremental";
        check.consumes.add(left);
        check.consumes.add(right);
        scenario.checks.add(check);
        scenario.usesDsCodes.add("d1");
        scenario.usesDsCodes.add("d2");
        return scenario;
    }

    @Test
    void customStrategyDispatchesToCustomMatcher() {
        // M-6：strategy=custom → CustomLoader 加载 → 自定义匹配 → 复用既有判定；内置 MatchEngine 不参与
        when(configSnapshot.load("s1")).thenReturn(customScenario());
        CustomMatcher matcher = mock(CustomMatcher.class);
        when(customLoader.load("com.mis.recon.custom.example.CrossSystemIdMatcher", CustomMatcher.class))
                .thenReturn(matcher);
        MatchResult result = MatchResult.builder().pairs(new ArrayList<>()).unmatchedLeft(new ArrayList<>())
                .unmatchedRight(new ArrayList<>()).anomalies(new ArrayList<>()).build();
        when(matcher.match(anyMap(), anyMap())).thenReturn(result);

        long runId = runner.run("s1");

        assertEquals(1L, runId);
        verify(customLoader).load("com.mis.recon.custom.example.CrossSystemIdMatcher", CustomMatcher.class);
        verify(matcher).match(anyMap(), eq(Map.of("id_mapping_table", "t")));
        verify(verdictService).apply(any(ConfigSnapshot.LoadedScenario.class),
                any(ConfigSnapshot.CheckSpec.class), eq(result), anyMap());
        verify(matchEngine, never()).match(any(), any());
    }

    private ConfigSnapshot.LoadedScenario customCheckScenario() {
        ConfigSnapshot.LoadedScenario scenario = new ConfigSnapshot.LoadedScenario();
        scenario.scenarioCode = "s1";
        ConfigSnapshot.CheckSpec check = new ConfigSnapshot.CheckSpec();
        check.checkName = "c1";
        check.strategy = "custom_check";
        check.customClass = "com.mis.recon.custom.example.OrderLifecycleCheck";
        check.customParams = Map.of("window_days", 7);
        check.match = null;   // 整检查无匹配键
        String[] aliases = {"orders", "ext", "coupons"};
        String[] dss = {"d1", "d2", "d3"};
        for (int i = 0; i < aliases.length; i++) {
            ConfigSnapshot.DsConsume c = new ConfigSnapshot.DsConsume();
            c.alias = aliases[i];
            c.dsCode = dss[i];
            c.mode = "incremental";
            check.consumes.add(c);
            scenario.usesDsCodes.add(dss[i]);
        }
        scenario.checks.add(check);
        return scenario;
    }

    @Test
    void customCheckStrategyDispatchesToExecutor() {
        // X-3：strategy=custom_check → CustomLoader 加载 CustomCheckExecutor → execute → 差异直接 confirmed 落池；
        // 内置 MatchEngine 不参与
        when(configSnapshot.load("s1")).thenReturn(customCheckScenario());
        CustomCheckExecutor executor = mock(CustomCheckExecutor.class);
        when(customLoader.load("com.mis.recon.custom.example.OrderLifecycleCheck", CustomCheckExecutor.class))
                .thenReturn(executor);
        List<CustomDiff> diffs = List.of(CustomDiff.builder()
                .matchKeyHash("hash-lifecycle").matchKeyDisplay("ORDER-1")
                .diffDesc("订单生命周期异常：已退款未完成生命周期").diffAmountCent(-1000L).build());
        when(executor.execute(any(CustomCheckContext.class))).thenReturn(diffs);

        long runId = runner.run("s1");

        assertEquals(1L, runId);
        verify(customLoader).load("com.mis.recon.custom.example.OrderLifecycleCheck", CustomCheckExecutor.class);
        verify(executor).execute(any(CustomCheckContext.class));
        verify(verdictService).applyCustomCheck(any(ConfigSnapshot.LoadedScenario.class),
                any(ConfigSnapshot.CheckSpec.class), eq(diffs), any(VerdictService.Stats.class));
        verify(matchEngine, never()).match(any(), any());
    }

    @Test
    void customCheckContextCarriesParamsAndDatasets() {
        // X-4：CustomCheckContext 参数/多数据集透传（§3.3：整检查上下文入参多数据集，params=config_json 除 class 外原样）
        when(configSnapshot.load("s1")).thenReturn(customCheckScenario());
        when(ledgerDao.queryBySeq("d1", 0L, 0L)).thenReturn(List.of(rec("d1", "r1")));
        when(ledgerDao.queryBySeq("d2", 0L, 0L)).thenReturn(List.of(rec("d2", "r2")));
        when(ledgerDao.queryBySeq("d3", 0L, 0L)).thenReturn(List.of(rec("d3", "r3")));
        CustomCheckExecutor executor = mock(CustomCheckExecutor.class);
        when(customLoader.load("com.mis.recon.custom.example.OrderLifecycleCheck", CustomCheckExecutor.class))
                .thenReturn(executor);
        when(executor.execute(any(CustomCheckContext.class))).thenReturn(List.of());

        runner.run("s1");

        ArgumentCaptor<CustomCheckContext> captor = ArgumentCaptor.forClass(CustomCheckContext.class);
        verify(executor).execute(captor.capture());
        CustomCheckContext ctx = captor.getValue();
        assertEquals("s1", ctx.getScenarioCode());
        assertEquals("c1", ctx.getCheckName());
        // 参数透传：config_json 除 class 外键值原样
        assertEquals(7, ctx.getParams().get("window_days"));
        // 多数据集透传：3 个消费数据源全部进入上下文
        assertEquals(Set.of("d1", "d2", "d3"), ctx.getDataset().keySet());
    }

    private ReconSourceRecord rec(String ds, String key) {
        return ReconSourceRecord.builder().dsCode(ds).recordKey(key).build();
    }
}