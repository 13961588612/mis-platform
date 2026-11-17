package com.mis.recon.dao;

import com.mis.recon.domain.ledger.ReconSourceRecord;
import com.mis.recon.util.JsonUtil;
import com.mis.recon.util.KeyExprEvaluator;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 台账 DAO（F65，JdbcTemplate 热路径，技术适配 §2.4）。
 * <ul>
 *   <li>upsert：INSERT ... ON CONFLICT (ds_code, record_key) DO UPDATE（技术适配 §2.3 骨架）</li>
 *   <li>update_seq：Java 先 nextval 再显式传入（T04-spec §5.1 修订：SQL 内 nextval 无法取回，取号可追踪）</li>
 *   <li>insert/update 计数：RETURNING (xmax = 0)（PG 官方技巧：xmax=0 表示刚插入行）</li>
 *   <li>record_data：按源 SQL 输出列名原样存储（G9），值统一转字符串（V1 DDL：整行 JSON 值一律字符串）</li>
 * </ul>
 */
@Repository
public class LedgerDao {

    /** 金额语义（amount_fields_json primary 字段解析结果，LedgerService.resolveAmountSpec 产出） */
    public static class AmountSpec {
        public String primaryField;   // primary 字段名（源列名）；无 primary → null
        public String unit;           // yuan/point/non_monetary
        public String signRule;       // as_is/negate
        public String direction;      // in/out/none
    }

    /** 批次结果 */
    public static class BatchResult {
        public int insertCount;
        public int updateCount;
        public long maxSeq;
        public final List<String> errorRows = new ArrayList<>();

        public void addInsert() { insertCount++; }
        public void addUpdate() { updateCount++; }
    }

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final JdbcTemplate jdbcTemplate;

    public LedgerDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 批量 upsert 台账（每批一个事务，事务由调用方 TransactionTemplate 提供）。
     *
     * @param dsCode          数据源编码
     * @param recordKeyExpr  record_key 模板表达式（ds.record_key_expression）
     * @param rows            源行数据 List（key=输出列名）
     * @param pullRunId       本次拉取运行 id（last_pull_run_id）
     * @param timeField       业务时间列（record_time 取值）
     * @param amountSpec      金额语义（无 primary → null）
     * @return 批次结果（insert/update/maxSeq/errorRows）
     */
    public BatchResult upsertBatch(String dsCode, String recordKeyExpr, List<Map<String, Object>> rows,
                                   long pullRunId, String timeField, AmountSpec amountSpec) {
        BatchResult result = new BatchResult();
        for (Map<String, Object> row : rows) {
            upsertOneRow(dsCode, recordKeyExpr, row, pullRunId, timeField, amountSpec, result);
        }
        return result;
    }

    /**
     * fetch_one 单条 upsert。
     */
    public BatchResult upsertOne(String dsCode, String recordKeyExpr, Map<String, Object> row,
                                 long pullRunId, String timeField, AmountSpec amountSpec) {
        BatchResult result = new BatchResult();
        upsertOneRow(dsCode, recordKeyExpr, row, pullRunId, timeField, amountSpec, result);
        return result;
    }

    private void upsertOneRow(String dsCode, String recordKeyExpr, Map<String, Object> row, long pullRunId,
                              String timeField, AmountSpec amountSpec, BatchResult result) {
        try {
            String recordKey = KeyExprEvaluator.evaluate(recordKeyExpr, row);
            if (recordKey == null) {
                result.errorRows.add("record_key 求值失败（模板字段缺失），跳过该行");
                return;
            }
            String recordData = JsonUtil.toString(normalizeRow(row));
            LocalDateTime recordTime = toLocalDateTime(row.get(timeField));
            Long seq = nextSeq();

            Long amountCent = null;
            String amountRaw = null;
            String amountDirection = null;
            if (amountSpec != null && amountSpec.primaryField != null) {
                Object raw = row.get(amountSpec.primaryField);
                if (raw != null) {
                    amountRaw = String.valueOf(raw);
                    amountCent = com.mis.recon.util.AmountUtil.toCent(amountRaw, amountSpec.unit, amountSpec.signRule);
                }
                amountDirection = amountSpec.direction;
            }

            Boolean inserted = jdbcTemplate.queryForObject(UPSERT_SQL, Boolean.class,
                    dsCode, recordKey, recordData,
                    recordTime, recordTime == null ? null : recordTime.toLocalDate(),
                    seq, amountCent, amountRaw, amountDirection, pullRunId);
            if (Boolean.TRUE.equals(inserted)) {
                result.addInsert();
            } else {
                result.addUpdate();
            }
            result.maxSeq = Math.max(result.maxSeq, seq);
        } catch (Exception e) {
            result.errorRows.add("upsert 失败: " + e.getMessage());
        }
    }

