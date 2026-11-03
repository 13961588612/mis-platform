package com.mis.aireport.datasource.spm.bigdata;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 超市模板报告槽位取数：本服务经 {@code spm-big-data} JDBC <b>直接 SQL</b> 读库，不经 IAM / HTTP CommonInfo。
 *
 * <ul>
 *   <li>{@link #fetchAuthorizedStores} — quser + quser_shop_permission + 门店维表</li>
 *   <li>{@link #fetchBizDates} — {@code ads_spm_trd_cpi_category_day_df}</li>
 *   <li>{@link #fetchOrdWeeks} — {@code ads_spm_trd_cpi_category_week_df}</li>
 *   <li>{@link #fetchOrdMonths} — {@code ads_spm_trd_cpi_category_month_df}</li>
 * </ul>
 */
@Service
public class SpmSlotFetchService {

    private static final Logger log = LoggerFactory.getLogger(SpmSlotFetchService.class);

    private final SpmBigDataProperties properties;
    private final JdbcTemplate jdbc;

    public SpmSlotFetchService(
            SpmBigDataProperties properties,
            @Autowired(required = false)
                    @Qualifier(SpmBigDataDataSourceConfig.JDBC_BEAN)
                    SpmBigDataDataSourceConfig.SpmBigDataJdbcTemplateHolder jdbcHolder) {
        this.properties = properties;
        this.jdbc = jdbcHolder == null ? null : jdbcHolder.getJdbcTemplate();
    }

    /**
     * 超市权限门店 → wire {@code spmStoreId}。
     *
     * @param userId MIS 用户 ID（写入 {@code quser.mis_user_id} 关联）
     */
    public List<SpmSlotOption> fetchAuthorizedStores(Long userId) {
        if (!ready(properties.getAuthorizedStores(), "authorized-stores")) {
            return List.of();
        }
        if (userId == null) {
            log.warn("fetchAuthorizedStores: mis userId 为空");
            return List.of();
        }
        try {
            return jdbc.query(
                    SpmSlotSql.AUTHORIZED_STORES,
                    (rs, i) -> storeOption(
                            rs.getString("store_id"),
                            rs.getString("store_name"),
                            rs.getString("area_id"),
                            rs.getString("areaname")),
                    userId);
        } catch (Exception ex) {
            log.warn("fetchAuthorizedStores SQL failed userId={}: {}", userId, ex.getMessage());
            return List.of();
        }
    }

    /** 在营全量门店（调试/无权限口径时可用；当前 Handler 仍走权限方法）。 */
    public List<SpmSlotOption> fetchAllStores(Long userId) {
        if (!jdbcReady()) {
            return List.of();
        }
        try {
            return jdbc.query(SpmSlotSql.ALL_STORES, (rs, i) -> storeOption(rs.getString("store_id"),
                    rs.getString("store_name"), rs.getString("area_id"), rs.getString("areaname")));
        } catch (Exception ex) {
            log.warn("fetchAllStores SQL failed: {}", ex.getMessage());
            return List.of();
        }
    }

    /** 超市经营日 → wire {@code spmBizDate}；最近 31 天（倒序）。 */
    public List<SpmSlotOption> fetchBizDates(Long userId) {
        if (!ready(properties.getBizDates(), "biz-dates")) {
            return List.of();
        }
        try {
            return jdbc.query(SpmSlotSql.BIZ_DATES, (rs, i) -> {
                String v = rs.getString("ord_date");
                Map<String, Object> extra = new HashMap<>();
                extra.put("grain", "day");
                extra.put("startDate", rs.getString("start_date"));
                extra.put("endDate", rs.getString("end_date"));
                return new SpmSlotOption(v, v, extra);
            });
        } catch (Exception ex) {
            log.warn("fetchBizDates SQL failed: {}", ex.getMessage());
            return List.of();
        }
    }

    /** 超市经营周 → wire {@code spmOrdWeek}；最近 16 周（按 dlweekstart 倒序）。 */
    public List<SpmSlotOption> fetchOrdWeeks(Long userId) {
        if (!ready(properties.getOrdWeeks(), "ord-weeks")) {
            return List.of();
        }
        try {
            return jdbc.query(SpmSlotSql.ORD_WEEKS, (rs, i) -> {
                String v = rs.getString("ord_week");
                String start = rs.getString("start_date");
                String end = rs.getString("end_date");
                String label = v;
                if (StringUtils.hasText(start) && StringUtils.hasText(end)) {
                    label = v + "（" + start + "~" + end + "）";
                }
                Map<String, Object> extra = new HashMap<>();
                extra.put("grain", "week");
                extra.put("startDate", start);
                extra.put("endDate", end);
                return new SpmSlotOption(v, label, extra);
            });
        } catch (Exception ex) {
            log.warn("fetchOrdWeeks SQL failed: {}", ex.getMessage());
            return List.of();
        }
    }

    /** 超市经营月 → wire {@code spmOrdMonth}；最近 12 个月（按 dlmonbegin 倒序）。 */
    public List<SpmSlotOption> fetchOrdMonths(Long userId) {
        if (!ready(properties.getOrdMonths(), "ord-months")) {
            return List.of();
        }
        try {
            return jdbc.query(SpmSlotSql.ORD_MONTHS, (rs, i) -> {
                String v = rs.getString("ord_month");
                Map<String, Object> extra = new HashMap<>();
                extra.put("grain", "month");
                extra.put("startDate", rs.getString("start_date"));
                extra.put("endDate", rs.getString("end_date"));
                return new SpmSlotOption(v, v, extra);
            });
        } catch (Exception ex) {
            log.warn("fetchOrdMonths SQL failed: {}", ex.getMessage());
            return List.of();
        }
    }

    public List<SpmSlotOption> fetchBizDatesDefaultWindow(Long userId) {
        return fetchBizDates(userId);
    }

    public List<SpmSlotOption> fetchOrdWeeksDefaultWindow(Long userId) {
        return fetchOrdWeeks(userId);
    }

    public List<SpmSlotOption> fetchOrdMonthsDefaultWindow(Long userId) {
        return fetchOrdMonths(userId);
    }

    private boolean ready(SpmBigDataProperties.SlotToggle slot, String slotKey) {
        if (!jdbcReady()) {
            log.debug("spm-big-data JDBC 未就绪，槽位 {} 返回空", slotKey);
            return false;
        }
        if (slot == null || !slot.isEnabled()) {
            log.info("槽位 {} 尚未打开（enabled=false），返回空", slotKey);
            return false;
        }
        return true;
    }

    private boolean jdbcReady() {
        return properties.isEnabled() && jdbc != null;
    }

    private static SpmSlotOption storeOption(String storeId, String storeName, String areaId, String areaName) {
        Map<String, Object> extra = new HashMap<>();
        extra.put("storeId", storeId);
        if (StringUtils.hasText(storeName)) {
            extra.put("storeName", storeName);
        }
        if (StringUtils.hasText(areaId)) {
            extra.put("areaId", areaId);
        }
        if (StringUtils.hasText(areaName)) {
            extra.put("areaname", areaName);
        }
        return new SpmSlotOption(
                storeId,
                StringUtils.hasText(storeName) ? storeName : storeId,
                extra);
    }
}
