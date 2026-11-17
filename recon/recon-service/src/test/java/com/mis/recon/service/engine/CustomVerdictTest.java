package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.custom.CustomDiff;
import com.mis.recon.dao.DetailDao;
import com.mis.recon.dao.MatchedIndexDao;
import com.mis.recon.dao.PullRunDao;
import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchPair;
import com.mis.recon.domain.runtime.MatchResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * VerdictService custom 诊断上下文合并单测（第三批 C2，M 组）。
 * <p>自定义匹配结果附带 diagnosisContext → 差异 diff_diagnosis_json 根级 custom_context 合并（§13.2）；
 * 不附带则无该节点（默认空诊断降级可用）。</p>
 */
class CustomVerdictTest {

    private static final ObjectMapper OM = new ObjectMapper();

    private DetailDao detailDao;
    private VerdictService verdictService;

    @BeforeEach
    void setUp() throws Exception {
        detailDao = mock(DetailDao.class);
        MatchedIndexDao matchedIndexDao = mock(MatchedIndexDao.class);
        PullRunDao pullRunDao = mock(PullRunDao.class);
        when(detailDao.findIdentity(anyString(), anyString(), anyString(), anyString())).thenReturn(null);
        verdictService = new VerdictService(detailDao, matchedIndexDao, pullRunDao,
                new CompareEngine(mock(CustomLoader.class)), new DiffDescBuilder(), new DiagnosisBuilder(OM));
    }

    private ConfigSnapshot.CheckSpec checkSpec() {
        ConfigSnapshot.CheckSpec check = new ConfigSnapshot.CheckSpec();
        check.checkName = "c1";
        check.strategy = "custom";
        check.match = new MatchEngine.MatchRuleConfig();
        check.match.datasets = List.of("d1", "d2");
        CompareEngine.RuleConfig rule = new CompareEngine.RuleConfig();
        rule.name = "金额";
        rule.leftField = "d1.amount";
        rule.rightField = "d2.amount";
        rule.compareMode = "equal";
        check.compareRules.add(rule);
        check.unitByField = new HashMap<>();
        return check;
    }

    private MatchPair mismatchedPair() throws Exception {
        LedgerRow left = LedgerRow.builder().dsCode("d1").recordKey("K1")
                .recordData(OM.readTree("{\"amount\":\"100\"}")).source("incr").build();
        LedgerRow right = LedgerRow.builder().dsCode("d2").recordKey("K1")
                .recordData(OM.readTree("{\"amount\":\"200\"}")).source("incr").build();
        return MatchPair.builder().matchKeyHash("hash-1").matchKeyDisplay("K1")
                .leftRows(List.of(left)).rightRows(List.of(right))
                .leftSingle(left).rightSingle(right).build();
    }

    @Test
    void diagnosisContextMergedIntoCustomContext() throws Exception {
        // M-4：自定义实现附带诊断上下文 → field_mismatch 差异的 diff_diagnosis_json 根级 custom_context 合并
        MatchResult result = MatchResult.builder()
                .pairs(List.of(mismatchedPair()))
                .unmatchedLeft(List.of()).unmatchedRight(List.of()).anomalies(List.of())
                .diagnosisContext(Map.of("mapped", true, "mapping_key", "EXT-123"))
                .build();

        ConfigSnapshot.LoadedScenario scenario = new ConfigSnapshot.LoadedScenario();
        scenario.scenarioCode = "s1";
        VerdictService.Stats stats = verdictService.apply(scenario, checkSpec(), result,
                Map.of("d1", "orders", "d2", "ext"));

        assertEquals(1, stats.diff, "不一致 pair → diff 计数 1");
        ArgumentCaptor<DetailDao.DetailUpsert> captor = ArgumentCaptor.forClass(DetailDao.DetailUpsert.class);
        verify(detailDao).upsertDetail(captor.capture());
        DetailDao.DetailUpsert up = captor.getValue();
        assertNotNull(up.diagnosisJson);
        JsonNode diag = OM.readTree(up.diagnosisJson);
        assertTrue(diag.has("custom_context"), "诊断 JSON 应含 custom_context 节点");
        assertEquals(true, diag.get("custom_context").get("mapped").asBoolean());
        assertEquals("EXT-123", diag.get("custom_context").get("mapping_key").asText());
        assertEquals("field_mismatch", up.diffType);
        assertEquals("confirmed", up.status);
    }

