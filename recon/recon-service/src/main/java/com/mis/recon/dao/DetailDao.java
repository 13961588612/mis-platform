package com.mis.recon.dao;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;

/**
 * 差异 DAO（T05-spec §5，JdbcTemplate 热路径写入侧）。
 * <ul>
 *   <li>差异身份 upsert：ON CONFLICT (scenario_code, check_name, pair_segment, match_key_hash) DO UPDATE（uk_detail_identity）</li>
 *   <li>锚表先删后插：recon_detail_source_ref（detail_id, side, ds_code, record_key）</li>
 *   <li>状态流转独立 UPDATE：markResolved / reopen / resetPending（DO UPDATE 不覆盖 pending 字段，避免流转误写）</li>
 * </ul>
 */
@Repository
public class DetailDao {

    /** 差异身份（四元组，V1 uk_detail_identity） */
    public static class DetailIdentity {
        public final String scenarioCode;
        public final String checkName;
        public final String pairSegment;
        public final String matchKeyHash;

        public DetailIdentity(String scenarioCode, String checkName, String pairSegment, String matchKeyHash) {
            this.scenarioCode = scenarioCode;
            this.checkName = checkName;
            this.pairSegment = pairSegment;
            this.matchKeyHash = matchKeyHash;
        }
    }

    /** 锚表行 */
    public static class AnchorRow {
        public final String side;
        public final String dsCode;
        public final String recordKey;

        public AnchorRow(String side, String dsCode, String recordKey) {
            this.side = side;
            this.dsCode = dsCode;
            this.recordKey = recordKey;
        }
    }

    /** 差异写入入参 */
    public static class DetailUpsert {
        public DetailIdentity identity;
        public String diffType;              // unmatched_left/unmatched_right/field_mismatch/anomaly
        public String status;                // pending / confirmed
        public String matchKeyDisplay;
        public String diffDesc;
        public Long diffAmountCent;
        public Long diffPoint;           // 非货币计量（积分）差额原值（V5）
        public String diagnosisJson;
        public String leftDataJson;
        public String rightDataJson;
        public Long pendingPeerPullRunId;    // 首次 pending 时写入；DO UPDATE 不覆盖存量
        public String pendingPeerDsCode;
        public List<AnchorRow> anchors = new ArrayList<>();
    }

    /** 池扫描行（detail + 锚） */
    public static class PoolRow {
        public final Long detailId;
        public final String matchKeyHash;
        public final String pairSegment;
        public final String dsCode;
        public final String recordKey;
        public final String side;

        public PoolRow(Long detailId, String matchKeyHash, String pairSegment,
                       String dsCode, String recordKey, String side) {
            this.detailId = detailId;
            this.matchKeyHash = matchKeyHash;
            this.pairSegment = pairSegment;
            this.dsCode = dsCode;
            this.recordKey = recordKey;
            this.side = side;
        }
    }

    private final JdbcTemplate jdbcTemplate;

    public DetailDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 数据源重建：删除该 check 全部差异（含子表 status_history / source_ref / handle），返回删除 detail 行数。 */
    public int deleteByCheck(String scenarioCode, String checkName) {
        jdbcTemplate.update("""
                DELETE FROM recon_diff_status_history
                 WHERE detail_id IN (SELECT id FROM recon_detail WHERE scenario_code = ? AND check_name = ?)
                """, scenarioCode, checkName);
        jdbcTemplate.update("""
                DELETE FROM recon_diff_handle
                 WHERE detail_id IN (SELECT id FROM recon_detail WHERE scenario_code = ? AND check_name = ?)
                """, scenarioCode, checkName);
        jdbcTemplate.update("""
                DELETE FROM recon_detail_source_ref
                 WHERE detail_id IN (SELECT id FROM recon_detail WHERE scenario_code = ? AND check_name = ?)
                """, scenarioCode, checkName);
        return jdbcTemplate.update(
                "DELETE FROM recon_detail WHERE scenario_code = ? AND check_name = ?",
                scenarioCode, checkName);
    }

