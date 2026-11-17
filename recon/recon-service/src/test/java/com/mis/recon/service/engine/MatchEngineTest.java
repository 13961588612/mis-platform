package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.domain.ledger.ReconSourceRecord;
import com.mis.recon.domain.runtime.AnomalyRow;
import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchPair;
import com.mis.recon.domain.runtime.MatchResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 匹配引擎单测（T05-spec §6，纯内存构造 LedgerRow，不依赖 PG）。
 */
class MatchEngineTest {

    private MatchEngine engine;

    @BeforeEach
    void setUp() {
        engine = new MatchEngine(new ObjectMapper());
    }

    private MatchEngine.MatchRuleConfig cfg(String leftDs, String rightDs, String leftExpr, String rightExpr) {
        MatchEngine.MatchRuleConfig cfg = new MatchEngine.MatchRuleConfig();
        cfg.strategy = "exact_key";
        cfg.datasets.add(leftDs);
        cfg.datasets.add(rightDs);
        cfg.keyFields.put(leftDs, leftExpr);
        cfg.keyFields.put(rightDs, rightExpr);
        return cfg;
    }

    private LedgerRow row(String ds, String key, String json, LocalDateTime time, long seq) {
        ReconSourceRecord rec = ReconSourceRecord.builder()
                .dsCode(ds)
                .recordKey(key)
                .recordData(json)
                .recordTime(time)
                .updateSeq(seq)
                .build();
        LedgerRow r = LedgerRow.of(rec, "incr");
        try {
            r.setRecordData(new ObjectMapper().readTree(json));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return r;
    }

    @Test
    void exactKeyMatched() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(row("left", "k1", "{\"order_no\":\"A1001\"}", null, 1)));
        ds.put("right", List.of(row("right", "k1", "{\"order_no\":\"A1001\"}", null, 1)));
        MatchResult r = engine.match(cfg, ds);
        assertEquals(1, r.getPairs().size());
        assertEquals(0, r.getUnmatchedLeft().size());
        assertEquals(0, r.getUnmatchedRight().size());
        assertEquals(0, r.getAnomalies().size());
    }

    @Test
    void unmatchedSides() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(row("left", "k1", "{\"order_no\":\"A1001\"}", null, 1)));
        ds.put("right", List.of(row("right", "k2", "{\"order_no\":\"B2002\"}", null, 1)));
        MatchResult r = engine.match(cfg, ds);
        assertEquals(0, r.getPairs().size());
        assertEquals(1, r.getUnmatchedLeft().size());
        assertEquals(1, r.getUnmatchedRight().size());
    }

    @Test
    void compositeKey() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right",
                "{order_no}_{pay_channel}", "{order_no}_{pay_channel}");
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(row("left", "k1", "{\"order_no\":\"A1001\",\"pay_channel\":\"wx\"}", null, 1)));
        ds.put("right", List.of(row("right", "k1", "{\"order_no\":\"A1001\",\"pay_channel\":\"wx\"}", null, 1)));
        MatchResult r = engine.match(cfg, ds);
        assertEquals(1, r.getPairs().size());
        assertEquals("A1001_wx", r.getPairs().get(0).getMatchKeyDisplay());
    }

    @Test
    void emptyKeyGoesAnomaly() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(row("left", "k1", "{\"amount\":100}", null, 1)));
        MatchResult r = engine.match(cfg, ds);
        assertEquals(1, r.getAnomalies().size());
        AnomalyRow a = r.getAnomalies().get(0);
        assertEquals("empty_key", a.getReason());
        assertTrue(a.getMatchKeyDisplay().startsWith("__nullkey__:left:k1"));
    }

    @Test
    void prefixRemoveTransformMerges() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        cfg.transforms.add(new MatchEngine.TransformRule("left", "order_no", "prefix_remove", "SO", null));
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(row("left", "k1", "{\"order_no\":\"SOA1001\"}", null, 1)));
        ds.put("right", List.of(row("right", "k1", "{\"order_no\":\"A1001\"}", null, 1)));
        MatchResult r = engine.match(cfg, ds);
        assertEquals(1, r.getPairs().size());
        // 展示值取台账原始值（§18.4 展示语义），归一值体现在 hash/rawKey
        assertEquals("SOA1001", r.getPairs().get(0).getMatchKeyDisplay());
    }

    @Test
    void regexReplaceTransform() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        cfg.transforms.add(new MatchEngine.TransformRule("left", "order_no", "regex_replace", "-", ""));
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(row("left", "k1", "{\"order_no\":\"A-1001\"}", null, 1)));
        ds.put("right", List.of(row("right", "k1", "{\"order_no\":\"A1001\"}", null, 1)));
        MatchResult r = engine.match(cfg, ds);
        assertEquals(1, r.getPairs().size());
    }

    @Test
    void multiRowRejectBecomesAnomaly() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(
                row("left", "k1", "{\"order_no\":\"A1001\",\"amt\":10}", null, 1),
                row("left", "k2", "{\"order_no\":\"A1001\",\"amt\":20}", null, 2)));
        ds.put("right", List.of(row("right", "k1", "{\"order_no\":\"A1001\",\"amt\":30}", null, 1)));
        MatchResult r = engine.match(cfg, ds);
        assertEquals(0, r.getPairs().size());
        assertEquals(1, r.getAnomalies().size());
        assertEquals("multi_row_reject", r.getAnomalies().get(0).getReason());
    }

    @Test
    void multiRowAggregateSumsNumeric() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        cfg.multiRow.put("left", "aggregate");
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(
                row("left", "k1", "{\"order_no\":\"A1001\",\"amt\":10}", null, 1),
                row("left", "k2", "{\"order_no\":\"A1001\",\"amt\":20}", null, 2)));
        ds.put("right", List.of(row("right", "k1", "{\"order_no\":\"A1001\",\"amt\":30}", null, 1)));
        MatchResult r = engine.match(cfg, ds);
        assertEquals(1, r.getPairs().size());
        MatchPair p = r.getPairs().get(0);
        assertEquals(2, p.getLeftRows().size());
        assertEquals(2, p.getMultiRowGroupSize());
        assertEquals("30", p.getLeftSingle().getRecordData().path("amt").asText());
    }

    @Test
    void multiRowLatestTakesMaxRecordTime() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        cfg.multiRow.put("left", "latest");
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(
                row("left", "k1", "{\"order_no\":\"A1001\",\"amt\":10}",
                        LocalDateTime.of(2026, 8, 1, 10, 0), 1),
                row("left", "k2", "{\"order_no\":\"A1001\",\"amt\":20}",
                        LocalDateTime.of(2026, 8, 1, 11, 0), 2)));
        ds.put("right", List.of(row("right", "k1", "{\"order_no\":\"A1001\",\"amt\":20}", null, 1)));
        MatchResult r = engine.match(cfg, ds);
        assertEquals(1, r.getPairs().size());
        assertEquals("20", r.getPairs().get(0).getLeftSingle().getRecordData().path("amt").asText());
    }

    @Test
    void computeKeyHashMatchesDisplay() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        LedgerRow r = row("left", "k1", "{\"order_no\":\"A1001\"}", null, 1);
        String h = engine.computeKeyHash(cfg, "left", r);
        assertNotNull(h);
        // 与 match 产出同一 hash
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(r));
        ds.put("right", List.of(row("right", "k1", "{\"order_no\":\"A1001\"}", null, 1)));
        MatchResult mr = engine.match(cfg, ds);
        assertEquals(h, mr.getPairs().get(0).getMatchKeyHash());
    }

    @Test
    void emptyKeyHashReturnsNull() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        LedgerRow r = row("left", "k1", "{\"amount\":100}", null, 1);
        assertNull(engine.computeKeyHash(cfg, "left", r));
    }

    @Test
    void transformChainRecordedOnPair() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        cfg.transforms.add(new MatchEngine.TransformRule("left", "order_no", "prefix_remove", "SO", null));
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ds.put("left", List.of(row("left", "k1", "{\"order_no\":\"SOA1001\"}", null, 1)));
        ds.put("right", List.of(row("right", "k1", "{\"order_no\":\"A1001\"}", null, 1)));
        MatchResult r = engine.match(cfg, ds);
        assertEquals(1, r.getPairs().size());
        assertTrue(r.getPairs().get(0).getTransformChain() != null);
    }

    @Test
    void missingRecordDataGivesEmptyKeyAnomaly() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ReconSourceRecord rec = ReconSourceRecord.builder().dsCode("left").recordKey("k1").updateSeq(1L).build();
        LedgerRow r = LedgerRow.of(rec, "incr");
        ds.put("left", List.of(r));
        ds.put("right", new ArrayList<>());
        MatchResult mr = engine.match(cfg, ds);
        // recordData 缺失 → 模板求值空 → empty_key anomaly（而非 unmatched）
        assertEquals(1, mr.getAnomalies().size());
        assertEquals("empty_key", mr.getAnomalies().get(0).getReason());
        assertEquals(0, mr.getUnmatchedLeft().size());
    }

    /** 回归（池/索引还原缺 record_data 缺陷）：LedgerRow.of 应解析 record_data，匹配键不再变 __nullkey__。 */
    @Test
    void ofParsesRecordDataSoKeyNotEmpty() {
        MatchEngine.MatchRuleConfig cfg = cfg("left", "right", "{order_no}", "{order_no}");
        Map<String, List<LedgerRow>> ds = new LinkedHashMap<>();
        ReconSourceRecord rec = ReconSourceRecord.builder()
                .dsCode("left").recordKey("k1").recordData("{\"order_no\":\"A1001\"}")
                .updateSeq(1L).build();
        ds.put("left", List.of(LedgerRow.of(rec, "pool")));
        ds.put("right", List.of(row("right", "k1", "{\"order_no\":\"A1001\"}", null, 1)));
        MatchResult mr = engine.match(cfg, ds);
        assertEquals(1, mr.getPairs().size());
        assertEquals(0, mr.getAnomalies().size());
        assertEquals(0, mr.getUnmatchedLeft().size());
    }
}