    private static final String UPSERT_SQL = """
            INSERT INTO recon_source_record
              (ds_code, record_key, record_data, record_time, biz_date, update_seq,
               is_deleted, deleted_at, amount_cent, amount_raw, amount_direction, last_pull_run_id, created_at, updated_at)
            VALUES (?, ?, CAST(? AS jsonb), ?, CAST(? AS date), ?,
                    0, NULL, ?, ?, ?, ?, now(), now())
            ON CONFLICT (ds_code, record_key)
            DO UPDATE SET
              record_data  = EXCLUDED.record_data,
              record_time  = EXCLUDED.record_time,
              biz_date     = EXCLUDED.biz_date,
              update_seq   = EXCLUDED.update_seq,
              is_deleted   = 0,
              deleted_at   = NULL,
              amount_cent  = EXCLUDED.amount_cent,
              amount_raw   = EXCLUDED.amount_raw,
              amount_direction = EXCLUDED.amount_direction,
              last_pull_run_id = EXCLUDED.last_pull_run_id,
              updated_at   = now()
            RETURNING (xmax = 0) AS inserted
            """;

    private long nextSeq() {
        Long seq = jdbcTemplate.queryForObject("SELECT nextval('recon_update_seq')", Long.class);
        return seq == null ? 0 : seq;
    }

    /** 源行值 → 字符串（时间统一 yyyy-MM-dd HH:mm:ss；null 保留），供 record_data 序列化 */
    private Map<String, Object> normalizeRow(Map<String, Object> row) {
        Map<String, Object> normalized = new LinkedHashMap<>(row.size());
        row.forEach((k, v) -> normalized.put(k, valueToString(v)));
        return normalized;
    }