    @Test
    void noDiagnosisContextDegradesToEmpty() throws Exception {
        // M-5：不附带诊断上下文 → 无 custom_context 节点（默认空诊断，功能降级可用，§13.2）
        MatchResult result = MatchResult.builder()
                .pairs(List.of(mismatchedPair()))
                .unmatchedLeft(List.of()).unmatchedRight(List.of()).anomalies(List.of())
                .build();

        ConfigSnapshot.LoadedScenario scenario = new ConfigSnapshot.LoadedScenario();
        scenario.scenarioCode = "s1";
        verdictService.apply(scenario, checkSpec(), result, Map.of("d1", "orders", "d2", "ext"));

        ArgumentCaptor<DetailDao.DetailUpsert> captor = ArgumentCaptor.forClass(DetailDao.DetailUpsert.class);
        verify(detailDao).upsertDetail(captor.capture());
        JsonNode diag = OM.readTree(captor.getValue().diagnosisJson);
        assertTrue(!diag.has("custom_context"), "无诊断上下文时不应生成 custom_context 节点");
    }

    @Test
    void customCheckDiffDirectConfirmed() throws Exception {
        // X-2：custom_check 差异直接 confirmed 落池（diff_type=custom_check、pairSegment="-"、
        // 身份=实现类 hash、金额/积分差额与现场数据透传、诊断 reason=custom_check）
        ConfigSnapshot.CheckSpec check = new ConfigSnapshot.CheckSpec();
        check.checkName = "c1";
        check.strategy = "custom_check";
        check.match = null;
        check.unitByField = new HashMap<>();
        ConfigSnapshot.LoadedScenario scenario = new ConfigSnapshot.LoadedScenario();
        scenario.scenarioCode = "s1";

        List<CustomDiff> diffs = List.of(CustomDiff.builder()
                .matchKeyHash("hash-lifecycle").matchKeyDisplay("ORDER-1")
                .diffDesc("订单生命周期异常：已退款未完成生命周期").diffAmountCent(-1000L).diffPoint(5L)
                .leftDataJson("{\"order\":\"O1\",\"status\":\"REFUNDED\"}")
                .rightDataJson("{\"order\":\"O1\",\"status\":\"COMPLETED\"}")
                .build());

        VerdictService.Stats stats = new VerdictService.Stats();
        verdictService.applyCustomCheck(scenario, check, diffs, stats);

        assertEquals(1, stats.diff, "custom_check 差异 → diff 计数 1");
        ArgumentCaptor<DetailDao.DetailUpsert> captor = ArgumentCaptor.forClass(DetailDao.DetailUpsert.class);
        verify(detailDao).upsertDetail(captor.capture());
        DetailDao.DetailUpsert up = captor.getValue();
        assertEquals("custom_check", up.diffType);
        assertEquals("confirmed", up.status);
        assertEquals("-", up.identity.pairSegment);
        assertEquals("hash-lifecycle", up.identity.matchKeyHash);
        assertEquals("ORDER-1", up.matchKeyDisplay);
        assertEquals(-1000L, up.diffAmountCent);
        assertEquals(5L, up.diffPoint);
        assertEquals("{\"order\":\"O1\",\"status\":\"REFUNDED\"}", up.leftDataJson);
        assertEquals("{\"order\":\"O1\",\"status\":\"COMPLETED\"}", up.rightDataJson);
        // 诊断：reason=custom_check，无 custom_context 节点（整检查差异不附带自定义诊断）
        JsonNode diag = OM.readTree(up.diagnosisJson);
        assertEquals("custom_check", diag.get("verdict_phase").get("reason").asText());
        assertTrue(!diag.has("custom_context"));
    }

    @Test
    void customCheckBlankHashSkipped() {
        // X-3：实现类未给身份（hash 为空）→ 无法确定唯一差异，运行时跳过（降级可用）
        ConfigSnapshot.CheckSpec check = new ConfigSnapshot.CheckSpec();
        check.checkName = "c1";
        check.strategy = "custom_check";
        check.match = null;
        ConfigSnapshot.LoadedScenario scenario = new ConfigSnapshot.LoadedScenario();
        scenario.scenarioCode = "s1";

        VerdictService.Stats stats = new VerdictService.Stats();
        verdictService.applyCustomCheck(scenario, check,
                List.of(CustomDiff.builder().matchKeyHash("  ").diffDesc("缺身份").build()), stats);

        assertEquals(0, stats.diff);
        verify(detailDao, never()).upsertDetail(any());
    }
}
