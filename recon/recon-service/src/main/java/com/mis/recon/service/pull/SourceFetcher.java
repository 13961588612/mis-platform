package com.mis.recon.service.pull;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.service.support.DbDialect;
import com.mis.recon.service.support.SqlParamBinder;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 源库键集分页取数执行器（T04-spec §8.2，db 取数通道）。
 * <ul>
 *   <li>首轮：窗口 SQL + LIMIT（:p_start/:p_end 已绑定）</li>
 *   <li>后续：DbDialect.wrapKeyset 二元组键集推进（G3），禁 OFFSET</li>
 * </ul>
 * <p>每批内联 new JdbcTemplate(dataSource)，无状态、廉价（技术适配 §2.4 热路径纪律）。</p>
 */
public class SourceFetcher implements PullFetcher {

    private final DataSource dataSource;
    private final DbDialect dialect;
    private final String fetchSql;
    private final String fetchOneSql;

    public SourceFetcher(DataSource dataSource, DbDialect dialect, String fetchSql) {
        this(dataSource, dialect, fetchSql, null);
    }

    public SourceFetcher(DataSource dataSource, DbDialect dialect, String fetchSql, String fetchOneSql) {
        this.dataSource = dataSource;
        this.dialect = dialect;
        this.fetchSql = fetchSql;
        this.fetchOneSql = fetchOneSql;
    }

    /**
     * 取一批。
     *
     * @param lastTime 上一批尾行 time（null=首轮）
     * @param lastPk   上一批尾行 keyset_pk（null=首轮）
     * @return 批 + 批尾 (time, pk) 供下一轮
     */
    @Override
    public FetchBatch fetchBatch(LocalDateTime start, LocalDateTime end,
                                 LocalDateTime lastTime, String lastPk,
                                 String timeField, String pkField, int batchSize) {
        Map<String, Object> params = new HashMap<>();
        params.put("p_start", Timestamp.valueOf(start));
        params.put("p_end", Timestamp.valueOf(end));
        SqlParamBinder.BoundSql bound = SqlParamBinder.bind(fetchSql, params);
        String finalSql;
        Object[] args;
        if (lastTime == null) {
            finalSql = bound.sql;
            args = bound.args;
        } else {
            finalSql = dialect.wrapKeyset(bound.sql, bound.args, timeField, pkField, batchSize);
            List<Object> all = new ArrayList<>(List.of(bound.args));
            all.add(Timestamp.valueOf(lastTime));
            all.add(Timestamp.valueOf(lastTime));
            all.add(lastPk);
            args = all.toArray();
        }
        JdbcTemplate src = new JdbcTemplate(dataSource);
        // 行数上限用 JDBC setMaxRows 限制（不拼 LIMIT/ROWNUM/FETCH FIRST，全方言兼容）
        src.setMaxRows(batchSize);
        List<Map<String, Object>> rows = src.queryForList(finalSql, args);
        LocalDateTime batchLastTime = lastTime;
        String batchLastPk = lastPk;
        if (!rows.isEmpty()) {
            Map<String, Object> tail = rows.get(rows.size() - 1);
            batchLastTime = toLocalDateTime(tail.get(timeField));
            batchLastPk = String.valueOf(tail.get(pkField));
        }
        return new FetchBatch(rows, batchLastTime, batchLastPk);
    }

    /** 试拉（BR-18）：小窗口取 1 条，不写台账。 */
    @Override
    public List<Map<String, Object>> probe(LocalDateTime start, LocalDateTime end) {
        Map<String, Object> params = new HashMap<>();
        params.put("p_start", Timestamp.valueOf(start));
        params.put("p_end", Timestamp.valueOf(end));
        SqlParamBinder.BoundSql bound = SqlParamBinder.bind(fetchSql, params);
        JdbcTemplate src = new JdbcTemplate(dataSource);
        src.setMaxRows(1);
        return src.queryForList(bound.sql, bound.args);
    }

    /** 单条重拉（G7）：fetch_one_sql + {record_key} → 首行；源不存在返回 null。 */
    @Override
    public Map<String, Object> fetchOne(String recordKey) {
        if (fetchOneSql == null || fetchOneSql.isBlank()) {
            throw new BizException(ErrorCode.FETCH_ONE_SQL_MISSING);
        }
        Map<String, Object> params = new HashMap<>();
        params.put("record_key", recordKey);
        SqlParamBinder.BoundSql bound = SqlParamBinder.bind(fetchOneSql, params);
        JdbcTemplate src = new JdbcTemplate(dataSource);
        List<Map<String, Object>> rows = src.queryForList(bound.sql, bound.args);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private LocalDateTime toLocalDateTime(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof Timestamp ts) {
            return ts.toLocalDateTime();
        }
        if (v instanceof LocalDateTime ldt) {
            return ldt;
        }
        return null;
    }
}
