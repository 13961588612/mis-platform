package com.mis.recon.dao;

import com.mis.recon.domain.runtime.BacklogWindow;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.List;

/**
 * 欠账窗口 DAO（T06-spec §5.2）：scanUnresolved（补算消费前查询）+ markResolved（补算成功后标记）。
 * <p>写入侧（insertBacklog）在 ReconRunDao（T05 已落地），本 DAO 只补查/标记。</p>
 */
@Repository
public class BacklogWindowDao {

    private final JdbcTemplate jdbcTemplate;

    public BacklogWindowDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 未 resolved 欠账窗口（补算消费用）；无 → 空列表。 */
    public List<BacklogWindow> scanUnresolved(String scenarioCode, String checkName) {
        return jdbcTemplate.query("""
                SELECT id, scenario_code, check_name, window_start, window_end, resolved_at
                  FROM recon_backlog_window
                 WHERE scenario_code = ? AND check_name = ? AND resolved_at IS NULL
                 ORDER BY window_start
                """, (rs, i) -> new BacklogWindow(
                        rs.getLong("id"),
                        rs.getString("scenario_code"),
                        rs.getString("check_name"),
                        toLdt(rs.getTimestamp("window_start")),
                        toLdt(rs.getTimestamp("window_end")),
                        toLdt(rs.getTimestamp("resolved_at"))),
                scenarioCode, checkName);
    }

    /** 补算成功标记：resolved_at=now()（幂等：已标记不再覆盖）。 */
    public void markResolved(long id) {
        jdbcTemplate.update("""
                UPDATE recon_backlog_window SET resolved_at = now()
                 WHERE id = ? AND resolved_at IS NULL
                """, id);
    }

    private static java.time.LocalDateTime toLdt(Timestamp t) {
        return t == null ? null : t.toLocalDateTime();
    }
}
