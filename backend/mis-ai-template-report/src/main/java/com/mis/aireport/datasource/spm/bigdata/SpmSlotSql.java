package com.mis.aireport.datasource.spm.bigdata;

/**
 * 槽位 SQL（超市大数据源直查）。
 *
 * <p>权限门店：{@code quser}（mis_user_id）→ {@code quser_shop_permission}（shop_code）
 * → {@code dim_sprmrkt_chl_store_df}（store_id）。
 */
public final class SpmSlotSql {

    private SpmSlotSql() {
    }

    /**
     * 在营超市门店全量（不含人员权限）。
     * {@code shopstatus}/{@code shoptype} 在维表中为 varchar。
     */
    public static final String ALL_STORES = """
            SELECT CAST(store_id AS CHAR) AS store_id,
                   COALESCE(NULLIF(store_shotr_name, ''), store_name) AS store_name,
                   CAST(aeraid AS CHAR) AS area_id,
                   areaname
              FROM dim_sprmrkt_chl_store_df
             WHERE shopstatus = '0'
               AND shoptype = '11'
               AND (store_name IS NULL OR store_name NOT LIKE '%香烟%')
             ORDER BY store_id
            """;

    /**
     * 当前用户权限门店。
     *
     * <p>参数 {@code ?} = MIS {@code userId}（对应 {@code quser.mis_user_id}）。
     */
    public static final String AUTHORIZED_STORES = """
            SELECT CAST(s.store_id AS CHAR) AS store_id,
                   COALESCE(NULLIF(s.store_shotr_name, ''), s.store_name) AS store_name,
                   CAST(s.aeraid AS CHAR) AS area_id,
                   s.areaname
              FROM quser u
              INNER JOIN quser_shop_permission p ON p.user_id = u.user_id
              INNER JOIN dim_sprmrkt_chl_store_df s ON s.store_id = p.shop_code
             WHERE u.mis_user_id = ?
               AND s.shopstatus = '0'
               AND s.shoptype = '11'
               AND (s.store_name IS NULL OR s.store_name NOT LIKE '%香烟%')
             ORDER BY s.store_id
            """;

    /** 经营日：最近 31 个有数日期（倒序）。 */
    public static final String BIZ_DATES = """
            SELECT CAST(ord_date AS CHAR) AS ord_date,
                   CAST(ord_date AS CHAR) AS start_date,
                   CAST(ord_date AS CHAR) AS end_date
              FROM (
                    SELECT DISTINCT ord_date
                      FROM ads_spm_trd_cpi_category_day_df
                     WHERE data_type = '门店'
                   ) t
             ORDER BY ord_date DESC
             LIMIT 31
            """;

    /** 经营周：最近 16 周（按周起始日倒序，勿按周次字符串排）。 */
    public static final String ORD_WEEKS = """
            SELECT CAST(ord_week AS CHAR) AS ord_week,
                   CAST(dlweekstart AS CHAR) AS start_date,
                   CAST(dlweekend AS CHAR) AS end_date
              FROM (
                    SELECT ord_week,
                           MAX(dlweekstart) AS dlweekstart,
                           MAX(dlweekend) AS dlweekend
                      FROM ads_spm_trd_cpi_category_week_df
                     WHERE data_type = '门店'
                     GROUP BY ord_week
                   ) t
             ORDER BY dlweekstart DESC
             LIMIT 16
            """;

    /** 经营月：最近 12 个月（按月起始日倒序，勿按月度字符串排）。 */
    public static final String ORD_MONTHS = """
            SELECT CAST(ord_month AS CHAR) AS ord_month,
                   CAST(dlmonbegin AS CHAR) AS start_date,
                   CAST(dlmonend AS CHAR) AS end_date
              FROM (
                    SELECT ord_month,
                           MAX(dlmonbegin) AS dlmonbegin,
                           MAX(dlmonend) AS dlmonend
                      FROM ads_spm_trd_cpi_category_month_df
                     WHERE data_type = '门店'
                     GROUP BY ord_month
                   ) t
             ORDER BY dlmonbegin DESC
             LIMIT 12
            """;
}
