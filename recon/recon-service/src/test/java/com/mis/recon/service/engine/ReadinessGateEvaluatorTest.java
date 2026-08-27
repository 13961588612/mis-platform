package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.dao.ReadinessGateDao;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.domain.runtime.GateConfig;
import com.mis.recon.repository.CheckRepository;
import com.mis.recon.repository.ScenarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * 就绪门求值单测（T06-spec §4）：flag_query / row_count_delta / stability_window / 降级。
 */
class ReadinessGateEvaluatorTest {

    private ReadinessGateDao gateDao;
    private ScenarioRepository scenarioRepository;
    private CheckRepository checkRepository;
    private JdbcTemplate jdbcTemplate;
    private ObjectMapper objectMapper;
    private ReadinessGateEvaluator evaluator;

    @BeforeEach
    void setUp() {
        gateDao = Mockito.mock(ReadinessGateDao.class);
        scenarioRepository = Mockito.mock(ScenarioRepository.class);
        checkRepository = Mockito.mock(CheckRepository.class);
        jdbcTemplate = Mockito.mock(JdbcTemplate.class);
        objectMapper = new ObjectMapper();
        evaluator = new ReadinessGateEvaluator(gateDao, scenarioRepository, checkRepository, jdbcTemplate, objectMapper);
    }

    private GateConfig gate(String name, String type, String sql, String configJson, int minWait, int maxWait) {
        ObjectNode cfg = null;
        if (configJson != null) {
            try {
                cfg = (ObjectNode) objectMapper.readTree(configJson);
            } catch (Exception e) {
                cfg = null;
            }
        }
        return new GateConfig(name, type, sql, cfg, minWait, maxWait);
    }

    @Test
    void noGatesPasses() {
        when(gateDao.findEnabled("sc")).thenReturn(List.of());
        ReadinessGateEvaluator.Evaluation ev = evaluator.evaluate("sc", System.currentTimeMillis());
        assertEquals(ReadinessGateEvaluator.GateResult.PASS, ev.result);
    }

