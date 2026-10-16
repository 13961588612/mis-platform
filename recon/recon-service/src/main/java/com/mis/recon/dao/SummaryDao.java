package com.mis.recon.dao;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.mis.recon.common.NumberFieldSerializer;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 对账汇总查询（对账汇总 R13~R15，v1.3 整体累计口径）。
 * <p>数据来源（无新增表/列）：
 * <ul>
 *   <li>recon_match_rule + recon_check —— check 定义（scenario_code + check_name + strategy + 主数据源
 *       consume_json 首个 ds_code，即左源/唯一源）；</li>
 *   <li>recon_source_record —— 主侧台账有效记录数（ds_code + is_deleted=0）；</li>
 *   <li>recon_detail —— 差异池按 diff_type 分组存量（status∈{pending,confirmed} AND handle_status='unhandled'，
 *       走 idx_detail_pool，R14）；</li>
 *   <li>recon_run —— 每场景最近一次执行（辅助列，非统计口径）。</li>
 * </ul>
 * 组装口径（v1.3 §5.1，恒自洽）：成功 = 台账 − (unmatched_left + field_mismatch + anomaly)；
 * 差异 = 池中非 anomaly 存量（含 unmatched_right）；失败 = 池中 anomaly 存量；总数 = 成功 + 差异 + 失败。
 * 主数据源未配置 → 4 数返回 null（前端显示「—」）。</p>
 */
@Repository
public class SummaryDao {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public SummaryDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    /** 汇总行：每 check 一行（runStatus=failed 时前端整行标红 + 失败列显示「执行失败」）。 */
    public record SummaryRow(String scenarioCode, String checkName, String strategy,
                             Long latestRunId, LocalDateTime latestRunTime, String runStatus, String errMsg,
                             // 统计数值反控为 JSON number：全局 Long→String 只应作用于 ID（防精度丢失），
                             // 数值字段仍按 number 返回，前端才能正确求和（JacksonConfig 注释约定）。
                             @JsonSerialize(using = NumberFieldSerializer.class) Long total,
                             @JsonSerialize(using = NumberFieldSerializer.class) Long success,
                             @JsonSerialize(using = NumberFieldSerializer.class) Long diff,
                             @JsonSerialize(using = NumberFieldSerializer.class) Long fail) {
    }

    /** 最近一次执行（辅助列） */
    record RunRow(long id, String scenarioCode, String status, String errMsg, LocalDateTime finishedAt) {
    }

    /** check 定义 + 主数据源（左源/唯一源，consume_json 首个 ds_code） */
    record CheckDef(String scenarioCode, String checkName, String strategy, String leftDsCode) {
    }

    /** 差异池按 diff_type 分组存量 */
    record PoolCounts(long diff, long anomaly, long unmatchedLeft, long fieldMismatch) {
    }

    public List<SummaryRow> summary(String scenarioCode, String status) {
        List<CheckDef> defs = loadCheckDefs(scenarioCode);
        if (defs.isEmpty()) {
            return List.of();
        }
        Map<String, RunRow> latestByScenario = loadLatestRuns(scenarioCode);
        Map<String, Long> ledgerByDs = countLedger(defs);
        Map<String, PoolCounts> poolByKey = countPool(scenarioCode);

        List<SummaryRow> out = new ArrayList<>();
        for (CheckDef def : defs) {
            RunRow latest = latestByScenario.get(def.scenarioCode());
            String runStatus = latest == null ? null : latest.status();
            if (status != null && StringUtils.hasText(status)
                    && (runStatus == null || !runStatus.equals(status))) {
                continue;
            }

            Long total = null, success = null, diff = null, fail = null;
            if (def.leftDsCode() != null) {
                Long ledger = ledgerByDs.getOrDefault(def.leftDsCode(), 0L);
                PoolCounts pool = poolByKey.getOrDefault(def.scenarioCode() + "\u0000" + def.checkName(),
                        new PoolCounts(0, 0, 0, 0));
                long matched = ledger - pool.unmatchedLeft() - pool.fieldMismatch() - pool.anomaly();
                diff = pool.diff();
                fail = pool.anomaly();
                success = matched;
                total = success + diff + fail;
            }

            out.add(new SummaryRow(def.scenarioCode(), def.checkName(), def.strategy(),
                    latest == null ? null : latest.id(),
                    latest == null ? null : latest.finishedAt(),
                    runStatus,
                    latest == null ? null : latest.errMsg(),
                    total, success, diff, fail));
        }
        return out;
    }

    /** check 定义（recon_match_rule + recon_check），主数据源 = consume_json 首个 alias 的 ds_code。 */
    private List<CheckDef> loadCheckDefs(String scenarioCode) {
        StringBuilder sql = new StringBuilder("""
                SELECT mr.scenario_code, mr.check_name, mr.strategy, ck.consume_json
                FROM recon_match_rule mr
                JOIN recon_check ck
                  ON ck.scenario_code = mr.scenario_code AND ck.check_name = mr.check_name
                WHERE ck.enabled = 1
                """);
        List<Object> args = new ArrayList<>();
        if (StringUtils.hasText(scenarioCode)) {
            sql.append(" AND mr.scenario_code = ?");
            args.add(scenarioCode);
        }
        sql.append(" ORDER BY mr.scenario_code, mr.check_name");
        return jdbcTemplate.query(sql.toString(), (rs, i) -> new CheckDef(
                rs.getString("scenario_code"), rs.getString("check_name"), rs.getString("strategy"),
                parseLeftDsCode(rs.getString("consume_json"))), args.toArray());
    }

