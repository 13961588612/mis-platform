package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconCompareRule;
import com.mis.recon.domain.config.ReconMatchRule;
import com.mis.recon.repository.CompareRuleRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.repository.MatchRuleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * SnapshotParser sum_check 解析单测（T05-spec-sum-check §13.3 S-1/S-2/S-6 部分）。
 */
class SumCheckSnapshotTest {

    private SnapshotParser parser;
    private MatchRuleRepository matchRuleRepo;
    private CompareRuleRepository compareRuleRepo;

    @BeforeEach
    void setUp() {
        matchRuleRepo = Mockito.mock(MatchRuleRepository.class);
        compareRuleRepo = Mockito.mock(CompareRuleRepository.class);
        DatasourceRepository dsRepo = Mockito.mock(DatasourceRepository.class);
        parser = new SnapshotParser(matchRuleRepo, compareRuleRepo, dsRepo, new ObjectMapper());
        when(dsRepo.findByDsCode(anyString())).thenReturn(Optional.empty());

        ReconCompareRule compare = new ReconCompareRule();
        compare.setScenarioCode("online_order");
        compare.setCheckName("c1");
        compare.setRulesJson("""
                [{"name":"总额勾稽","left_expr":"orders.total_amount",
                  "right_expr":"orders.integral_amount + orders.cash_card_amount + orders.coupon_amount",
                  "tolerance":{"type":"absolute","value":100},"is_amount":true}]
                """);
        when(compareRuleRepo.findByScenarioCodeAndCheckName("online_order", "c1"))
                .thenReturn(Optional.of(compare));
    }

    private ReconMatchRule matchRule(String strategy, String datasetsJson) {
        ReconMatchRule m = new ReconMatchRule();
        m.setScenarioCode("online_order");
        m.setCheckName("c1");
        m.setStrategy(strategy);
        m.setDatasetsJson(datasetsJson);
        return m;
    }

    private ReconCheck check(String consumeJson) {
        ReconCheck c = new ReconCheck();
        c.setScenarioCode("online_order");
        c.setCheckName("c1");
        c.setConsumeJson(consumeJson);
        return c;
    }

    @Test
    void sumCheckParsedAndNotSkipped() {
        // S-1 + S-2：单数据源 sum_check 解析（datasets=1、match=null、sumRules）且不再被静默跳过
        when(matchRuleRepo.findByScenarioCodeAndCheckName("online_order", "c1"))
                .thenReturn(Optional.of(matchRule("sum_check", "[\"orders\"]")));

        ConfigSnapshot.CheckSpec spec = parser.buildCheck(
                check("{\"orders\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"}}"));

        assertNotNull(spec, "sum_check 单源 check 不应被静默跳过");
        assertEquals("sum_check", spec.strategy);
        assertNull(spec.match, "sum_check 无两两匹配键");
        assertEquals(1, spec.sumRules.size());
        CompareEngine.SumRuleConfig rule = spec.sumRules.get(0);
        assertEquals("总额勾稽", rule.name);
        assertEquals("orders.total_amount", rule.leftExpr);
        assertEquals("orders.integral_amount + orders.cash_card_amount + orders.coupon_amount", rule.rightExpr);
        assertEquals("absolute", rule.toleranceType);
        assertEquals(100, rule.toleranceValue.intValue());
        assertTrue(rule.isAmount);
        assertEquals(1, spec.consumes.size());
    }

    @Test
    void sumCheckWrongDatasetCountSkipped() {
        // 运行时：sum_check datasets != 1 → 记配置错误跳过（保存期由 V-SC1 前置拦截）
        when(matchRuleRepo.findByScenarioCodeAndCheckName("online_order", "c1"))
                .thenReturn(Optional.of(matchRule("sum_check", "[\"orders\",\"pay\"]")));

        ConfigSnapshot.CheckSpec spec = parser.buildCheck(
                check("{\"orders\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"},"
                        + "\"pay\":{\"ds_code\":\"d2\",\"mode\":\"incremental\"}}"));
        assertNull(spec);
    }

    @Test
    void exactKeyStillParsedWithMatch() {
        // S-6 回归：exact_key 仍走 match 分支（恰好 2 个、match 必填）
        ReconMatchRule m = matchRule("exact_key", "[\"orders\",\"pay\"]");
        m.setKeyFieldsJson("{\"orders\":\"{order_no}\",\"pay\":\"{order_no}\"}");
        when(matchRuleRepo.findByScenarioCodeAndCheckName("online_order", "c1")).thenReturn(Optional.of(m));

        // exact_key 形态的字段比较规则（left_field/right_field）
        ReconCompareRule cr = new ReconCompareRule();
        cr.setScenarioCode("online_order");
        cr.setCheckName("c1");
        cr.setRulesJson("[{\"name\":\"金额\",\"left_field\":\"orders.amount\",\"right_field\":\"pay.amount\"}]");
        when(compareRuleRepo.findByScenarioCodeAndCheckName("online_order", "c1")).thenReturn(Optional.of(cr));

        ConfigSnapshot.CheckSpec spec = parser.buildCheck(
                check("{\"orders\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"},"
                        + "\"pay\":{\"ds_code\":\"d2\",\"mode\":\"incremental\"}}"));

        assertNotNull(spec);
        assertEquals("exact_key", spec.strategy);
        assertNotNull(spec.match);
        assertEquals(2, spec.match.datasets.size());
        assertEquals("d1", spec.match.datasets.get(0));
        assertEquals(1, spec.compareRules.size());
        assertEquals(0, spec.sumRules.size());
    }
}