    @Test
    void flagQueryReadyPasses() {
        when(gateDao.findEnabled("sc")).thenReturn(List.of(
                gate("bill_ready", "flag_query", "SELECT 1", null, 0, 120)));
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class))).thenReturn(1L);

        ReadinessGateEvaluator.Evaluation ev = evaluator.evaluate("sc", System.currentTimeMillis());

        assertEquals(ReadinessGateEvaluator.GateResult.PASS, ev.result);
    }

    @Test
    void flagQueryNotReady() {
        when(gateDao.findEnabled("sc")).thenReturn(List.of(
                gate("bill_ready", "flag_query", "SELECT 0", null, 0, 120)));
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class))).thenReturn(0L);

        ReadinessGateEvaluator.Evaluation ev = evaluator.evaluate("sc", System.currentTimeMillis());

        assertEquals(ReadinessGateEvaluator.GateResult.NOT_READY, ev.result);
    }

    @Test
    void rowCountDeltaWithinTolerancePasses() {
        when(gateDao.findEnabled("sc")).thenReturn(List.of(
                gate("row_ok", "row_count_delta", "SELECT 95",
                        "{\"expected\":100,\"max_delta\":10}", 0, 120)));
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class))).thenReturn(95L);

        ReadinessGateEvaluator.Evaluation ev = evaluator.evaluate("sc", System.currentTimeMillis());

        assertEquals(ReadinessGateEvaluator.GateResult.PASS, ev.result);
    }

    @Test
    void rowCountDeltaOutOfToleranceNotReady() {
        when(gateDao.findEnabled("sc")).thenReturn(List.of(
                gate("row_ok", "row_count_delta", "SELECT 50",
                        "{\"expected\":100,\"max_delta\":10}", 0, 120)));
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class))).thenReturn(50L);

        ReadinessGateEvaluator.Evaluation ev = evaluator.evaluate("sc", System.currentTimeMillis());

        assertEquals(ReadinessGateEvaluator.GateResult.NOT_READY, ev.result);
    }

    @Test
    void stabilityWindowRequiresTwoEqualChecks() {
        when(gateDao.findEnabled("sc")).thenReturn(List.of(
                gate("stable", "stability_window", "SELECT 42",
                        "{\"stability_window_min\":1}", 0, 120)));
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class))).thenReturn(42L);
        long t0 = System.currentTimeMillis();

        // 第一次：窗口未到 → NOT_READY（记录本次值）
        ReadinessGateEvaluator.Evaluation first = evaluator.evaluate("sc", t0);
        assertEquals(ReadinessGateEvaluator.GateResult.NOT_READY, first.result);

        // 第二次：间隔 >= 1min 且值相同 → PASS
        ReadinessGateEvaluator.Evaluation second = evaluator.evaluate("sc", t0 + 61_000L);
        assertEquals(ReadinessGateEvaluator.GateResult.PASS, second.result);
    }

    @Test
    void stabilityWindowUnstableStaysNotReady() {
        when(gateDao.findEnabled("sc")).thenReturn(List.of(
                gate("stable", "stability_window", "SELECT 42",
                        "{\"stability_window_min\":1}", 0, 120)));
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class)))
                .thenReturn(42L, 43L);   // 两次值不同
        long t0 = System.currentTimeMillis();

        evaluator.evaluate("sc", t0);
        ReadinessGateEvaluator.Evaluation second = evaluator.evaluate("sc", t0 + 61_000L);

        assertEquals(ReadinessGateEvaluator.GateResult.NOT_READY, second.result);
    }

    @Test
    void appCallbackDegrades() {
        when(gateDao.findEnabled("sc")).thenReturn(List.of(
                gate("callback", "app_callback", null, null, 0, 120)));

        ReadinessGateEvaluator.Evaluation ev = evaluator.evaluate("sc", System.currentTimeMillis());

        // app_callback 未实现 → DEGRADED（超时降级语义）
        assertEquals(ReadinessGateEvaluator.GateResult.DEGRADED, ev.result);
    }

    @Test
    void evaluateForDsOnlyChecksReferencingScenarios() {
        ReconScenario s1 = new ReconScenario();
        s1.setScenarioCode("sc_a");
        s1.setEnabled(1);
        ReconScenario s2 = new ReconScenario();
        s2.setScenarioCode("sc_b");
        s2.setEnabled(1);
        when(scenarioRepository.findByEnabled(1)).thenReturn(List.of(s1, s2));

        // sc_a 的 check 引用 ds=left；sc_b 不引用
        ReconCheck ckA = new ReconCheck();
        ckA.setConsumeJson("[{\"ds_code\":\"left\"}]");
        when(checkRepository.findByScenarioCodeOrderBySeqNo("sc_a")).thenReturn(List.of(ckA));
        when(checkRepository.findByScenarioCodeOrderBySeqNo("sc_b")).thenReturn(List.of());

        // sc_a gate flag=1 通过 → ds left PASS
        when(gateDao.findEnabled("sc_a")).thenReturn(List.of(
                gate("g1", "flag_query", "SELECT 1", null, 0, 120)));
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class))).thenReturn(1L);

        ReadinessGateEvaluator.Evaluation ev = evaluator.evaluateForDs("left", System.currentTimeMillis());

        assertEquals(ReadinessGateEvaluator.GateResult.PASS, ev.result);
        Mockito.verify(gateDao, Mockito.never()).findEnabled("sc_b");
    }

    @Test
    void evaluateForDsNotReadyBlocks() {
        ReconScenario s1 = new ReconScenario();
        s1.setScenarioCode("sc_a");
        s1.setEnabled(1);
        when(scenarioRepository.findByEnabled(1)).thenReturn(List.of(s1));

        ReconCheck ckA = new ReconCheck();
        ckA.setConsumeJson("[{\"ds_code\":\"left\"}]");
        when(checkRepository.findByScenarioCodeOrderBySeqNo("sc_a")).thenReturn(List.of(ckA));

        when(gateDao.findEnabled("sc_a")).thenReturn(List.of(
                gate("g1", "flag_query", "SELECT 0", null, 0, 120)));
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class))).thenReturn(0L);

        ReadinessGateEvaluator.Evaluation ev = evaluator.evaluateForDs("left", System.currentTimeMillis());

        assertEquals(ReadinessGateEvaluator.GateResult.NOT_READY, ev.result);
    }
}