    /** 池扫描（§10.2）：未平差异 + 锚表行；账龄按 first_seen_at，超过 pool_max_age_days 不入池。
     * <p>调用方决定是否参与池还原（time_window 检查不参与，§18.3）。</p>
     */
    public List<PoolRow> openPool(String scenarioCode, String checkName, int poolMaxAgeDays) {
        return jdbcTemplate.query("""
                SELECT d.id AS detail_id, d.match_key_hash, d.pair_segment,
                       r.ds_code, r.record_key, r.side
                  FROM recon_detail d
                  JOIN recon_detail_source_ref r ON r.detail_id = d.id
                 WHERE d.scenario_code = ? AND d.check_name = ?
                   AND d.status IN ('pending', 'confirmed')
                   AND d.handle_status = 'unhandled'
                   AND d.first_seen_at > now() - (interval '1 day' * ?)
                """, (rs, i) -> new PoolRow(
                        rs.getLong("detail_id"),
                        rs.getString("match_key_hash"),
                        rs.getString("pair_segment"),
                        rs.getString("ds_code"),
                        rs.getString("record_key"),
                        rs.getString("side")),
                scenarioCode, checkName, poolMaxAgeDays);
    }

    /**
     * 差异身份 upsert（幂等核心）。INSERT 写 pending 三字段；DO UPDATE 只刷新证据字段，
     * <b>pending 字段不被覆盖</b>（由 resetPending / 独立流转控制）。
     *
     * @return detail_id（RETURNING）
     */
    public long upsertDetail(DetailUpsert up) {
        Long id = jdbcTemplate.queryForObject("""
                INSERT INTO recon_detail
                  (scenario_code, check_name, pair_segment, match_key_hash, match_key_display,
                   diff_type, status, diff_desc, diff_amount_cent, diff_point, diff_diagnosis_json,
                   left_data_json, right_data_json,
                   pending_peer_pull_run_id, pending_peer_ds_code, pending_at,
                   handle_status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), CAST(? AS jsonb),
                        ?, ?, now(), 'unhandled', now(), now())
                ON CONFLICT (scenario_code, check_name, pair_segment, match_key_hash)
                DO UPDATE SET
                  diff_type = EXCLUDED.diff_type,
                  status = EXCLUDED.status,
                  match_key_display = EXCLUDED.match_key_display,
                  diff_desc = EXCLUDED.diff_desc,
                  diff_amount_cent = EXCLUDED.diff_amount_cent,
                  diff_point = EXCLUDED.diff_point,
                  diff_diagnosis_json = EXCLUDED.diff_diagnosis_json,
                  left_data_json = EXCLUDED.left_data_json,
                  right_data_json = EXCLUDED.right_data_json,
                  updated_at = now()
                RETURNING id
                """, Long.class,
                up.identity.scenarioCode, up.identity.checkName, up.identity.pairSegment, up.identity.matchKeyHash,
                up.matchKeyDisplay, up.diffType, up.status, up.diffDesc, up.diffAmountCent, up.diffPoint,
                up.diagnosisJson, up.leftDataJson, up.rightDataJson,
                up.pendingPeerPullRunId, up.pendingPeerDsCode);
        return id == null ? 0 : id;
    }

    /** 锚表先删后插（每差异重写锚行） */
    public void upsertAnchors(long detailId, List<AnchorRow> anchors) {
        jdbcTemplate.update("DELETE FROM recon_detail_source_ref WHERE detail_id = ?", detailId);
        if (anchors.isEmpty()) {
            return;
        }
        jdbcTemplate.batchUpdate("""
                INSERT INTO recon_detail_source_ref (detail_id, side, ds_code, record_key, created_at)
                VALUES (?, ?, ?, ?, now())
                """, anchors, 200, (ps, a) -> {
                    ps.setLong(1, detailId);
                    ps.setString(2, a.side);
                    ps.setString(3, a.dsCode);
                    ps.setString(4, a.recordKey);
                });
    }

    /** 配平出池：status=resolved（diff_type 保留末态，handle_status 不动） */
    public void markResolved(long detailId) {
        jdbcTemplate.update("""
                UPDATE recon_detail SET status = 'resolved', resolved_at = now(), updated_at = now()
                 WHERE id = ?
                """, detailId);
    }

    /** 重新打开：resolved → confirmed + reopen_seq+1 + 清 reported_at（§18.2） */
    public void reopen(long detailId) {
        jdbcTemplate.update("""
                UPDATE recon_detail
                   SET status = 'confirmed', reopen_seq = reopen_seq + 1,
                       reported_at = NULL, resolved_at = NULL, updated_at = now()
                 WHERE id = ?
                """, detailId);
    }

    /** diff_type 流转时重置 pending 三字段（§10.4） */
    public void resetPending(long detailId) {
        jdbcTemplate.update("""
                UPDATE recon_detail
                   SET pending_peer_ds_code = NULL, pending_peer_pull_run_id = NULL,
                       pending_at = NULL, updated_at = now()
                 WHERE id = ?
                """, detailId);
    }

