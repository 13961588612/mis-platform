package com.mis.recon.service.config;

import com.mis.recon.common.BizException;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.domain.dto.CheckSaveReq;
import com.mis.recon.domain.dto.DatasourceSaveReq;
import com.mis.recon.repository.ConnectionRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.repository.ScenarioRepository;
import com.mis.recon.service.engine.CustomLoader;
import com.mis.recon.service.support.ConnectionPoolManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 配置校验单测（mock Repository 层，不 gate mvn test）。
 */
class ConfigValidationServiceTest {

    private ConfigValidationService service;

    @BeforeEach
    void setUp() {
        ConnectionRepository connRepo = Mockito.mock(ConnectionRepository.class);
        DatasourceRepository dsRepo = Mockito.mock(DatasourceRepository.class);
        ScenarioRepository scenarioRepo = Mockito.mock(ScenarioRepository.class);
        service = new ConfigValidationService(connRepo, dsRepo, scenarioRepo,
                Mockito.mock(CustomLoader.class), Mockito.mock(ConnectionPoolManager.class));
    }

    // ==================== V20 窗口参数 ====================

    @Test
    void v20TimeMissingStartRejected() {
        DatasourceSaveReq req = ds();
        req.setFetchConfigJson("{\"fetch_mode\":\"time\",\"sql\":\"SELECT * FROM t WHERE ts <= :p_end\"}");
        assertCode(6201, () -> service.validateDatasource(req));
    }

    @Test
    void v20TimeMissingEndRejected() {
        DatasourceSaveReq req = ds();
        req.setFetchConfigJson("{\"fetch_mode\":\"time\",\"sql\":\"SELECT * FROM t WHERE ts >= :p_start\"}");
        assertCode(6201, () -> service.validateDatasource(req));
    }

    @Test
    void v20PkMissingLastPkRejected() {
        DatasourceSaveReq req = ds();
        req.setFetchConfigJson("{\"fetch_mode\":\"pk\",\"sql\":\"SELECT * FROM t WHERE id > 0\"}");
        assertCode(6201, () -> service.validateDatasource(req));
    }

    @Test
    void v20CompletePasses() {
        DatasourceSaveReq req = ds();
        req.setFetchConfigJson("{\"fetch_mode\":\"time\",\"sql\":\"SELECT * FROM t WHERE ts >= :p_start AND ts <= :p_end\"}");
        req.setKeyScanSql("SELECT id FROM t WHERE ts >= :p_start AND ts <= :p_end");
        assertDoesNotThrow(() -> service.validateDatasource(req));
    }

    // ==================== V36 占位符白名单（双保险） ====================

    @Test
    void v36FetchOneWrongPlaceholderRejected() {
        DatasourceSaveReq req = ds();
        req.setFetchConfigJson("{\"fetch_mode\":\"time\",\"sql\":\"SELECT * FROM t WHERE ts >= :p_start AND ts <= :p_end\","
                + "\"fetch_one_sql\":\"SELECT * FROM t WHERE id = {record}\"}");
        assertCode(6212, () -> service.validateDatasource(req));
    }

    @Test
    void v36FetchOneRecordKeyPasses() {
        DatasourceSaveReq req = ds();
        req.setFetchConfigJson("{\"fetch_mode\":\"time\",\"sql\":\"SELECT * FROM t WHERE ts >= :p_start AND ts <= :p_end\","
                + "\"fetch_one_sql\":\"SELECT * FROM t WHERE id = {record_key}\"}");
        assertDoesNotThrow(() -> service.validateDatasource(req));
    }

    @Test
    void v36FetchOneNamedRecordKeyPasses() {
        DatasourceSaveReq req = ds();
        req.setFetchConfigJson("{\"fetch_mode\":\"time\",\"sql\":\"SELECT * FROM t WHERE ts >= :p_start AND ts <= :p_end\","
                + "\"fetch_one_sql\":\"SELECT * FROM t WHERE id = :record_key\"}");
        assertDoesNotThrow(() -> service.validateDatasource(req));
    }

