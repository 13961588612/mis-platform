WITH spike_days AS (
  SELECT '2026-06-14' AS d UNION ALL SELECT '2026-06-29'
),
cost_agg AS (
  SELECT SUM(CASE WHEN c.shhsje < 0 THEN -c.shhsje ELSE 0 END) AS 纯损耗绝对值,
         SUM(ABS(c.shhsje))                                  AS 损耗绝对值,
         SUM(CASE WHEN c.shhsje < 0 THEN -c.shhsje ELSE 0 END)
           + SUM(CASE WHEN c.shhsje > 0 THEN c.shhsje ELSE 0 END) AS 损耗净额_含冲回,
         SUM(CASE WHEN s.d IS NULL THEN CASE WHEN c.shhsje < 0 THEN -c.shhsje ELSE 0 END
                  ELSE 0 END)                                AS 常态纯损耗绝对值,
         SUM(CASE WHEN s.d IS NULL THEN ABS(c.shhsje) ELSE 0 END) AS 常态损耗绝对值,
         COUNT(DISTINCT s.d)                                 AS 盘点日数
  FROM ads_spm_trd_cost_category_day_df c
    JOIN dim_spm_chl_category_df k ON c.dim_type_id = k.categoryid
    LEFT JOIN spike_days s ON s.d = c.ord_date
    WHERE c.ord_date BETWEEN '2026-06-01' AND '2026-06-30'
      AND c.store_id = '0001'
      AND c.data_type = '小类'
      AND k.goodstype = '1' AND k.deptlevelid = '4'
),
sale_agg AS (
  SELECT SUM(c2.xsje) AS 去券销售额,
         SUM(CASE WHEN s.d IS NULL THEN c2.xsje ELSE 0 END) AS 常态去券销售额
  FROM ads_spm_trd_cpi_category_day_df c2
    JOIN dim_spm_chl_category_df k2 ON c2.dim_type_id = k2.categoryid
    LEFT JOIN spike_days s ON s.d = c2.ord_date
    WHERE c2.ord_date BETWEEN '2026-06-01' AND '2026-06-30'
      AND c2.store_id = '0001'
      AND c2.data_type = '小类'
      AND k2.goodstype = '1' AND k2.deptlevelid = '4'
)
SELECT ROUND(a.纯损耗绝对值     * 100.0 / b.去券销售额, 2)     AS 纯损耗报损率_全期口径,
       ROUND(a.损耗绝对值       * 100.0 / b.去券销售额, 2)     AS 绝对值报损率_全期口径,
       ROUND(a.常态纯损耗绝对值 * 100.0 / b.常态去券销售额, 2) AS 纯损耗报损率_常态口径,
       ROUND(a.常态损耗绝对值   * 100.0 / b.常态去券销售额, 2) AS 绝对值报损率_常态口径,
       a.盘点日数 AS 本期盘点日数
FROM cost_agg a
JOIN sale_agg b ON 1 = 1
