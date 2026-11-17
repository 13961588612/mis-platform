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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * SnapshotParser custom 分支解析单测（第三批 C2，M 组）：class 透传 / params 除 class 原样 / 恰好 2 个。
 */
class SnapshotParserCustomTest {

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
        when(compareRuleRepo.findByScenarioCodeAndCheckName("s1", "c1"))
                .thenReturn(Optional.of(compareRule()));
    }

    private ReconCompareRule compareRule() {
        ReconCompareRule cr = new ReconCompareRule();
        cr.setScenarioCode("s1");
        cr.setCheckName("c1");
        cr.setRulesJson("[{\"name\":\"金额\",\"left_field\":\"orders.amount\",\"right_field\":\"ext.amount\"}]");
        return cr;
    }

    private ReconMatchRule matchRule(String datasets, String customClass, String configJson) {
        ReconMatchRule m = new ReconMatchRule();
        m.setScenarioCode("s1");
        m.setCheckName("c1");
        m.setStrategy("custom");
        m.setDatasetsJson(datasets);
        m.setCustomClass(customClass);
        m.setConfigJson(configJson);
        return m;
    }

    private ReconCheck check() {
        ReconCheck c = new ReconCheck();
        c.setScenarioCode("s1");
        c.setCheckName("c1");
        c.setConsumeJson("{\"orders\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"},"
                + "\"ext\":{\"ds_code\":\"d2\",\"mode\":\"incremental\"}}");
        return c;
    }

    @Test
    void customParsedWithClassAndParams() {
        // M-1：custom 解析 —— class 透传、params 除 class 外键值原样、match 仅数据集、compareRules 保留
        ReconMatchRule m = matchRule("[\"orders\",\"ext\"]",
                "com.mis.recon.custom.example.CrossSystemIdMatcher",
                "{\"class\":\"com.mis.recon.custom.example.CrossSystemIdMatcher\","
                        + "\"id_mapping_table\":\"sys_order_id_map\",\"fallback\":\"fuzzy\"}");
        when(matchRuleRepo.findByScenarioCodeAndCheckName("s1", "c1")).thenReturn(Optional.of(m));

        ConfigSnapshot.CheckSpec spec = parser.buildCheck(check());

        assertNotNull(spec);
        assertEquals("custom", spec.strategy);
        assertEquals("com.mis.recon.custom.example.CrossSystemIdMatcher", spec.customClass);
        assertEquals(2, spec.match.datasets.size());
        assertEquals("d1", spec.match.datasets.get(0));
        assertEquals("d2", spec.match.datasets.get(1));
        // 参数透传（§3.7 / C5）：除 class 外键值原样
        assertEquals("sys_order_id_map", spec.customParams.get("id_mapping_table"));
        assertEquals("fuzzy", spec.customParams.get("fallback"));
        assertFalse(spec.customParams.containsKey("class"));
        assertEquals(1, spec.compareRules.size());
    }

    @Test
    void customWrongDatasetCountSkipped() {
        // M-2：custom datasets != 2 → 运行时跳过（保存期由 V-C4 前置拦截）
        ReconMatchRule m = matchRule("[\"orders\"]", "com.mis.recon.custom.example.CrossSystemIdMatcher", null);
        when(matchRuleRepo.findByScenarioCodeAndCheckName("s1", "c1")).thenReturn(Optional.of(m));
        assertNull(parser.buildCheck(check()));
    }

    @Test
    void customClassFallsBackToConfigJsonClass() {
        // M-3：custom_class 为空 → config_json.class 兜底（§3.7 落库双写）
        ReconMatchRule m = matchRule("[\"orders\",\"ext\"]", null,
                "{\"class\":\"com.mis.recon.custom.example.CrossSystemIdMatcher\",\"id_mapping_table\":\"t\"}");
        when(matchRuleRepo.findByScenarioCodeAndCheckName("s1", "c1")).thenReturn(Optional.of(m));
        ConfigSnapshot.CheckSpec spec = parser.buildCheck(check());
        assertNotNull(spec);
        assertEquals("com.mis.recon.custom.example.CrossSystemIdMatcher", spec.customClass);
        assertEquals("t", spec.customParams.get("id_mapping_table"));
    }

    @Test
    void customCheckParsedWithMultipleDatasets() {
        // X-1：custom_check 解析 —— 1~N 个数据源（3 个）、match=null（无匹配键）、class/params 透传、
        // Tab C 隐藏 → sumRules 不解析（rules_json 空数组）
        ReconMatchRule m = new ReconMatchRule();
        m.setScenarioCode("s1");
        m.setCheckName("c1");
        m.setStrategy("custom_check");
        m.setDatasetsJson("[\"orders\",\"ext\",\"coupons\"]");
        m.setCustomClass("com.mis.recon.custom.example.OrderLifecycleCheck");
        m.setConfigJson("{\"class\":\"com.mis.recon.custom.example.OrderLifecycleCheck\",\"window_days\":7}");
        when(matchRuleRepo.findByScenarioCodeAndCheckName("s1", "c1")).thenReturn(Optional.of(m));

        ReconCheck c = check();
        c.setConsumeJson("{\"orders\":{\"ds_code\":\"d1\",\"mode\":\"incremental\"},"
                + "\"ext\":{\"ds_code\":\"d2\",\"mode\":\"incremental\"},"
                + "\"coupons\":{\"ds_code\":\"d3\",\"mode\":\"incremental\"}}");
        ConfigSnapshot.CheckSpec spec = parser.buildCheck(c);

        assertNotNull(spec);
        assertEquals("custom_check", spec.strategy);
        assertNull(spec.match, "custom_check 无匹配键（跳过索引回查与预收集）");
        assertEquals("com.mis.recon.custom.example.OrderLifecycleCheck", spec.customClass);
        // 参数透传：除 class 外键值原样
        assertEquals(7, spec.customParams.get("window_days"));
        assertFalse(spec.customParams.containsKey("class"));
        assertTrue(spec.sumRules.isEmpty(), "Tab C 隐藏：不解析 sumRules");
        assertTrue(spec.compareRules.isEmpty(), "Tab C 隐藏：不解析 compareRules");
    }

    @Test
    void customCheckEmptyDatasetsSkipped() {
        // X-2：custom_check datasets 为空 → 运行时跳过（保存期由 V 组前置拦截）
        ReconMatchRule m = new ReconMatchRule();
        m.setScenarioCode("s1");
        m.setCheckName("c1");
        m.setStrategy("custom_check");
        m.setDatasetsJson("[]");
        m.setCustomClass("com.mis.recon.custom.example.OrderLifecycleCheck");
        m.setConfigJson("{}");
        when(matchRuleRepo.findByScenarioCodeAndCheckName("s1", "c1")).thenReturn(Optional.of(m));
        assertNull(parser.buildCheck(check()));
    }

    @Test
    void customComparatorRowParsed() {
        // P-5：compare_mode=custom 行解析 —— comparator_class 透传、comparator_params 原样（custom-需求规格 §3.5/§3.7）
        ReconMatchRule m = matchRule("[\"orders\",\"ext\"]",
                "com.mis.recon.custom.example.CrossSystemIdMatcher",
                "{\"class\":\"com.mis.recon.custom.example.CrossSystemIdMatcher\"}");
        when(matchRuleRepo.findByScenarioCodeAndCheckName("s1", "c1")).thenReturn(Optional.of(m));

        ReconCompareRule cr = new ReconCompareRule();
        cr.setScenarioCode("s1");
        cr.setCheckName("c1");
        cr.setRulesJson("[{\"name\":\"阶梯定价\",\"compare_mode\":\"custom\","
                + "\"comparator_class\":\"com.mis.recon.custom.example.TieredPricingComparator\","
                + "\"comparator_params\":{\"tiers\":[{\"min\":0,\"max\":100,\"tolerance\":0.5}],\"amount_field\":\"pay_amount\"}},"
                + "{\"name\":\"金额\",\"left_field\":\"orders.amount\",\"right_field\":\"ext.amount\"}]");
        when(compareRuleRepo.findByScenarioCodeAndCheckName("s1", "c1")).thenReturn(Optional.of(cr));

        ConfigSnapshot.CheckSpec spec = parser.buildCheck(check());

        assertNotNull(spec);
        assertEquals(2, spec.compareRules.size());
        CompareEngine.RuleConfig custom = spec.compareRules.get(0);
        assertEquals("custom", custom.compareMode);
        assertEquals("com.mis.recon.custom.example.TieredPricingComparator", custom.comparatorClass);
        // 行级参数原样解析（嵌套数组按对象解析）
        assertEquals("pay_amount", custom.comparatorParams.get("amount_field"));
        Object tiers = custom.comparatorParams.get("tiers");
        assertNotNull(tiers, "comparator_params 嵌套数组按对象解析");
        // 内置 equal 行零变化（无 comparatorClass）
        CompareEngine.RuleConfig equal = spec.compareRules.get(1);
        assertEquals("equal", equal.compareMode);
        assertNull(equal.comparatorClass);
    }
}