    @Test
    void v36MainSqlExtraPlaceholderRejected() {
        DatasourceSaveReq req = ds();
        req.setFetchConfigJson("{\"fetch_mode\":\"time\",\"sql\":\"SELECT * FROM t WHERE ts >= :p_start AND ts <= :p_end AND code = {record_key}\"}");
        assertCode(6212, () -> service.validateDatasource(req));
    }

    @Test
    void v36PkModeOnlyLastPkAllowed() {
        DatasourceSaveReq req = ds();
        req.setFetchConfigJson("{\"fetch_mode\":\"pk\",\"sql\":\"SELECT * FROM t WHERE id > :p_last_pk AND id = {record_key}\"}");
        assertCode(6212, () -> service.validateDatasource(req));
    }

    // ==================== V21 容差整数 ====================

    @Test
    void v21FractionToleranceRejected() {
        CheckSaveReq req = check();
        req.getCompareRule().setRulesJson("[{\"name\":\"a\",\"tolerance\":1.5}]");
        assertCode(6202, () -> service.validateCheck(req, null, Collections.emptyList(), new HashMap<>()));
    }

    @Test
    void v21IntegerTolerancePasses() {
        CheckSaveReq req = check();
        req.getCompareRule().setRulesJson("[{\"name\":\"a\",\"tolerance\":1}]");
        assertDoesNotThrow(() -> service.validateCheck(req, null, Collections.emptyList(), new HashMap<>()));
    }

    @Test
    void v21TrailingZeroTolerancePasses() {
        CheckSaveReq req = check();
        req.getCompareRule().setRulesJson("[{\"name\":\"a\",\"tolerance\":1.0}]");
        assertDoesNotThrow(() -> service.validateCheck(req, null, Collections.emptyList(), new HashMap<>()));
    }

    // ==================== V22 聚合禁窗口 ====================

    @Test
    void v22AggregatedWithWindowRejected() {
        DatasourceSaveReq req = ds();
        req.setGrain("aggregated");
        req.setAggSql("SELECT k, SUM(amount) FROM t WHERE ts >= :p_start");
        assertCode(6203, () -> service.validateDatasource(req));
    }

    @Test
    void v22RowGrainSkips() {
        DatasourceSaveReq req = ds();
        req.setGrain("row");
        req.setAggSql("SELECT k, SUM(amount) FROM t WHERE ts >= :p_start");
        assertDoesNotThrow(() -> service.validateDatasource(req));
    }

    // ==================== V33 非货币禁 primary ====================

    @Test
    void v33PointPrimaryRejected() {
        DatasourceSaveReq req = ds();
        req.setAmountFieldsJson("{\"points\":{\"unit\":\"point\",\"role\":\"primary\"}}");
        assertCode(6204, () -> service.validateDatasource(req));
    }

    @Test
    void v33PointAuxPasses() {
        DatasourceSaveReq req = ds();
        req.setAmountFieldsJson("{\"points\":{\"unit\":\"point\",\"role\":\"aux\"}}");
        assertDoesNotThrow(() -> service.validateDatasource(req));
    }

    @Test
    void v33YuanPrimaryPasses() {
        DatasourceSaveReq req = ds();
        req.setAmountFieldsJson("{\"amount\":{\"unit\":\"yuan\",\"role\":\"primary\"}}");
        assertDoesNotThrow(() -> service.validateDatasource(req));
    }

    // ==================== V34 UNION 列对齐 ====================

    @Test
    void v34SelectStarRejected() {
        DatasourceSaveReq req = ds();
        req.setKeyScanSql("SELECT * FROM t1 UNION ALL SELECT order_no, amount FROM t2");
        assertCode(6205, () -> service.validateDatasource(req));
    }

    @Test
    void v34ColumnCountMismatchRejected() {
        DatasourceSaveReq req = ds();
        req.setKeyScanSql("SELECT order_no FROM t1 UNION ALL SELECT order_no, amount FROM t2");
        assertCode(6205, () -> service.validateDatasource(req));
    }