    /** 未平留池：刷新最后流转时间（不改变账龄起点 first_seen_at） */
    public void touch(long detailId) {
        jdbcTemplate.update("UPDATE recon_detail SET updated_at = now() WHERE id = ?", detailId);
    }

    /** 两轮确认巡检行（T06-spec §7.1）：status=pending 且 peer 身份完整；按 id 升序。 */
    public List<PendingRow> scanPending() {
        return jdbcTemplate.query("""
                SELECT id, scenario_code, check_name, pending_peer_ds_code,
                       pending_peer_pull_run_id, pending_at
                  FROM recon_detail
                 WHERE status = 'pending' AND pending_peer_ds_code IS NOT NULL
                 ORDER BY id
                """, (rs, i) -> new PendingRow(
                        rs.getLong("id"),
                        rs.getString("scenario_code"),
                        rs.getString("check_name"),
                        rs.getString("pending_peer_ds_code"),
                        rs.getLong("pending_peer_pull_run_id"),
                        toLdt(rs.getTimestamp("pending_at"))));
    }

    /** 乐观升级 pending→confirmed（T06-spec §3.3）：诊断补 upgrade_condition；返回影响行数。 */
    public int confirmPending(long id, String upgradeCondition) {
        return jdbcTemplate.update("""
                UPDATE recon_detail
                   SET status = 'confirmed', confirmed_at = now(),
                       diff_diagnosis_json = jsonb_set(
                           COALESCE(diff_diagnosis_json, '{}'::jsonb),
                           '{verdict_phase,upgrade_condition}', to_jsonb(?)),
                       updated_at = now()
                 WHERE id = ? AND status = 'pending'
                """, upgradeCondition, id);
    }

    // ---- 差异处理详情页（V4）查询 ----

    /** 单条详情全字段（V4 详情页用）；不存在 → null。 */
    public DetailRow findById(long id) {
        var list = jdbcTemplate.query("""
                SELECT id, scenario_code, check_name, pair_segment, match_key_hash, match_key_display,
                       diff_type, status, defer_until, pending_peer_pull_run_id, pending_peer_ds_code,
                       pending_at, left_data_json, right_data_json, diff_desc, diff_amount_cent,
                       diff_point, diff_diagnosis_json, handle_status, reported_at, reopen_seq, resolved_at,
                       first_seen_at, confirmed_at, created_at, updated_at
                  FROM recon_detail WHERE id = ?
                """, (rs, i) -> new DetailRow(
                        rs.getLong("id"),
                        rs.getString("scenario_code"),
                        rs.getString("check_name"),
                        rs.getString("pair_segment"),
                        rs.getString("match_key_hash"),
                        rs.getString("match_key_display"),
                        rs.getString("diff_type"),
                        rs.getString("status"),
                        toLdt(rs.getTimestamp("defer_until")),
                        rs.getLong("pending_peer_pull_run_id"),
                        rs.getString("pending_peer_ds_code"),
                        toLdt(rs.getTimestamp("pending_at")),
                        rs.getString("left_data_json"),
                        rs.getString("right_data_json"),
                        rs.getString("diff_desc"),
                        rs.getLong("diff_amount_cent"),
                        rs.getLong("diff_point"),
                        rs.getString("diff_diagnosis_json"),
                        rs.getString("handle_status"),
                        toLdt(rs.getTimestamp("reported_at")),
                        rs.getInt("reopen_seq"),
                        toLdt(rs.getTimestamp("resolved_at")),
                        toLdt(rs.getTimestamp("first_seen_at")),
                        toLdt(rs.getTimestamp("confirmed_at")),
                        toLdt(rs.getTimestamp("created_at")),
                        toLdt(rs.getTimestamp("updated_at"))),
                id);
        return list.isEmpty() ? null : list.get(0);
    }

    /** 锚表行（V4 详情页用），按 id 升序。 */
    public List<AnchorRow> findAnchors(long detailId) {
        return jdbcTemplate.query("""
                SELECT side, ds_code, record_key FROM recon_detail_source_ref
                 WHERE detail_id = ? ORDER BY id
                """, (rs, i) -> new AnchorRow(
                        rs.getString("side"),
                        rs.getString("ds_code"),
                        rs.getString("record_key")),
                detailId);
    }

    /** 写状态历史（V4，引擎埋点 + 人工操作）。fromValue 为 null 表示新建。 */
    public void insertStatusHistory(long detailId, String field, String fromValue, String toValue,
                                    String reason, String operator) {
        jdbcTemplate.update("""
                INSERT INTO recon_diff_status_history
                  (detail_id, field, from_value, to_value, reason, operator, created_at)
                VALUES (?, ?, ?, ?, ?, ?, now())
                """, detailId, field, fromValue, toValue, reason, operator);
    }

