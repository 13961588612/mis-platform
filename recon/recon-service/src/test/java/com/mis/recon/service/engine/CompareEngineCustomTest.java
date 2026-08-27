package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.custom.CustomComparator;
import com.mis.recon.domain.runtime.CompareResult;
import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchPair;
import com.mis.recon.domain.runtime.Mismatch;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * CompareEngine compare_mode=custom 单测（第三批 C4，P 组）：规则行比较交给 CustomComparator，
 * 与内置 equal 行混用；比较器未配置类名 → 降级为差异（运行时可见）。
 */
class CompareEngineCustomTest {

    private static final ObjectMapper OM = new ObjectMapper();
    private static final String TIERED = "com.mis.recon.custom.example.TieredPricingComparator";

    private CustomLoader customLoader;
    private CompareEngine engine;

    @BeforeEach
    void setUp() {
        customLoader = mock(CustomLoader.class);
        engine = new CompareEngine(customLoader);
    }

    private MatchPair pair(String leftJson, String rightJson) throws Exception {
        LedgerRow l = LedgerRow.builder().dsCode("d1").recordKey("K1")
                .recordData(OM.readTree(leftJson)).source("incr").build();
        LedgerRow r = LedgerRow.builder().dsCode("d2").recordKey("K1")
                .recordData(OM.readTree(rightJson)).source("incr").build();
        return MatchPair.builder().matchKeyHash("h").matchKeyDisplay("K1")
                .leftRows(List.of(l)).rightRows(List.of(r)).leftSingle(l).rightSingle(r).build();
    }

    private CompareEngine.RuleConfig customRule(String comparatorClass) {
        CompareEngine.RuleConfig rc = new CompareEngine.RuleConfig();
        rc.name = "阶梯定价";
        rc.compareMode = "custom";
        rc.comparatorClass = comparatorClass;
        return rc;
    }

    private CompareEngine.RuleConfig amountEqualRule() {
        CompareEngine.RuleConfig rc = new CompareEngine.RuleConfig();
        rc.name = "金额";
        rc.leftField = "d1.amount";
        rc.rightField = "d2.amount";
        rc.compareMode = "equal";
        rc.toleranceType = "null";   // 与解析默认一致（null 字符串 = 精确相等）
        rc.isAmount = true;
        return rc;
    }

    @Test
    void customRowConsistent() throws Exception {
        // P-1：compare_mode=custom 行一致 → 整体一致（CustomLoader 加载比较器 → compare(pair)）
        CustomComparator comparator = mock(CustomComparator.class);
        when(customLoader.load(TIERED, CustomComparator.class)).thenReturn(comparator);
        when(comparator.compare(any(MatchPair.class), any(Map.class))).thenReturn(CompareResult.ok(1));

        CompareResult cr = engine.compare(List.of(customRule(TIERED)),
                pair("{\"pay_amount\":\"99\"}", "{\"pay_amount\":\"98.5\"}"), Map.of());

        assertTrue(cr.isConsistent());
        assertEquals(0, cr.getMismatches().size());
    }

    @Test
    void customRowMismatch() throws Exception {
        // P-2：custom 行差异 → 整体差异，mismatches/diffAmountCent 合并进结果
        CustomComparator comparator = mock(CustomComparator.class);
        when(customLoader.load(TIERED, CustomComparator.class)).thenReturn(comparator);
        when(comparator.compare(any(MatchPair.class), any(Map.class))).thenReturn(
                CompareResult.fail(List.of(new Mismatch("阶梯定价", "99", "150", "null", "custom")), 5100L, 1));

        CompareResult cr = engine.compare(List.of(customRule(TIERED)),
                pair("{\"pay_amount\":\"99\"}", "{\"pay_amount\":\"150\"}"), Map.of());

        assertFalse(cr.isConsistent());
        assertEquals(1, cr.getMismatches().size());
        assertEquals(5100L, cr.getDiffAmountCent());
    }

    @Test
    void customRowMixedWithEqual() throws Exception {
        // P-3：custom 行与 equal 行混用（§3.5：一个 check 规则表可同时含 equal 与 custom 行）
        CustomComparator comparator = mock(CustomComparator.class);
        when(customLoader.load(TIERED, CustomComparator.class)).thenReturn(comparator);
        when(comparator.compare(any(MatchPair.class), any(Map.class))).thenReturn(CompareResult.ok(1));

        CompareResult cr = engine.compare(List.of(customRule(TIERED), amountEqualRule()),
                pair("{\"amount\":\"100\",\"pay_amount\":\"99\"}", "{\"amount\":\"200\",\"pay_amount\":\"98.5\"}"),
                Map.of());

        assertFalse(cr.isConsistent(), "equal 行差异 → 整体差异");
        assertEquals(1, cr.getMismatches().size(), "custom 行一致不计入，仅 equal 行差异");
        assertEquals("金额", cr.getMismatches().get(0).getField());
        assertEquals(10000L, cr.getDiffAmountCent(), "equal 行 is_amount 差值（100 元 = 10000 分）");
    }

    @Test
    void customRowWithoutComparatorDegrades() throws Exception {
        // P-4：compare_mode=custom 未配置比较器类名 → 差异（eqRule=custom，运行时降级可见）
        CompareResult cr = engine.compare(List.of(customRule(null)),
                pair("{\"pay_amount\":\"99\"}", "{\"pay_amount\":\"99\"}"), Map.of());

        assertFalse(cr.isConsistent());
        assertEquals(1, cr.getMismatches().size());
        assertEquals("custom", cr.getMismatches().get(0).getEqRule());
    }
}