    @Test
    void v34ColumnNameMisalignRejected() {
        DatasourceSaveReq req = ds();
        req.setKeyScanSql("SELECT order_no, amount FROM t1 UNION ALL SELECT order_no, pay_amount FROM t2");
        assertCode(6205, () -> service.validateDatasource(req));
    }

    @Test
    void v34AlignedPasses() {
        DatasourceSaveReq req = ds();
        req.setKeyScanSql("SELECT order_no, amount FROM t1 UNION ALL SELECT order_no, amount FROM t2");
        assertDoesNotThrow(() -> service.validateDatasource(req));
    }

    // ==================== V35 断言位恒通过 ====================

    @Test
    void v35AssertionCallable() {
        assertDoesNotThrow(() -> service.validateUnionAmountType("conn1", "SELECT amount FROM t1 UNION ALL SELECT amount FROM t2"));
    }

    // ==================== consume mode 一致 / 禁改 / time_field / 窗口 / record_key ====================

    @Test
    void consumeModeMixedRejected() {
        CheckSaveReq req = check();
        req.setConsumeJson("{\"a\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"},"
                + "\"b\":{\"ds_code\":\"d2\",\"mode\":\"time_window\",\"start\":\"2026-07-30 00:00:00\",\"end\":\"2026-07-31 23:59:59\"}}");
        assertCode(6207, () -> service.validateCheck(req, null, Collections.emptyList(), new HashMap<>()));
    }

    @Test
    void checkNameFrozenRejected() {
        CheckSaveReq req = check();
        assertCode(5002, () -> service.validateCheck(req, "old_name", Collections.emptyList(), new HashMap<>()));
    }

    @Test
    void timeFieldMismatchRejected() {
        CheckSaveReq req = check();
        req.setConsumeJson("{\"orders\":{\"ds_code\":\"d1\",\"mode\":\"incremental\",\"time_field\":\"pay_time\"}}");
        Map<String, ReconDatasource> dsByCode = new HashMap<>();
        ReconDatasource ds = new ReconDatasource();
        ds.setDsCode("d1");
        ds.setTimeField("update_time");
        dsByCode.put("d1", ds);
        assertCode(6209, () -> service.validateCheck(req, null, Collections.emptyList(), dsByCode));
    }

    @Test
    void windowMissingRejected() {
        CheckSaveReq req = check();
        req.setConsumeJson("{\"a\":{\"ds_code\":\"d1\",\"mode\":\"time_window\"}}");
        assertCode(6210, () -> service.validateCheck(req, null, Collections.emptyList(), new HashMap<>()));
    }

    @Test
    void windowEndNotAfterStartRejected() {
        CheckSaveReq req = check();
        req.setWindowStart("2026-07-31 23:59:59");
        req.setWindowEnd("2026-07-30 00:00:00");
        req.setConsumeJson("{\"a\":{\"ds_code\":\"d1\",\"mode\":\"time_window\"}}");
        assertCode(6210, () -> service.validateCheck(req, null, Collections.emptyList(), new HashMap<>()));
    }

    @Test
    void recordKeyBlankRejected() {
        DatasourceSaveReq req = ds();
        req.setRecordKeyExpression("   ");
        assertCode(6208, () -> service.validateDatasource(req));
    }

    @Test
    void aliasConflictRejected() {
        CheckSaveReq req = check();
        req.setConsumeJson("{\"alias_x\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"}}");
        ReconCheck existing = new ReconCheck();
        existing.setScenarioCode("online_order");
        existing.setCheckName("other");
        existing.setConsumeJson("{\"alias_y\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"}}");
        assertCode(5003, () -> service.validateCheck(req, null, Collections.singletonList(existing), new HashMap<>()));
    }

    @Test
    void uniqueHelpersDelegate() {
        ConnectionRepository connRepo = Mockito.mock(ConnectionRepository.class);
        DatasourceRepository dsRepo = Mockito.mock(DatasourceRepository.class);
        ScenarioRepository scenarioRepo = Mockito.mock(ScenarioRepository.class);
        Mockito.when(connRepo.existsByConnCode("c1")).thenReturn(true);
        Mockito.when(dsRepo.existsByDsCode("d1")).thenReturn(true);
        Mockito.when(scenarioRepo.existsByScenarioCode("s1")).thenReturn(true);
        ConfigValidationService svc = new ConfigValidationService(connRepo, dsRepo, scenarioRepo,
                Mockito.mock(CustomLoader.class), Mockito.mock(ConnectionPoolManager.class));
        assertTrue(svc.existsConnCode("c1"));
        assertTrue(svc.existsDsCode("d1"));
        assertTrue(svc.existsScenarioCode("s1"));
    }

    // ==================== V 组：sum_check 保存校验（T05-spec-sum-check §13.4） ====================

    @Test
    void vSumCheckTwoDatasetsRejected() {
        // V-1：sum_check datasets=2 → 拦截
        CheckSaveReq req = check();
        req.getMatchRule().setStrategy("sum_check");
        req.getMatchRule().setDatasetsJson("[\"orders\",\"pay\"]");
        req.setConsumeJson("{\"orders\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"},"
                + "\"pay\":{\"ds_code\":\"d2\",\"mode\":\"incremental\"}}");
        assertCode(1001, () -> service.validateCheck(req, null, Collections.emptyList(), new HashMap<>()));
    }

    @Test
    void vSumCheckMissingExprRejected() {
        // V-2：sum_check left_expr 为空 → 拦截
        CheckSaveReq req = check();
        req.getMatchRule().setStrategy("sum_check");
        req.getMatchRule().setDatasetsJson("[\"orders\"]");
        req.getCompareRule().setRulesJson(
                "[{\"name\":\"总额勾稽\",\"left_expr\":\"\",\"right_expr\":\"orders.a + orders.b\"}]");
        assertCode(1001, () -> service.validateCheck(req, null, Collections.emptyList(), new HashMap<>()));
    }

    @Test
    void vSumCheckValidPasses() {
        // V-3：sum_check 合法配置 → 通过
        CheckSaveReq req = check();
        req.getMatchRule().setStrategy("sum_check");
        req.getMatchRule().setDatasetsJson("[\"orders\"]");
        req.getCompareRule().setRulesJson(
                "[{\"name\":\"总额勾稽\",\"left_expr\":\"orders.total_amount\","
                        + "\"right_expr\":\"orders.a + orders.b\",\"tolerance\":{\"type\":\"absolute\",\"value\":100},"
                        + "\"is_amount\":true}]");
        assertDoesNotThrow(() -> service.validateCheck(req, null, Collections.emptyList(), new HashMap<>()));
    }

    @Test
    void vExactKeyNoRegression() {
        // V-4：exact_key 校验无回归（恰好 2 个数据源通过）
        CheckSaveReq req = check();
        req.setConsumeJson("{\"orders\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"},"
                + "\"pay\":{\"ds_code\":\"d2\",\"mode\":\"incremental\"}}");
        assertDoesNotThrow(() -> service.validateCheck(req, null, Collections.emptyList(), new HashMap<>()));
    }

    // ==================== 辅助 ====================

    private DatasourceSaveReq ds() {
        DatasourceSaveReq req = new DatasourceSaveReq();
        req.setDsCode("d1");
        req.setName("数据源1");
        req.setRecordKeyExpression("{order_no}");
        req.setFetchType("db");
        return req;
    }

    private CheckSaveReq check() {
        CheckSaveReq req = new CheckSaveReq();
        req.setScenarioCode("online_order");
        req.setCheckName("c1");
        req.setConsumeJson("{\"orders\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"}}");
        CheckSaveReq.MatchRuleReq match = new CheckSaveReq.MatchRuleReq();
        match.setStrategy("exact_key");
        req.setMatchRule(match);
        CheckSaveReq.CompareRuleReq compare = new CheckSaveReq.CompareRuleReq();
        compare.setRulesJson("[]");
        req.setCompareRule(compare);
        return req;
    }

    private void assertCode(int expected, Runnable action) {
        BizException ex = assertThrows(BizException.class, action::run);
        assertEquals(expected, ex.getCode());
    }
}