    /** 状态历史（V4 详情页时间线用），按 id 升序（即时间顺序）。 */
    public List<StatusHistoryRow> findStatusHistory(long detailId) {
        return jdbcTemplate.query("""
                SELECT id, detail_id, field, from_value, to_value, reason, operator, created_at
                  FROM recon_diff_status_history WHERE detail_id = ? ORDER BY id
                """, (rs, i) -> new StatusHistoryRow(
                        rs.getLong("id"),
                        rs.getLong("detail_id"),
                        rs.getString("field"),
                        rs.getString("from_value"),
                        rs.getString("to_value"),
                        rs.getString("reason"),
                        rs.getString("operator"),
                        toLdt(rs.getTimestamp("created_at"))),
                detailId);
    }

    /** 人工处理历史（V4 详情页时间线用），按 id 升序。 */
    public List<HandleHistoryRow> findHandleHistory(long detailId) {
        return jdbcTemplate.query("""
                SELECT id, detail_id, handle_status, operator, remark, handled_at
                  FROM recon_diff_handle WHERE detail_id = ? ORDER BY id
                """, (rs, i) -> new HandleHistoryRow(
                        rs.getLong("id"),
                        rs.getLong("detail_id"),
                        rs.getString("handle_status"),
                        rs.getString("operator"),
                        rs.getString("remark"),
                        toLdt(rs.getTimestamp("handled_at"))),
                detailId);
    }

    /** 新建 confirmed 时回填 confirmed_at（handleMismatch/handleUnmatched/handleAnomaly 路径）。 */
    public void touchConfirmedAt(long detailId) {
        jdbcTemplate.update("""
                UPDATE recon_detail SET confirmed_at = now(), updated_at = now()
                 WHERE id = ? AND confirmed_at IS NULL
                """, detailId);
    }

    private static java.time.LocalDateTime toLdt(java.sql.Timestamp t) {
        return t == null ? null : t.toLocalDateTime();
    }

    /** 差异身份当前状态（两轮确认/流转判定用）；不存在 → null */
    public IdentityState findIdentity(String scenarioCode, String checkName, String pairSegment, String matchKeyHash) {
        var list = jdbcTemplate.query("""
                SELECT id, diff_type, status, pending_peer_pull_run_id, pending_peer_ds_code,
                       pending_at, reopen_seq
                  FROM recon_detail
                 WHERE scenario_code = ? AND check_name = ? AND pair_segment = ? AND match_key_hash = ?
                """, (rs, i) -> {
                    java.sql.Timestamp t = rs.getTimestamp("pending_at");
                    return new IdentityState(
                            rs.getLong("id"), rs.getString("diff_type"), rs.getString("status"),
                            rs.getLong("pending_peer_pull_run_id"), rs.getString("pending_peer_ds_code"),
                            t == null ? null : t.toLocalDateTime(), rs.getInt("reopen_seq"));
                }, scenarioCode, checkName, pairSegment, matchKeyHash);
        return list.isEmpty() ? null : list.get(0);
    }

    /** 两轮确认巡检行（status=pending 且 peer 身份完整） */
    public static class PendingRow {
        public final long id;
        public final String scenarioCode;
        public final String checkName;
        public final String pendingPeerDsCode;
        public final Long pendingPeerPullRunId;
        public final java.time.LocalDateTime pendingAt;

        public PendingRow(long id, String scenarioCode, String checkName, String pendingPeerDsCode,
                          Long pendingPeerPullRunId, java.time.LocalDateTime pendingAt) {
            this.id = id;
            this.scenarioCode = scenarioCode;
            this.checkName = checkName;
            this.pendingPeerDsCode = pendingPeerDsCode;
            this.pendingPeerPullRunId = pendingPeerPullRunId;
            this.pendingAt = pendingAt;
        }
    }

    /** 差异身份状态 */
    public static class IdentityState {
        public final Long id;
        public final String diffType;
        public final String status;
        public final Long pendingPeerPullRunId;
        public final String pendingPeerDsCode;
        public final java.time.LocalDateTime pendingAt;
        public final Integer reopenSeq;