    /** consume_json {alias:{mode,ds_code,...}} → 首个 alias 的 ds_code（JSON 顺序即消费顺序，第 1 = 左源/唯一源）。 */
    private String parseLeftDsCode(String consumeJson) {
        if (!StringUtils.hasText(consumeJson)) {
            return null;
        }
        try {
            JsonNode node = objectMapper.readTree(consumeJson);
            Iterator<String> aliases = node.fieldNames();
            if (aliases.hasNext()) {
                JsonNode cfg = node.get(aliases.next());
                String ds = cfg == null ? null : cfg.path("ds_code").asText(null);
                return (ds == null || ds.isBlank()) ? null : ds;
            }
        } catch (Exception ignored) {
            // 坏 JSON：视为主数据源未配置
        }
        return null;
    }

    /** 主侧台账有效记录数：按 ds_code 分组（is_deleted=0）。 */
    private Map<String, Long> countLedger(List<CheckDef> defs) {
        Map<String, Long> map = new HashMap<>();
        List<String> dsCodes = new ArrayList<>();
        for (CheckDef def : defs) {
            if (def.leftDsCode() != null && !dsCodes.contains(def.leftDsCode())) {
                dsCodes.add(def.leftDsCode());
            }
        }
        if (dsCodes.isEmpty()) {
            return map;
        }
        String placeholders = String.join(",", java.util.Collections.nCopies(dsCodes.size(), "?"));
        List<Object> args = new ArrayList<>(dsCodes);
        for (Map<String, Object> row : jdbcTemplate.queryForList(
                "SELECT ds_code, COUNT(*) AS cnt FROM recon_source_record "
                        + "WHERE is_deleted = 0 AND ds_code IN (" + placeholders + ") GROUP BY ds_code",
                args.toArray())) {
            map.put(String.valueOf(row.get("ds_code")), ((Number) row.get("cnt")).longValue());
        }
        return map;
    }

    /** 差异池按 diff_type 分组存量：非 anomaly（差异列）与 anomaly（失败列）分离，另取 ul/fm 供成功推导。 */
    private Map<String, PoolCounts> countPool(String scenarioCode) {
        StringBuilder sql = new StringBuilder("""
                SELECT scenario_code, check_name,
                       COUNT(*) FILTER (WHERE diff_type <> 'anomaly') AS diff_cnt,
                       COUNT(*) FILTER (WHERE diff_type = 'anomaly') AS anomaly_cnt,
                       COUNT(*) FILTER (WHERE diff_type = 'unmatched_left') AS ul_cnt,
                       COUNT(*) FILTER (WHERE diff_type = 'field_mismatch') AS fm_cnt
                FROM recon_detail
                WHERE status IN ('pending','confirmed') AND handle_status = 'unhandled'
                """);
        List<Object> args = new ArrayList<>();
        if (StringUtils.hasText(scenarioCode)) {
            sql.append(" AND scenario_code = ?");
            args.add(scenarioCode);
        }
        sql.append(" GROUP BY scenario_code, check_name");
        Map<String, PoolCounts> map = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), args.toArray())) {
            map.put(row.get("scenario_code") + "\u0000" + row.get("check_name"),
                    new PoolCounts(num(row.get("diff_cnt")), num(row.get("anomaly_cnt")),
                            num(row.get("ul_cnt")), num(row.get("fm_cnt"))));
        }
        return map;
    }

    /** 每场景最近一次执行（辅助列）。 */
    private Map<String, RunRow> loadLatestRuns(String scenarioCode) {
        StringBuilder sql = new StringBuilder("""
                SELECT r.id, r.scenario_code, r.status, r.err_msg, r.finished_at
                FROM recon_run r
                JOIN (SELECT scenario_code, MAX(id) AS mid FROM recon_run GROUP BY scenario_code) t
                  ON t.scenario_code = r.scenario_code AND t.mid = r.id
                """);
        List<Object> args = new ArrayList<>();
        if (StringUtils.hasText(scenarioCode)) {
            sql.append(" WHERE r.scenario_code = ?");
            args.add(scenarioCode);
        }
        Map<String, RunRow> map = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(sql.toString(), args.toArray())) {
            Timestamp ts = (Timestamp) row.get("finished_at");
            map.put(String.valueOf(row.get("scenario_code")), new RunRow(
                    ((Number) row.get("id")).longValue(), String.valueOf(row.get("scenario_code")),
                    (String) row.get("status"), (String) row.get("err_msg"),
                    ts == null ? null : ts.toLocalDateTime()));
        }
        return map;
    }

    private static long num(Object o) {
        return o == null ? 0 : ((Number) o).longValue();
    }
}
