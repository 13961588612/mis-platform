package com.mis.recon.dao;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 对账汇总 summary 查询单测（对账汇总 R15，v1.3 整体累计口径）。
 * <p>纯 Mockito 单测：mock reconJdbcTemplate 的 check 定义（RowMapper 查询）+ 台账/池/最近执行
 * （queryForList），覆盖整体累计组装（total = success + diff + fail 恒自洽）、主数据源解析、
 * 状态过滤、主数据源未配置 → 4 数 null。</p>
 */
class SummaryDaoTest {

    private JdbcTemplate jdbcTemplate;
    private SummaryDao dao;

    @BeforeEach
    void setUp() {
        jdbcTemplate = mock(JdbcTemplate.class);
        dao = new SummaryDao(jdbcTemplate, new ObjectMapper());
    }

    private void stubDefs(List<SummaryDao.CheckDef> defs) {
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), any(Object[].class)))
                .thenReturn(defs);
    }

    /** queryForList 按 SQL 内容分发：最近执行（recon_run）→ 台账（recon_source_record）→ 池（recon_detail），消除调用顺序依赖。 */
    private void stubQueryForList(List<Map<String, Object>> runs,
                                  List<Map<String, Object>> ledger,
                                  List<Map<String, Object>> pool) {
        org.mockito.Mockito.doAnswer(inv -> {
            String sql = inv.getArgument(0);
            if (sql.contains("recon_run")) {
                return runs;
            }
            if (sql.contains("recon_source_record")) {
                return ledger;
            }
            return pool;
        }).when(jdbcTemplate).queryForList(anyString(), any(Object[].class));
    }

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return m;
    }

    @Test
    void overallAccumulationIsSelfConsistent() {
        List<SummaryDao.CheckDef> defs = List.of(
                new SummaryDao.CheckDef("sc1", "c1", "exact_key", "ds_left"));
        // 台账 4800 行；池：ul=1, ur=1, fm=1, anomaly=1
        stubDefs(defs);
        stubQueryForList(
                List.of(row("id", 7L, "scenario_code", "sc1", "status", "success",
                        "err_msg", null, "finished_at", Timestamp.valueOf(LocalDateTime.of(2026, 8, 28, 9, 0)))),
                List.of(row("ds_code", "ds_left", "cnt", 4800L)),
                List.of(row("scenario_code", "sc1", "check_name", "c1",
                        "diff_cnt", 3L, "anomaly_cnt", 1L, "ul_cnt", 1L, "fm_cnt", 1L)));

        List<SummaryDao.SummaryRow> rows = dao.summary(null, null);

        assertEquals(1, rows.size());
        SummaryDao.SummaryRow r = rows.get(0);
        assertEquals("exact_key", r.strategy());
        assertEquals(7, r.latestRunId());
        assertEquals("success", r.runStatus());
        // 成功 = 4800 − 1(ul) − 1(fm) − 1(anomaly) = 4797；差异 = 3（非 anomaly 池存量，含 ur）；失败 = 1
        assertEquals(4797L, r.success());
        assertEquals(3L, r.diff());
        assertEquals(1L, r.fail());
        assertEquals(4801L, r.total()); // 4797 + 3 + 1 恒自洽
    }

    @Test
    void unmatchedRightCountsIntoDiffNotSuccessDeduction() {
        // ur 不占主侧台账：成功推导只扣 ul/fm/anomaly；差异含 ur
        List<SummaryDao.CheckDef> defs = List.of(
                new SummaryDao.CheckDef("sc1", "c1", "sum_check", "ds_only"));
        stubDefs(defs);
        stubQueryForList(
                List.of(row("id", 1L, "scenario_code", "sc1", "status", "success",
                        "err_msg", null, "finished_at", null)),
                List.of(row("ds_code", "ds_only", "cnt", 100L)),
                List.of(row("scenario_code", "sc1", "check_name", "c1",
                        "diff_cnt", 5L, "anomaly_cnt", 0L, "ul_cnt", 2L, "fm_cnt", 0L)));

        SummaryDao.SummaryRow r = dao.summary("sc1", null).get(0);
        assertEquals(98L, r.success());      // 100 − 2(ul) − 0(fm) − 0(anomaly)
        assertEquals(5L, r.diff());          // 含 ur
        assertEquals(0L, r.fail());
        assertEquals(103L, r.total());       // 98 + 5 + 0
    }

    @Test
    void missingLeftDsYieldsNullNumbers() {
        List<SummaryDao.CheckDef> defs = List.of(
                new SummaryDao.CheckDef("sc1", "c1", "exact_key", null));
        stubDefs(defs);
        stubQueryForList(
                List.of(row("id", 2L, "scenario_code", "sc1", "status", "skipped",
                        "err_msg", "skip reason", "finished_at", null)),
                List.of(),
                List.of());

        SummaryDao.SummaryRow r = dao.summary(null, null).get(0);
        assertNull(r.total());
        assertNull(r.success());
        assertNull(r.diff());
        assertNull(r.fail());
        assertEquals("skipped", r.runStatus());
        assertEquals("skip reason", r.errMsg());
    }

    @Test
    void statusFilterDropsMismatchedRows() {
        List<SummaryDao.CheckDef> defs = List.of(
                new SummaryDao.CheckDef("sc1", "c1", "exact_key", "ds_left"));
        stubDefs(defs);
        stubQueryForList(
                List.of(row("id", 3L, "scenario_code", "sc1", "status", "success",
                        "err_msg", null, "finished_at", null)),
                List.of(row("ds_code", "ds_left", "cnt", 10L)),
                List.of());

        assertTrue(dao.summary(null, "failed").isEmpty()); // 最近执行 success，failed 过滤后为空
    }

    @Test
    void parseLeftDsCodeTakesFirstConsumeAlias() throws Exception {
        java.lang.reflect.Method m = SummaryDao.class.getDeclaredMethod("parseLeftDsCode", String.class);
        m.setAccessible(true);
        // JSON 顺序保持：left 在前
        assertEquals("ds_left",
                m.invoke(dao, "{\"left\":{\"mode\":\"incremental\",\"ds_code\":\"ds_left\"},\"right\":{\"mode\":\"incremental\",\"ds_code\":\"ds_right\"}}"));
        // 单源 sum_check
        assertEquals("ds_only",
                m.invoke(dao, "{\"src\":{\"ds_code\":\"ds_only\"}}"));
        // 空/坏 JSON → null
        assertNull(m.invoke(dao, (Object) null));
        assertNull(m.invoke(dao, "{}"));
        assertNull(m.invoke(dao, "not-json"));
    }

    @Test
    void poolSqlUsesUnhandledPoolAndSplitsDiffType() {
        java.util.concurrent.atomic.AtomicReference<String> sqlRef = new java.util.concurrent.atomic.AtomicReference<>();
        org.mockito.Mockito.doAnswer(inv -> {
            sqlRef.set(inv.getArgument(0));
            return List.of();
        }).when(jdbcTemplate).queryForList(anyString(), any(Object[].class));

        SummaryDao dao2 = new SummaryDao(jdbcTemplate, new ObjectMapper());
        try {
            java.lang.reflect.Method m = SummaryDao.class.getDeclaredMethod("countPool", String.class);
            m.setAccessible(true);
            m.invoke(dao2, (Object) null);
        } catch (Exception ignored) {
            // 仅断言 SQL 口径
        }
        String sql = sqlRef.get();
        assertTrue(sql.contains("status IN ('pending','confirmed')"));
        assertTrue(sql.contains("handle_status = 'unhandled'"));
        assertTrue(sql.contains("FILTER (WHERE diff_type <> 'anomaly')"));
        assertTrue(sql.contains("FILTER (WHERE diff_type = 'anomaly')"));
    }

    /**
     * 序列化冒烟：模拟 JacksonConfig 全局 Long→String + SNAKE_CASE，验证 NumberFieldSerializer
     * 把统计数值反控为 JSON number、ID（latest_run_id）仍为字符串（防 JS 精度丢失）。
     * 复现并防护 "NumberSerializer 被 Spring 接管实例化失败" 类回归（@JsonSerialize 必须用无参构造的 serializer）。
     */
    @Test
    void summaryRowSerializesStatsAsNumbersAndIdAsString() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        mapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        mapper.registerModule(new SimpleModule()
                .addSerializer(Long.class, ToStringSerializer.instance)
                .addSerializer(Long.TYPE, ToStringSerializer.instance));

        SummaryDao.SummaryRow r = new SummaryDao.SummaryRow(
                "sc1", "c1", "exact_key", 7L, null, "success", null, 100L, 98L, 1L, 1L);
        JsonNode node = mapper.readTree(mapper.writeValueAsString(r));

        assertEquals(100, node.get("total").asInt());
        assertTrue(node.get("total").isNumber());
        assertTrue(node.get("success").isNumber());
        assertTrue(node.get("diff").isNumber());
        assertTrue(node.get("fail").isNumber());
        assertTrue(node.get("latest_run_id").isTextual());
        assertEquals("7", node.get("latest_run_id").asText());
    }
}