        public IdentityState(Long id, String diffType, String status, Long pendingPeerPullRunId,
                             String pendingPeerDsCode, java.time.LocalDateTime pendingAt, Integer reopenSeq) {
            this.id = id;
            this.diffType = diffType;
            this.status = status;
            this.pendingPeerPullRunId = pendingPeerPullRunId;
            this.pendingPeerDsCode = pendingPeerDsCode;
            this.pendingAt = pendingAt;
            this.reopenSeq = reopenSeq;
        }
    }

    /** 详情全字段（V4 详情页用） */
    public static class DetailRow {
        public final long id;
        public final String scenarioCode;
        public final String checkName;
        public final String pairSegment;
        public final String matchKeyHash;
        public final String matchKeyDisplay;
        public final String diffType;
        public final String status;
        public final java.time.LocalDateTime deferUntil;
        public final Long pendingPeerPullRunId;
        public final String pendingPeerDsCode;
        public final java.time.LocalDateTime pendingAt;
        public final String leftDataJson;
        public final String rightDataJson;
        public final String diffDesc;
        public final long diffAmountCent;
        public final long diffPoint;   // 非货币计量（积分）差额原值（V5）
        public final String diffDiagnosisJson;
        public final String handleStatus;
        public final java.time.LocalDateTime reportedAt;
        public final int reopenSeq;
        public final java.time.LocalDateTime resolvedAt;
        public final java.time.LocalDateTime firstSeenAt;
        public final java.time.LocalDateTime confirmedAt;
        public final java.time.LocalDateTime createdAt;
        public final java.time.LocalDateTime updatedAt;

        public DetailRow(long id, String scenarioCode, String checkName, String pairSegment,
                         String matchKeyHash, String matchKeyDisplay, String diffType, String status,
                         java.time.LocalDateTime deferUntil, Long pendingPeerPullRunId, String pendingPeerDsCode,
                         java.time.LocalDateTime pendingAt, String leftDataJson, String rightDataJson,
                         String diffDesc, long diffAmountCent, long diffPoint, String diffDiagnosisJson, String handleStatus,
                         java.time.LocalDateTime reportedAt, int reopenSeq, java.time.LocalDateTime resolvedAt,
                         java.time.LocalDateTime firstSeenAt, java.time.LocalDateTime confirmedAt,
                         java.time.LocalDateTime createdAt, java.time.LocalDateTime updatedAt) {
            this.id = id;
            this.scenarioCode = scenarioCode;
            this.checkName = checkName;
            this.pairSegment = pairSegment;
            this.matchKeyHash = matchKeyHash;
            this.matchKeyDisplay = matchKeyDisplay;
            this.diffType = diffType;
            this.status = status;
            this.deferUntil = deferUntil;
            this.pendingPeerPullRunId = pendingPeerPullRunId;
            this.pendingPeerDsCode = pendingPeerDsCode;
            this.pendingAt = pendingAt;
            this.leftDataJson = leftDataJson;
            this.rightDataJson = rightDataJson;
            this.diffDesc = diffDesc;
            this.diffAmountCent = diffAmountCent;
            this.diffPoint = diffPoint;
            this.diffDiagnosisJson = diffDiagnosisJson;
            this.handleStatus = handleStatus;
            this.reportedAt = reportedAt;
            this.reopenSeq = reopenSeq;
            this.resolvedAt = resolvedAt;
            this.firstSeenAt = firstSeenAt;
            this.confirmedAt = confirmedAt;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
        }
    }

    /** 状态历史行（V4 时间线用） */
    public static class StatusHistoryRow {
        public final long id;
        public final long detailId;
        public final String field;        // status / handle_status
        public final String fromValue;
        public final String toValue;
        public final String reason;
        public final String operator;
        public final java.time.LocalDateTime createdAt;

        public StatusHistoryRow(long id, long detailId, String field, String fromValue, String toValue,
                                String reason, String operator, java.time.LocalDateTime createdAt) {
            this.id = id;
            this.detailId = detailId;
            this.field = field;
            this.fromValue = fromValue;
            this.toValue = toValue;
            this.reason = reason;
            this.operator = operator;
            this.createdAt = createdAt;
        }
    }

    /** 人工处理历史行（V4 时间线用） */
    public static class HandleHistoryRow {
        public final long id;
        public final long detailId;
        public final String handleStatus;
        public final String operator;
        public final String remark;
        public final java.time.LocalDateTime handledAt;

        public HandleHistoryRow(long id, long detailId, String handleStatus, String operator,
                                String remark, java.time.LocalDateTime handledAt) {
            this.id = id;
            this.detailId = detailId;
            this.handleStatus = handleStatus;
            this.operator = operator;
            this.remark = remark;
            this.handledAt = handledAt;
        }
    }
}
