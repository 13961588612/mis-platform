package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.domain.ledger.ReconSourceRecord;
import com.mis.recon.domain.runtime.CompareResult;
import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchPair;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 比较引擎单测（T05-spec §7，纯内存，不依赖 PG）。
 */
class CompareEngineTest {

    private CompareEngine engine;

    @BeforeEach
    void setUp() {
        engine = new CompareEngine(org.mockito.Mockito.mock(CustomLoader.class));
    }

    private MatchPair pair(String leftJson, String rightJson) {
        LedgerRow l = row("left", leftJson, leftJson);
        LedgerRow r = row("right", rightJson, rightJson);
        return MatchPair.builder()
                .leftRows(List.of(l))
                .rightRows(List.of(r))
                .leftSingle(l)
                .rightSingle(r)
                .build();
    }

    private LedgerRow row(String ds, String json, String dataJson) {
        ReconSourceRecord rec = ReconSourceRecord.builder().dsCode(ds).recordKey("k").updateSeq(1L).build();
        LedgerRow row = LedgerRow.of(rec, "incr");
        try {
            row.setRecordData(new ObjectMapper().readTree(dataJson));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return row;
    }

    private CompareEngine.RuleConfig rule(String name, String leftField, String rightField,
                                          String mode, String toleranceType, String amount, String transform) {
        CompareEngine.RuleConfig r = new CompareEngine.RuleConfig();
        r.name = name;
        r.leftField = leftField;
        r.rightField = rightField;
        r.compareMode = mode;
        r.toleranceType = toleranceType == null ? "null" : toleranceType;
        r.isAmount = "amount".equals(amount);
        r.valueTransform = transform == null ? "none" : transform;
        return r;
    }

    @Test
    void absTransformMatchesNegativeVsPositive() {
        // 回归（crm 扣减流水为负数 vs 订单正数）：value_transform=abs 两侧取绝对值后应判一致
        MatchPair p = pair("{\"int_num\":\"3000\"}", "{\"wcljfbd\":\"-3000\"}");
        CompareResult r = engine.compare(
                List.of(rule("积分值", "left.int_num", "right.wcljfbd", "equal", "null", null, "abs")), p, Map.of());
        assertTrue(r.isConsistent());
        assertEquals(1, r.getComparedFields());
        assertNull(r.getDiffAmountCent());
    }

    @Test
    void extractFieldNumberRespectsZeroUnmatchedSkipSide() {
        // 回归（zero_unmatched_skip）：本侧字段值=0 → 返回 0；对侧别取错
        CompareEngine.RuleConfig rc = new CompareEngine.RuleConfig();
        rc.leftField = "left.int_num";
        rc.rightField = "right.wcljfbd";
        rc.valueTransform = "none";
        com.fasterxml.jackson.databind.JsonNode data = null;
        try {
            data = new com.fasterxml.jackson.databind.ObjectMapper().readTree("{\"int_num\":\"0\"}");
        } catch (Exception e) {
            org.junit.jupiter.api.Assertions.fail(e);
        }
        assertEquals(0, engine.extractFieldNumber(rc, data, "left").intValue());
        assertNull(engine.extractFieldNumber(rc, data, "right"));
    }

    @Test
    void equalConsistent() {
        MatchPair p = pair("{\"amount\":\"10.00\"}", "{\"amount\":\"10.00\"}");
        CompareResult r = engine.compare(List.of(rule("amt", "left.amount", "right.amount", "equal", "null", null, null)), p, Map.of());
        assertTrue(r.isConsistent());
        assertEquals(1, r.getComparedFields());
        assertNull(r.getDiffAmountCent());
    }

    @Test
    void equalMismatchWithAmountDiff() {
        MatchPair p = pair("{\"amount\":\"10.00\"}", "{\"amount\":\"12.00\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "null", "amount", null);
        r.toleranceValue = BigDecimal.ZERO;
        CompareResult res = engine.compare(List.of(r), p, Map.of("left.amount", "yuan"));
        assertFalse(res.isConsistent());
        assertEquals(1, res.getMismatches().size());
        // 10.00 元 vs 12.00 元 → 200 分
        assertEquals(200L, res.getDiffAmountCent());
    }

    @Test
    void absoluteToleranceInCents() {
        MatchPair p = pair("{\"amount\":\"10.00\"}", "{\"amount\":\"10.50\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "absolute", "amount", null);
        r.toleranceValue = new BigDecimal("100");   // 100 分 = 1 元
        CompareResult res = engine.compare(List.of(r), p, Map.of("left.amount", "yuan", "right.amount", "yuan"));
        assertTrue(res.isConsistent(), "50 分 <= 100 分容差应一致");
    }

    @Test
    void absoluteToleranceExceeded() {
        MatchPair p = pair("{\"amount\":\"10.00\"}", "{\"amount\":\"12.00\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "absolute", "amount", null);
        r.toleranceValue = new BigDecimal("100");   // 1 元
        CompareResult res = engine.compare(List.of(r), p, Map.of("left.amount", "yuan", "right.amount", "yuan"));
        assertFalse(res.isConsistent());
        assertEquals(200L, res.getDiffAmountCent());
    }

    @Test
    void percentageToleranceLeftAsDenominator() {
        MatchPair p = pair("{\"amount\":\"100.00\"}", "{\"amount\":\"101.00\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "percentage", "amount", null);
        r.toleranceValue = new BigDecimal("0.02");  // 2%
        CompareResult res = engine.compare(List.of(r), p, Map.of("left.amount", "yuan", "right.amount", "yuan"));
        assertTrue(res.isConsistent(), "1 元 / 100 元 = 1% <= 2% 应一致");
    }

    @Test
    void percentageLeftZeroDegradesEqual() {
        MatchPair p = pair("{\"amount\":\"0.00\"}", "{\"amount\":\"0.50\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "percentage", "amount", null);
        r.toleranceValue = new BigDecimal("0.10");
        CompareResult res = engine.compare(List.of(r), p, Map.of("left.amount", "yuan", "right.amount", "yuan"));
        assertFalse(res.isConsistent(), "左侧 0 退化相等，0 与 50 分不等");
    }

    @Test
    void bothToleranceRequiresBoth() {
        // left=100.00 元 right=103.00 元，diff=300 分；tolerance=100（绝对 100 分=1 元）
        // 绝对 300 > 100 不过 → 整体不过（both 要求绝对与比例都过）
        MatchPair p = pair("{\"amount\":\"100.00\"}", "{\"amount\":\"103.00\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "both", "amount", null);
        r.toleranceValue = new BigDecimal("100");
        CompareResult res = engine.compare(List.of(r), p, Map.of("left.amount", "yuan", "right.amount", "yuan"));
        assertFalse(res.isConsistent());
    }

    @Test
    void valueTransformTrimComma() {
        MatchPair p = pair("{\"amount\":\"1,000.00\"}", "{\"amount\":\"1000.00\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "null", "amount", "trim_comma");
        r.toleranceValue = BigDecimal.ZERO;
        CompareResult res = engine.compare(List.of(r), p, Map.of("left.amount", "yuan", "right.amount", "yuan"));
        assertTrue(res.isConsistent(), "trim_comma 去掉千分位后应一致");
    }

    @Test
    void valueTransformUppercase() {
        MatchPair p = pair("{\"name\":\"abc\"}", "{\"name\":\"ABC\"}");
        CompareEngine.RuleConfig r = rule("nm", "left.name", "right.name", "equal", "null", null, "uppercase");
        CompareResult res = engine.compare(List.of(r), p, Map.of());
        assertTrue(res.isConsistent());
    }

    @Test
    void containsMode() {
        MatchPair p = pair("{\"memo\":\"退款-原路返回\"}", "{\"memo\":\"原路返回\"}");
        CompareEngine.RuleConfig r = rule("memo", "left.memo", "right.memo", "contains", "null", null, null);
        CompareResult res = engine.compare(List.of(r), p, Map.of());
        assertTrue(res.isConsistent());
    }

    @Test
    void regexMode() {
        MatchPair p = pair("{\"code\":\"AB-1001\"}", "{\"code\":\"AB-\\\\d{4}\"}");
        CompareEngine.RuleConfig r = rule("code", "left.code", "right.code", "regex", "null", null, null);
        CompareResult res = engine.compare(List.of(r), p, Map.of());
        assertTrue(res.isConsistent());
    }

    @Test
    void lteGteLtGt() {
        MatchPair p = pair("{\"cnt\":\"5\"}", "{\"cnt\":\"6\"}");
        CompareEngine.RuleConfig lte = rule("c", "left.cnt", "right.cnt", "lte", "null", null, null);
        assertTrue(engine.compare(List.of(lte), p, Map.of()).isConsistent());
        CompareEngine.RuleConfig gte = rule("c", "left.cnt", "right.cnt", "gte", "null", null, null);
        assertFalse(engine.compare(List.of(gte), p, Map.of()).isConsistent());
        CompareEngine.RuleConfig lt = rule("c", "left.cnt", "right.cnt", "lt", "null", null, null);
        assertTrue(engine.compare(List.of(lt), p, Map.of()).isConsistent());
        CompareEngine.RuleConfig gt = rule("c", "left.cnt", "right.cnt", "gt", "null", null, null);
        assertFalse(engine.compare(List.of(gt), p, Map.of()).isConsistent());
    }

    @Test
    void missingFieldIsMismatch() {
        MatchPair p = pair("{\"amount\":\"10.00\"}", "{\"other\":\"x\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "null", "amount", null);
        r.toleranceValue = BigDecimal.ZERO;
        CompareResult res = engine.compare(List.of(r), p, Map.of("left.amount", "yuan"));
        assertFalse(res.isConsistent());
        assertEquals("missing", res.getMismatches().get(0).getEqRule());
    }

    @Test
    void emptyRulesAlwaysConsistent() {
        MatchPair p = pair("{\"amount\":\"10.00\"}", "{\"amount\":\"99.00\"}");
        CompareResult res = engine.compare(List.of(), p, Map.of());
        assertTrue(res.isConsistent());
        assertEquals(0, res.getComparedFields());
    }

    @Test
    void firstAmountMismatchWinsDiffAmount() {
        // 两条 is_amount 规则，第一条不一致 → 差值取第一条
        MatchPair p = pair("{\"a\":\"10.00\",\"b\":\"10.00\"}", "{\"a\":\"11.00\",\"b\":\"9.00\"}");
        CompareEngine.RuleConfig r1 = rule("a", "left.a", "right.a", "equal", "null", "amount", null);
        r1.toleranceValue = BigDecimal.ZERO;
        CompareEngine.RuleConfig r2 = rule("b", "left.b", "right.b", "equal", "null", "amount", null);
        r2.toleranceValue = BigDecimal.ZERO;
        CompareResult res = engine.compare(List.of(r1, r2), p, Map.of("left.a", "yuan", "left.b", "yuan"));
        assertFalse(res.isConsistent());
        assertEquals(2, res.getMismatches().size());
        assertEquals(100L, res.getDiffAmountCent());
    }

    @Test
    void nonAmountEqualString() {
        MatchPair p = pair("{\"status\":\"paid\"}", "{\"status\":\"paid\"}");
        CompareEngine.RuleConfig r = rule("st", "left.status", "right.status", "equal", "null", null, null);
        assertTrue(engine.compare(List.of(r), p, Map.of()).isConsistent());
    }

    @Test
    void equalNumericDefaultMatchesFormatDifference() {
        // 回归（华粉券金额核对）：无容差配置时金额字符串 458.00 vs 458 应按数值判等，不再误报
        MatchPair p = pair("{\"welfare_amount\":\"458.00\"}", "{\"amount\":\"458\"}");
        CompareEngine.RuleConfig r = rule("华粉券", "left.welfare_amount", "right.amount", "equal", "null", null, null);
        assertTrue(engine.compare(List.of(r), p, Map.of()).isConsistent());
    }

    @Test
    void equalNumericDefaultTrailingZero() {
        MatchPair p = pair("{\"amount\":\"76.20\"}", "{\"amount\":\"76.2\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "null", null, null);
        assertTrue(engine.compare(List.of(r), p, Map.of()).isConsistent());
    }

    @Test
    void equalNumericDefaultStillMismatchesDifferentValue() {
        // 数值相等才通过；数值不等仍报差异
        MatchPair p = pair("{\"amount\":\"0123\"}", "{\"amount\":\"1234\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "null", null, null);
        assertFalse(engine.compare(List.of(r), p, Map.of()).isConsistent());
    }

    @Test
    void equalNonNumericStillStringMismatch() {
        // 非数值字符串不受数值兜底影响，仍按字符串比较
        MatchPair p = pair("{\"status\":\"abc\"}", "{\"status\":\"abd\"}");
        CompareEngine.RuleConfig r = rule("st", "left.status", "right.status", "equal", "null", null, null);
        assertFalse(engine.compare(List.of(r), p, Map.of()).isConsistent());
    }

    @Test
    void stringModeIsStrictExactMatch() {
        // string 模式：严格字符串相等，不做数值判等（编码类 0123 != 123）
        MatchPair p = pair("{\"code\":\"0123\"}", "{\"code\":\"123\"}");
        CompareEngine.RuleConfig r = rule("code", "left.code", "right.code", "string", "null", null, null);
        assertFalse(engine.compare(List.of(r), p, Map.of()).isConsistent());
    }

    @Test
    void stringModeExactEqualPasses() {
        MatchPair p = pair("{\"code\":\"0123\"}", "{\"code\":\"0123\"}");
        CompareEngine.RuleConfig r = rule("code", "left.code", "right.code", "string", "null", null, null);
        assertTrue(engine.compare(List.of(r), p, Map.of()).isConsistent());
    }

    @Test
    void equalExplicitToleranceStillRespected() {
        // 显式容差优先于数值判等兜底：差 0.5 元 <= 1 元容差通过
        MatchPair p = pair("{\"amount\":\"458.00\"}", "{\"amount\":\"458.50\"}");
        CompareEngine.RuleConfig r = rule("amt", "left.amount", "right.amount", "equal", "absolute", null, null);
        r.toleranceValue = new BigDecimal("1");   // 1 元
        assertTrue(engine.compare(List.of(r), p, Map.of()).isConsistent());
    }
}
