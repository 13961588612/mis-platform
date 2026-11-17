package com.mis.recon.dao;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 已配平索引 DAO（T05-spec §5 / §10.4）：match_key_hash → (ds_code, record_key) 轻量映射。
 * <ul>
 *   <li>回查：IN 分批 1000（单边重拉防误报）</li>
 *   <li>写入：先删后插（aggregate 场景 record_key 集合可变，§10.5）</li>
 *   <li>删除：field_mismatch / resolved 重开时按身份删（§10.5）</li>
 * </ul>
 */
@Repository
public class MatchedIndexDao {

    /** 索引条目 */
    public static class IndexRow {
        public final String matchKeyHash;
        public final String dsCode;
        public final String recordKey;
        public final LocalDateTime recordTime;

        public IndexRow(String matchKeyHash, String dsCode, String recordKey, LocalDateTime recordTime) {
            this.matchKeyHash = matchKeyHash;
            this.dsCode = dsCode;
            this.recordKey = recordKey;
            this.recordTime = recordTime;
        }
    }

    private final JdbcTemplate jdbcTemplate;

    public MatchedIndexDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 按 match_key_hash 集合回查（IN 分批 1000） */
    public List<IndexRow> lookup(String scenarioCode, String checkName, String pairSegment, List<String> hashSet) {
        if (hashSet == null || hashSet.isEmpty()) {
            return List.of();
        }
        List<IndexRow> result = new ArrayList<>();
        for (int from = 0; from < hashSet.size(); from += KEYS_BATCH) {
            List<String> batch = hashSet.subList(from, Math.min(from + KEYS_BATCH, hashSet.size()));
            String inSql = String.join(",", java.util.Collections.nCopies(batch.size(), "?"));
            List<Object> args = new ArrayList<>(List.of(scenarioCode, checkName, pairSegment));
            args.addAll(batch);
            result.addAll(jdbcTemplate.query(
                    "SELECT match_key_hash, ds_code, record_key, record_time" +
                    "  FROM recon_matched_index" +
                    " WHERE scenario_code = ? AND check_name = ? AND pair_segment = ?" +
                    "   AND match_key_hash IN (" + inSql + ")",
                    (rs, i) -> {
                        Timestamp t = rs.getTimestamp("record_time");
                        return new IndexRow(rs.getString("match_key_hash"), rs.getString("ds_code"),
                                rs.getString("record_key"), t == null ? null : t.toLocalDateTime());
                    },
                    args.toArray()));
        }
        return result;
    }

    /** 先删后插：按 (scenario, check, pair_segment, match_key_hash) 删全部，再插当前行（两侧各一行或多行） */
    public void replace(String scenarioCode, String checkName, String pairSegment,
                        String matchKeyHash, String matchKeyDisplay, List<IndexRow> rows) {
        jdbcTemplate.update("""
                DELETE FROM recon_matched_index
                 WHERE scenario_code = ? AND check_name = ? AND pair_segment = ? AND match_key_hash = ?
                """, scenarioCode, checkName, pairSegment, matchKeyHash);
        if (rows.isEmpty()) {
            return;
        }
        jdbcTemplate.batchUpdate("""
                INSERT INTO recon_matched_index
                  (scenario_code, check_name, pair_segment, match_key_hash, match_key_display,
                   ds_code, record_key, record_time, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())
                """, rows, 200, (ps, r) -> {
                    ps.setString(1, scenarioCode);
                    ps.setString(2, checkName);
                    ps.setString(3, pairSegment);
                    ps.setString(4, matchKeyHash);
                    ps.setString(5, matchKeyDisplay);
                    ps.setString(6, r.dsCode);
                    ps.setString(7, r.recordKey);
                    ps.setTimestamp(8, r.recordTime == null ? null : Timestamp.valueOf(r.recordTime));
                });
    }

    /** field_mismatch / resolved 重开时按身份删除索引（§10.5） */
    public void deleteByIdentity(String scenarioCode, String checkName, String pairSegment, String matchKeyHash) {
        jdbcTemplate.update("""
                DELETE FROM recon_matched_index
                 WHERE scenario_code = ? AND check_name = ? AND pair_segment = ? AND match_key_hash = ?
                """, scenarioCode, checkName, pairSegment, matchKeyHash);
    }

    /** 数据源重建：删除该 check 全部配对索引（重建后全量重算）。 */
    public int deleteByCheck(String scenarioCode, String checkName) {
        return jdbcTemplate.update("""
                DELETE FROM recon_matched_index
                 WHERE scenario_code = ? AND check_name = ?
                """, scenarioCode, checkName);
    }

    private static final int KEYS_BATCH = 1000;
}