    private String valueToString(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof java.sql.Timestamp ts) {
            return ts.toLocalDateTime().format(TIME_FMT);
        }
        if (v instanceof LocalDateTime ldt) {
            return ldt.format(TIME_FMT);
        }
        if (v instanceof java.util.Date d) {
            return new java.sql.Timestamp(d.getTime()).toLocalDateTime().format(TIME_FMT);
        }
        return String.valueOf(v);
    }

    private LocalDateTime toLocalDateTime(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof java.sql.Timestamp ts) {
            return ts.toLocalDateTime();
        }
        if (v instanceof LocalDateTime ldt) {
            return ldt;
        }
        if (v instanceof java.util.Date d) {
            return new java.sql.Timestamp(d.getTime()).toLocalDateTime();
        }
        if (v instanceof String s && !s.isBlank()) {
            try {
                return LocalDateTime.parse(s, TIME_FMT);
            } catch (Exception ignore) {
                return null;
            }
        }
        return null;
    }

    /** 数据源重建：删除该数据源全部台账行（含逻辑删除行），返回删除行数。 */
    public int deleteByDs(String dsCode) {
        return jdbcTemplate.update("DELETE FROM recon_source_record WHERE ds_code = ?", dsCode);
    }

    /** 逻辑删除（T05 消费：fetch_one 重拉已配平行 / 源侧删除传播） */
    public void markDeleted(String dsCode, String recordKey) {
        jdbcTemplate.update("""
                UPDATE recon_source_record
                   SET is_deleted = 1, deleted_at = now(), update_seq = nextval('recon_update_seq')
                 WHERE ds_code = ? AND record_key = ?
                """, dsCode, recordKey);
    }

    /** 按 seq 区间增量扫描（T05 ReconRunner 消费） */
    public List<ReconSourceRecord> queryBySeq(String dsCode, long lo, long hi) {
        return jdbcTemplate.query("""
                SELECT id, ds_code, record_key, record_data::text, record_time, biz_date, update_seq,
                       is_deleted, deleted_at, amount_cent, amount_raw, amount_direction, last_pull_run_id,
                       created_at, updated_at
                  FROM recon_source_record
                 WHERE ds_code = ? AND is_deleted = 0 AND update_seq > ? AND update_seq <= ?
                 ORDER BY update_seq
                """, SOURCE_ROW_MAPPER, dsCode, lo, hi);
    }

    private static final org.springframework.jdbc.core.RowMapper<ReconSourceRecord> SOURCE_ROW_MAPPER =
            (rs, i) -> ReconSourceRecord.builder()
                    .id(rs.getLong("id"))
                    .dsCode(rs.getString("ds_code"))
                    .recordKey(rs.getString("record_key"))
                    .recordData(rs.getString("record_data"))
                    .recordTime(rs.getTimestamp("record_time") == null ? null : rs.getTimestamp("record_time").toLocalDateTime())
                    .bizDate(rs.getDate("biz_date") == null ? null : rs.getDate("biz_date").toLocalDate())
                    .updateSeq(rs.getLong("update_seq"))
                    .isDeleted(rs.getInt("is_deleted"))
                    .deletedAt(rs.getTimestamp("deleted_at") == null ? null : rs.getTimestamp("deleted_at").toLocalDateTime())
                    .amountCent(rs.getLong("amount_cent") == 0 && rs.wasNull() ? null : rs.getLong("amount_cent"))
                    .amountRaw(rs.getString("amount_raw"))
                    .amountDirection(rs.getString("amount_direction"))
                    .lastPullRunId(rs.getLong("last_pull_run_id"))
                    .createdAt(rs.getTimestamp("created_at") == null ? null : rs.getTimestamp("created_at").toLocalDateTime())
                    .updatedAt(rs.getTimestamp("updated_at") == null ? null : rs.getTimestamp("updated_at").toLocalDateTime())
                    .build();

    /** 按 record_key 批量查当前值（池还原 / 索引回查；T05-spec §5）。不过滤 is_deleted，调用方判定。 */
    public List<ReconSourceRecord> queryByKeys(String dsCode, List<String> recordKeys) {        if (recordKeys == null || recordKeys.isEmpty()) {
            return List.of();
        }
        List<ReconSourceRecord> result = new ArrayList<>();
        for (int from = 0; from < recordKeys.size(); from += KEYS_BATCH) {
            List<String> batch = recordKeys.subList(from, Math.min(from + KEYS_BATCH, recordKeys.size()));
            String inSql = String.join(",", java.util.Collections.nCopies(batch.size(), "?"));
            List<Object> args = new ArrayList<>();
            args.add(dsCode);
            args.addAll(batch);
            result.addAll(jdbcTemplate.query(
                    "SELECT id, ds_code, record_key, record_data::text, record_time, biz_date, update_seq," +
                    "       is_deleted, deleted_at, amount_cent, amount_raw, amount_direction, last_pull_run_id," +
                    "       created_at, updated_at" +
                    "  FROM recon_source_record WHERE ds_code = ? AND record_key IN (" + inSql + ")",
                    SOURCE_ROW_MAPPER, args.toArray()));
        }
        return result;
    }

    /** time_window 全量圈定：record_time ∈ [start, end)（T05-spec §4；无游标，每轮重算窗口） */
    public List<ReconSourceRecord> queryByTime(String dsCode, LocalDateTime start, LocalDateTime end) {
        return jdbcTemplate.query("""
                SELECT id, ds_code, record_key, record_data::text, record_time, biz_date, update_seq,
                       is_deleted, deleted_at, amount_cent, amount_raw, amount_direction, last_pull_run_id,
                       created_at, updated_at
                  FROM recon_source_record
                 WHERE ds_code = ? AND is_deleted = 0 AND record_time >= ? AND record_time < ?
                 ORDER BY record_time
                """, SOURCE_ROW_MAPPER, dsCode, start, end);
    }

    private static final int KEYS_BATCH = 1000;
}
