# WrenAI 样本问题树 + Doris SQL 全集（按 Skill 分组）v2.0

> **v2.0 变更**：每个 Skill 的树形下方新增「问题×SQL」对照表（Doris 2.x 语法），每行 = 编号 | 问题 | SQL | 验证勾选。
> **使用方式**：SQL 中的 `${占位符}` 替换为真实值后可直接在 Doris 执行；⚠️ 注释处 = 上线前必须与数据组确认的假设（枚举值/字段名/口径）。
> **你会测出两类问题**：①SQL 语法/逻辑错误（我的责任，反馈给我改）；②⚠️假设与实际不符（数据口径问题，按《02_语义规则》第5节闭环后全局替换）。

## SQL 编写约定（测试前必读）

| 占位符 | 含义 | 建议自测取值 |
|--------|------|--------------|
| `${昨天}` `${前天}` | 统计日期 | 取库中最新有数据的日期（数据T+1，勿用当天） |
| `${近7天起}` `${本月1日}` `${上月1日}` `${上月末}` | 区间边界 | 格式与 stats_date 列保持一致（⚠️格式'yyyy-MM-dd'还是'yyyyMMdd'待验证，全局统一） |
| `${门店}` `${品牌}` `${oneid}` `${导购}` ${地点} | 业务实体 | 用真实名称/ID；品牌名先在 dim_chl_brand_df 查准 |
| `${是}` | 是否类标记值 | ⚠️ '1'/'0' 还是 '是'/'否' 待验证 |
| `${year}` `${month}` `${quarter}` | stats_period 枚举 | ⚠️ 假设英文小写，待 distinct 验证 |
| `${本期}` | stats_time 当前期值 | ⚠️ 枚举待验证 |

**Doris 语法要点**：LIMIT n（无 TOP）、IF(cond,a,b)、CURDATE()/DATE_SUB、子查询需别名。所有"人数/率"优先用预计算列，表内无预计算列时按比例加权（AVG 简单平均处已标 ⚠️）。

---

## Skill 1：经营日报

```
S1 经营日报
├─ S1-A 总盘（A1-A4）
├─ S1-B 结构下钻（B1-B7）
├─ S1-C 时段（C1-C2）
├─ S1-D 坪效对标（D1-D4）
└─ S1-E 环比与趋势（E1-E2）★v1.1新增
```

| 编号 | 问题 | SQL（Doris） | 验证 |
|------|------|--------------|:---:|
| S1-A1 | 昨天百货销售额是多少？ | `SELECT SUM(sale_amt) AS 销售额, SUM(sale_cnt) AS 销售笔数 FROM ads_trd_mall_sale_d_df WHERE stats_date = '${昨天}'` | ☐ |
| S1-A2 | 本月累计销售额、同比去年如何？ | `SELECT SUM(IF(stats_date >= '${本月1日}', sale_amt, 0)) AS 本月累计, SUM(IF(stats_date BETWEEN '${去年本月1日}' AND '${去年昨日}', sale_amt, 0)) AS 去年同期 FROM ads_trd_mall_sale_d_df WHERE stats_date BETWEEN '${去年本月1日}' AND '${昨天}'` | ☐ |
| S1-A3 | 上周销售去券去税金额 | `SELECT SUM(sale_uncpn_taxout_amt) AS 去券去税金额 FROM ads_trd_mall_sale_d_df WHERE stats_date BETWEEN '${上周一}' AND '${昨天}'` | ☐ |
| S1-A4 | 今年国庆档各天销售额 | `SELECT stats_date, SUM(sale_amt) AS 销售额 FROM ads_trd_mall_sale_d_df WHERE stats_date LIKE '${今年}%'` ⚠️`AND hol_name = '国庆节'（hol_name 实际取值待验证）` `GROUP BY stats_date ORDER BY stats_date` | ☐ |
| S1-B1 | 昨天各门店销售金额排名 | `SELECT store_name, SUM(sale_amt) AS 销售额 FROM ads_trd_mall_sale_d_df WHERE stats_date = '${昨天}' GROUP BY store_name ORDER BY 销售额 DESC LIMIT 10` | ☐ |
| S1-B2 | 上周三楼各厅房销售额 | `SELECT hall_name, SUM(sale_amt) AS 销售额 FROM ads_trd_mall_sale_d_df WHERE stats_date BETWEEN '${近7天起}' AND '${昨天}' AND floor_name = '3F'` ⚠️（楼层取值格式待验证） `GROUP BY hall_name ORDER BY 销售额 DESC` | ☐ |
| S1-B3 | 本月联营模式销售占比 | `SELECT SUM(IF(operate_mode = '联营', sale_amt, 0)) / SUM(sale_amt) AS 联营占比 FROM ads_trd_mall_sale_d_df WHERE stats_date BETWEEN '${本月1日}' AND '${昨天}'` | ☐ |
| S1-B4 | 昨天折扣率最高的五个品牌 | `SELECT brand_name, SUM(sale_discount_amt) / SUM(sale_amt) AS 加权折扣率 FROM ads_trd_mall_sale_d_df WHERE stats_date = '${昨天}' GROUP BY brand_name ORDER BY 加权折扣率 DESC LIMIT 5` ⚠️（行级折扣率不可直接平均，用金额加权） | ☐ |
| S1-B5 | 上个月各大类销售毛利和毛利率 | `SELECT main_category_name, SUM(sale_gross_profit) AS 毛利, SUM(sale_gross_profit) / SUM(sale_amt) AS 毛利率 FROM ads_trd_mall_sale_d_df WHERE stats_date BETWEEN '${上月1日}' AND '${上月末}' GROUP BY main_category_name ORDER BY 毛利 DESC` | ☐ |
| S1-B6 | 昨天各商户销售排名 | `SELECT business_name, SUM(sale_amt) AS 销售额 FROM ads_trd_mall_sale_d_df WHERE stats_date = '${昨天}' GROUP BY business_name ORDER BY 销售额 DESC LIMIT 10` ⚠️（business_name 商户 ≠ supplier_name 供货商） | ☐ |
| S1-B7 | 上月销售额超过100万的品牌有几个？ | `SELECT COUNT(*) AS 品牌数 FROM (SELECT brand_id FROM ads_trd_mall_sale_d_df WHERE stats_date BETWEEN '${上月1日}' AND '${上月末}' GROUP BY brand_id HAVING SUM(sale_amt) > 1000000) t` | ☐ |
| S1-C1 | 昨天14点到16点哪个厅房销售最高？ | `SELECT chl_name, SUM(sale_cnt) AS 件数 FROM ads_mall_trd_hall_sale_h_last_year_df WHERE stats_date = '${去年昨天}' AND stats_time_period_math BETWEEN 14 AND 16 GROUP BY chl_name ORDER BY 件数 DESC LIMIT 5` ⚠️①本表是去年同期口径，问"当期时段"ADS无表覆盖；②chl（渠道）是否即厅房待确认 | ☐ |
| S1-C2 | 周末和工作日的笔单价对比 | `SELECT date_type, ROUND(AVG(avg_ord_price), 2) AS 平均笔单价 FROM ads_mall_trd_hall_sale_h_last_year_df GROUP BY date_type` ⚠️（简单平均，仅作样本；date_type 取值：周末/节假日/平时） | ☐ |
| S1-D1 | 各门店女装品类坪效排名 | `SELECT store_name, sales_per_square_meter AS 销售坪效 FROM ads_csmr_store_brand_whole_sale_df WHERE stats_period = '${year}' AND mid_category_name = '女装' ORDER BY 销售坪效 DESC LIMIT 10` | ☐ |
| S1-D2 | 某品牌在本店的销售毛利率和回款率 | `SELECT brand_name, ord_sale_margin_rate AS 毛利率, ord_cod_rate AS 回款率 FROM ads_csmr_store_brand_whole_sale_df WHERE brand_name = '${品牌}' AND stats_period = '${year}'` | ☐ |
| S1-D3 | 某品牌在品类里的销售和营收排名 | `SELECT brand_name, mid_category_sale_amt_rank AS 品类销售排名, mid_category_sale_revenue_rank AS 品类营收排名, brand_sale_amt_rank AS 品牌销售排名 FROM ads_csmr_store_brand_whole_sale_df WHERE brand_name = '${品牌}' AND stats_period = '${year}'` | ☐ |
| S1-D4 | 哪些品牌消费品牌数同比在下降？ | `SELECT brand_name, brand_csmpt_cnt AS 本期消费品牌数, brand_csmpt_cnt_yoy AS 同比 FROM ads_csmr_store_brand_whole_sale_df WHERE stats_period = '${year}' AND brand_csmpt_cnt_yoy < 0 ORDER BY brand_csmpt_cnt_yoy` | ☐ |
| S1-E1 | 昨天销售环比前日是涨是跌？ | `SELECT SUM(IF(stats_date = '${昨天}', sale_amt, 0)) AS 昨日, SUM(IF(stats_date = '${前天}', sale_amt, 0)) AS 前日, SUM(IF(stats_date = '${昨天}', sale_amt, 0)) / SUM(IF(stats_date = '${前天}', sale_amt, 0)) - 1 AS 环比 FROM ads_trd_mall_sale_d_df WHERE stats_date IN ('${昨天}', '${前天}')` ⚠️（mall日表无 _mom 列，用两日条件聚合；若分母为0会除零，测试时关注） | ☐ |
| S1-E2 | 今年哪个月销售额最高？ | `SELECT DATE_FORMAT(stats_date, '%Y-%m') AS 月份, SUM(sale_amt) AS 销售额 FROM ads_trd_mall_sale_d_df WHERE stats_date LIKE '${今年}%' GROUP BY 月份 ORDER BY 销售额 DESC LIMIT 1` | ☐ |

## Skill 2：会员经营

```
S2 会员经营
├─ S2-A 规模与贡献（A1-A3）
├─ S2-B 质量（B1-B3）
├─ S2-C 个体/清单（C1-C3）
├─ S2-D 会员×品牌（D1-D2）
└─ S2-E 环比与高端结构（E1-E2）★v1.1新增
```

| 编号 | 问题 | SQL（Doris） | 验证 |
|------|------|--------------|:---:|
| S2-A1 | 上月会员销售额和会员贡献率 | `SELECT mbr_new_old, SUM(mbr_cnt) AS 会员人数, SUM(sale_amt) AS 销售额, SUM(reprch_cnt) AS 复购人数 FROM ads_trd_store_new_old_mbr_sale_df WHERE stats_period = '${month}' AND time_period = '${上月}' GROUP BY mbr_new_old` ⚠️（贡献率 cntrb_rate 的分母口径待确认：会员/门店全销售？确认前样本不取该列） | ☐ |
| S2-A2 | 今年以来各门店会员人数 | `SELECT store_name, SUM(mbr_cnt) AS 会员人数 FROM ads_trd_store_new_old_mbr_sale_df WHERE stats_period = '${year}' AND time_period = '${今年}' GROUP BY store_name ORDER BY 会员人数 DESC` | ☐ |
| S2-A3 | 高端会员人数、金额、贡献率 | `SELECT stats_chl_type, high_mbr_range, SUM(high_mbr_cnt) AS 人数, SUM(high_mbr_amt) AS 销售金额 FROM ads_csmr_store_high_mbr_info_df WHERE stats_period = '${month}' AND time_period = '${上月}' GROUP BY stats_chl_type, high_mbr_range ORDER BY 人数 DESC` ⚠️（贡献率 high_mbr_ctbtn_rate 行级不可平均，待确认口径后加） | ☐ |
| S2-B1 | 上季度会员复购率和客单价 | `SELECT store_name, AVG(reprch_rate) AS 复购率, AVG(avg_mbr_price) AS 客单价 FROM ads_trd_store_new_old_mbr_sale_df WHERE stats_period = '${quarter}' AND time_period = '${上季度}' AND mbr_new_old = '老会员' GROUP BY store_name ORDER BY store_name` ⚠️（reprch_rate 若为多行同店不同维度叠加需改口径，测试时抽查与BI口径一致性） | ☐ |
| S2-B2 | 新老会员销售对比 | `SELECT mbr_new_old, SUM(sale_amt) AS 销售额, SUM(mbr_cnt) AS 人数, AVG(avg_mbr_price) AS 客单价 FROM ads_trd_store_new_old_mbr_sale_df WHERE stats_period = '${month}' AND time_period = '${上月}' GROUP BY mbr_new_old` | ☐ |
| S2-B3 | 会员平均消费天数最长的门店 | `SELECT store_name, AVG(avg_sale_days) AS 平均消费天数 FROM ads_trd_store_new_old_mbr_sale_df WHERE stats_period = '${month}' AND time_period = '${上月}' GROUP BY store_name ORDER BY 平均消费天数 DESC LIMIT 5` | ☐ |
| S2-C1 | XX门店销售排名前20的会员及金额 | `SELECT oneid, sale_amt, sale_rn FROM ads_trd_store_mbr_sale_df WHERE stats_period = '${month}' AND time_period = '${上月}' AND store_name = '${门店}' ORDER BY sale_rn LIMIT 20` ⚠️（展示层需对 oneid 脱敏） | ☐ |
| S2-C2 | 某会员近一年在哪些厅房消费最多 | `SELECT hall_name, SUM(sale_amt) AS 消费金额 FROM ads_trd_mbr_hall_sale_d_df WHERE oneid = '${oneid}' AND statsate >= DATE_SUB('${昨天}', INTERVAL 1 YEAR) GROUP BY hall_name ORDER BY 消费金额 DESC LIMIT 10` ⚠️（日期字段名 statsate 源表疑似拼写，以库中实际列名为准） | ☐ |
| S2-C3 | 某会员的最近一单买了什么 | `SELECT ord_time, item_name, ord_qty, ord_amt FROM ads_trd_mbr_sale_ord_d_df WHERE ord_id = (SELECT ord_id FROM ads_trd_mbr_sale_ord_d_df WHERE oneid = '${oneid}' ORDER BY ord_time DESC LIMIT 1)` | ☐ |
| S2-D1 | 某品牌会员消费人数的品类中位差 | `SELECT brand_name, mbr_cnt AS 会员消费人数, mbr_medn_diff AS 与品类中位数差异 FROM ads_csmr_store_brand_whole_sale_df WHERE brand_name = '${品牌}' AND stats_period = '${year}'` | ☐ |
| S2-D2 | 门店TOP20%会员贡献占比 | `SELECT store_name, mbr_top_pct_20_rate AS TOP20占比 FROM ads_csmr_store_brand_whole_sale_df WHERE stats_period = '${year}' ORDER BY TOP20占比 DESC LIMIT 10` | ☐ |
| S2-E1 | 某会员昨日消费金额环比前日 | `SELECT statsate, sale_amt, sale_amt_mom FROM ads_trd_mbr_hall_sale_d_df WHERE oneid = '${oneid}' AND statsate IN ('${昨天}', '${前天}')` ⚠️（验证 _mom 列是否预计算正确，与 E1 式两日对比抽查一致） | ☐ |
| S2-E2 | 各高端区间的会员贡献率对比 | `SELECT high_mbr_range, SUM(high_mbr_cnt) AS 人数, SUM(high_mbr_amt) AS 金额 FROM ads_csmr_store_high_mbr_info_df WHERE stats_period = '${year}' AND time_period = '${今年}' GROUP BY high_mbr_range ORDER BY 金额 DESC` | ☐ |

## Skill 3：新客与品牌客群

```
S3 品牌与新客
├─ S3-A 新客（A1-A5）
├─ S3-B 消费力分层（B1-B3）
├─ S3-C 频次（C1-C3）
└─ S3-D 画像（D1-D2）
```

| 编号 | 问题 | SQL（Doris） | 验证 |
|------|------|--------------|:---:|
| S3-A1 | 上月各品牌新客人数及同比 | `SELECT brand_name, brand_new_mbr_cnt AS 本期新客, last_y_brand_new_mbr_cnt AS 去年同期, ROUND((brand_new_mbr_cnt - last_y_brand_new_mbr_cnt) / last_y_brand_new_mbr_cnt, 4) AS 同比 FROM ads_trd_brand_new_mbr_sale_df WHERE stats_period = '${month}' AND stats_time = '${上月}' AND store_id = '${门店}' ORDER BY 本期新客 DESC LIMIT 20` ⚠️（分母为0时同比为NULL，属正常） | ☐ |
| S3-A2 | 某品牌新客消费金额和客单价同比 | `SELECT brand_name, brand_new_mbr_amt AS 新客金额, brand_new_mbr_amt_yoy AS 金额同比, brand_new_mbr_avg_price AS 新客客单价, brand_new_mbr_avg_price_yoy AS 客单同比 FROM ads_trd_brand_new_mbr_sale_df WHERE brand_name = '${品牌}' AND stats_period = '${month}' AND stats_time = '${上月}'` | ☐ |
| S3-A3 | 品类新客人数排名 | `SELECT mid_category_name, mid_category_new_mbr_cnt AS 品类新客, mid_category_new_mbr_cnt_yoy AS 同比 FROM ads_trd_brand_new_mbr_sale_df WHERE stats_period = '${month}' AND stats_time = '${上月}' AND store_id = '${门店}' GROUP BY mid_category_name, mid_category_new_mbr_cnt, mid_category_new_mbr_cnt_yoy ORDER BY 品类新客 DESC` ⚠️（行粒度=品牌，品类指标可能重复，测试时与BI核对是否需去重） | ☐ |
| S3-A4 | 各品牌人均消费笔数 | `SELECT brand_name, person_avg_cnt AS 人均笔数, person_avg_cnt_yoy AS 同比 FROM ads_trd_brand_new_mbr_sale_df WHERE stats_period = '${month}' AND stats_time = '${上月}' AND store_id = '${门店}' ORDER BY 人均笔数 DESC LIMIT 20` | ☐ |
| S3-A5 | 某品牌新客人数三年趋势 | `SELECT brand_name, last_2y_brand_new_mbr_cnt AS 前年, last_y_brand_new_mbr_cnt AS 去年, brand_new_mbr_cnt AS 本期 FROM ads_trd_brand_new_mbr_sale_df WHERE brand_name = '${品牌}' AND stats_period = '${year}'` | ☐ |
| S3-B1 | 某品牌消费人数最多的金额段 | `SELECT brand_name, GREATEST(brand_amt_range_person_cnt_1, brand_amt_range_person_cnt_2, brand_amt_range_person_cnt_3, brand_amt_range_person_cnt_4, brand_amt_range_person_cnt_5, brand_amt_range_person_cnt_6, brand_amt_range_person_cnt_7) AS 最多人数, CASE GREATEST(brand_amt_range_person_cnt_1, brand_amt_range_person_cnt_2, brand_amt_range_person_cnt_3, brand_amt_range_person_cnt_4, brand_amt_range_person_cnt_5, brand_amt_range_person_cnt_6, brand_amt_range_person_cnt_7) WHEN brand_amt_range_person_cnt_1 THEN '3000以下' WHEN brand_amt_range_person_cnt_2 THEN '3000-5000' WHEN brand_amt_range_person_cnt_3 THEN '5000-1万' WHEN brand_amt_range_person_cnt_4 THEN '1万-2万' WHEN brand_amt_range_person_cnt_5 THEN '2万-3万' WHEN brand_amt_range_person_cnt_6 THEN '3万-5万' ELSE '5万以上' END AS 金额段 FROM ads_csmr_store_brand_trd_analysis_df WHERE brand_name = '${品牌}' AND stats_period = '${year}'` | ☐ |
| S3-B2 | 5万以上客群占比最高的品牌 | `SELECT brand_name, brand_above_5w_amt_sale_cnt_rate AS 五万以上占比 FROM ads_csmr_store_brand_trd_analysis_df WHERE stats_period = '${year}' ORDER BY 五万以上占比 DESC LIMIT 10` | ☐ |
| S3-B3 | 某品牌 vs 门店各金额段占比对比 | `SELECT brand_name, brand_above_5w_amt_sale_cnt_rate AS 品牌五万以上占比, store_above_5w_amt_sale_cnt_rate AS 门店五万以上占比 FROM ads_csmr_store_brand_trd_analysis_df WHERE brand_name = '${品牌}' AND stats_period = '${year}'` | ☐ |
| S3-C1 | 某品牌复购率三年趋势 | `SELECT brand_name, brand_reprch_rate AS 本期, brand_reprch_rate_last_y AS 去年, brand_reprch_rate_last_2y AS 前年 FROM ads_csmr_store_brand_frq_analysis_df WHERE brand_name = '${品牌}' AND stats_period = '${year}'` | ☐ |
| S3-C2 | 到店8天以上忠诚客群占比高的品牌 | `SELECT brand_name, brand_frq_range_person_cnt_8_rate AS 八天及以上占比 FROM ads_csmr_store_brand_frq_analysis_df WHERE stats_period = '${year}' ORDER BY 八天及以上占比 DESC LIMIT 10` | ☐ |
| S3-C3 | 某品牌只到店1天的一次性客群占比 | `SELECT brand_name, brand_frq_range_person_cnt_1_rate AS 一天占比 FROM ads_csmr_store_brand_frq_analysis_df WHERE brand_name = '${品牌}' AND stats_period = '${year}'` | ☐ |
| S3-D1 | 某品牌客群年龄结构 | `SELECT brand_name, brand_age_range_person_cnt_1_rate AS 25岁以下, brand_age_range_person_cnt_2_rate AS 26_35岁, brand_age_range_person_cnt_3_rate AS 36_45岁, brand_age_range_person_cnt_4_rate AS 46_55岁, brand_age_range_person_cnt_5_rate AS 56_65岁, brand_age_range_person_cnt_6_rate AS 66岁以上 FROM ads_csmr_store_brand_attribute_analysis_df WHERE brand_name = '${品牌}' AND stats_period = '${year}'` | ☐ |
| S3-D2 | 某品牌男女占比 | `SELECT brand_name, brand_female_person_cnt_rate AS 占比 FROM ads_csmr_store_brand_attribute_analysis_df WHERE brand_name = '${品牌}' AND stats_period = '${year}'` ⚠️（源表男性/女性占比列名疑似同为 brand_female_person_cnt_rate，必须先在 DESC 表核对实际列名，否则此题男女会查串） | ☐ |

## Skill 4：品牌关联

```
S4 品牌关联
├─ S4-A 输入关联（A1）
├─ S4-B 输出关联（B1）
├─ S4-C 品牌对关联度（C1-C3）
└─ S4-D 品类关联（D1-D2）
```

| 编号 | 问题 | SQL（Doris） | 验证 |
|------|------|--------------|:---:|
| S4-A1 | 买XX品牌的客人还常买哪些同品类品牌？ | `SELECT brand_name, brand_name_top_1_ctg AS 关联品牌TOP1, brand_ratio_1_ctg AS 关联度1, brand_name_top_2_ctg, brand_ratio_2_ctg, brand_name_top_3_ctg, brand_ratio_3_ctg, brand_name_top_4_ctg, brand_ratio_4_ctg, brand_name_top_5_ctg, brand_ratio_5_ctg FROM ads_csmr_brand_category_input_df WHERE brand_name = '${品牌}' AND store_id = '${门店}' AND stats_period = '${year}' AND stats_time = '${本期}'` ⚠️（TopN宽表，品牌名在列值，禁止 GROUP BY） | ☐ |
| S4-B1 | XX品牌的客人之后流向哪些品牌？ | `SELECT brand_name, brand_name_top_1_store AS 输出品牌TOP1, brand_ratio_1_store AS 输出关联度1, brand_name_top_2_store, brand_ratio_2_store, brand_name_top_3_store, brand_ratio_3_store FROM ads_csmr_brand_category_output_df WHERE brand_name = '${品牌}' AND store_id = '${门店}' AND stats_period = '${year}' AND stats_time = '${本期}'` ⚠️（经营口径输出；流失口径走S5-D） | ☐ |
| S4-C1 | 品牌A与品牌B的关联度 | `SELECT brand_name, brand_name_link AS 关联品牌, ipt_brand_person_cnt AS 输入人数, opt_brand_person_cnt AS 输出人数, ipt_link_ratio AS 输入关联度, opt_link_ratio AS 输出关联度, if_category AS 是否同类 FROM ads_csmr_brand_category_link_df WHERE brand_name = '${品牌A}' AND brand_name_link = '${品牌B}' AND stats_period = '${year}'` | ☐ |
| S4-C2 | 只输出不输入的品牌（近似弱势品牌） | `SELECT brand_name, COUNT(*) AS 关联品牌数 FROM ads_csmr_brand_category_link_df WHERE stats_period = '${year}' AND opt_link_ratio > 0 AND ipt_link_ratio = 0 GROUP BY brand_name ORDER BY 关联品牌数 LIMIT 20` ⚠️（近似口径：单边关联，正式定义需数据组确认） | ☐ |
| S4-C3 | 某品牌同品类范围内关联度最高的品牌 | `SELECT brand_name, brand_name_top_1_ctg AS 同品类关联TOP1, brand_ratio_1_ctg AS 关联度 FROM ads_csmr_brand_category_input_df WHERE brand_name = '${品牌}' AND store_id = '${门店}' AND stats_period = '${year}' AND stats_time = '${本期}'` | ☐ |
| S4-D1 | 女装品类和哪些品类关联购买最多 | `SELECT mid_category_name, mid_category_name_link AS 关联品类, person_cnt_link AS 关联购买人数 FROM ads_csmr_category_link_df WHERE mid_category_name = '女装' AND stats_period = '${year}' ORDER BY 关联购买人数 DESC LIMIT 10` | ☐ |
| S4-D2 | 某品牌关联消费品类Top5 | `SELECT brand_name, category_name_top_1 AS 关联品类TOP1, category_name_top_2, category_name_top_3, category_name_top_4, category_name_top_5 FROM ads_csmr_brand_category_input_df WHERE brand_name = '${品牌}' AND store_id = '${门店}' AND stats_period = '${year}' AND stats_time = '${本期}'` | ☐ |

## Skill 5：会员流失

```
S5 会员流失
├─ S5-A 总览/考核（A1-A3）
├─ S5-B 会员级清单（B1-B2）
├─ S5-C 品牌流失（C1-C3）
├─ S5-D 去向（D1-D2）
└─ S5-E 商城流失（E1-E2）★v1.1新增
```

| 编号 | 问题 | SQL（Doris） | 验证 |
|------|------|--------------|:---:|
| S5-A1 | 最近快照：各门店会员流失人数和流失率 | `SELECT store_name, mbr_card_type_name, drain_period, SUM(drain_cnt) AS 流失人数 FROM ads_csmr_store_drain_analysis_d_df WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM ads_csmr_store_drain_analysis_d_df) GROUP BY store_name, mbr_card_type_name, drain_period ORDER BY 流失人数 DESC` ⚠️（drain_rate 行级不可平均，如需率值需重算=流失人数/基数，基数表待确认） | ☐ |
| S5-A2 | 高端会员各流失周期的人数分布 | `SELECT high_mbr_range, drain_period, SUM(drain_cnt) AS 流失人数 FROM ads_csmr_store_drain_analysis_d_df WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM ads_csmr_store_drain_analysis_d_df) GROUP BY high_mbr_range, drain_period ORDER BY high_mbr_range, drain_period` | ☐ |
| S5-A3 | 本年度考核口径流失人数 | `SELECT store_name, mbr_card_type_name, assess_drain_cnt AS 考核流失人数, avg_consum_period AS 平均消费周期 FROM ads_csmr_store_drain_assess_consum_d_df WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM ads_csmr_store_drain_assess_consum_d_df) AND stats_year = '${今年}' ORDER BY 考核流失人数 DESC` | ☐ |
| S5-B1 | 超过平均消费周期未消费的会员清单 | `SELECT oneid, mbr_card_type_name, last_consum_date, last_consum_days, avg_consum_period_y FROM ads_csmr_store_mbr_drain_df WHERE store_id = '${门店}' AND last_consum_days > avg_consum_period_y ORDER BY last_consum_days DESC LIMIT 50` ⚠️（展示层脱敏；stats_period 若多周期需加过滤条件） | ☐ |
| S5-B2 | 某高端会员最近消费时间和间隔 | `SELECT oneid, high_mbr_range, last_consum_date, last_consum_days, avg_consum_period_y FROM ads_csmr_store_mbr_drain_df WHERE oneid = '${oneid}'` | ☐ |
| S5-C1 | 某品牌流失率三年对比 | `SELECT brand_name, brand_drain_rate AS 本期, brand_drain_rate_1y AS 去年, brand_drain_rate_2y AS 前年 FROM ads_csmr_store_brand_drain_df WHERE brand_name = '${品牌}' AND store_id = '${门店}' AND stats_time = '${本期}'` | ☐ |
| S5-C2 | 某品牌近12个月分层流失人数 | `SELECT brand_name, store_brand_drain_1_month AS m1, store_brand_drain_2_month AS m2, store_brand_drain_3_month AS m3, store_brand_drain_4_month AS m4, store_brand_drain_5_month AS m5, store_brand_drain_6_month AS m6, store_brand_drain_7_month AS m7, store_brand_drain_8_month AS m8, store_brand_drain_9_month AS m9, store_brand_drain_10_month AS m10, store_brand_drain_11_month AS m11, store_brand_drain_12_month AS m12, mbr_brand_drain_more_1_yr AS 一年以上 FROM ads_csmr_store_brand_drain_df WHERE brand_name = '${品牌}' AND store_id = '${门店}' AND stats_time = '${本期}'` | ☐ |
| S5-C3 | 某品牌TOP20%会员流失占比 | `SELECT brand_name, is_top_pct_20_rate AS TOP20流失占比 FROM ads_csmr_store_brand_drain_df WHERE brand_name = '${品牌}' AND store_id = '${门店}' AND stats_time = '${本期}'` | ☐ |
| S5-D1 | 某品牌流失会员去向Top10 | `SELECT brand_name, store_brand_drain_drc_1_name AS 去向1, store_brand_drain_drc_1_cnt AS 人数1, store_brand_drain_drc_2_name, store_brand_drain_drc_2_cnt, store_brand_drain_drc_3_name, store_brand_drain_drc_3_cnt FROM ads_csmr_store_brand_drain_drc_df WHERE brand_name = '${品牌}' AND store_id = '${门店}' AND stats_time = '${本期}'` ⚠️（如需Top10全列出补齐4~10列；验证宽表列值） | ☐ |
| S5-D2 | 某品牌平均休眠周期同比 | `SELECT brand_name, brand_drain_avg AS 本期, brand_drain_avg_yoy AS 同比 FROM ads_csmr_store_brand_drain_df WHERE brand_name = '${品牌}' AND store_id = '${门店}' AND stats_time = '${本期}'` ⚠️（源文件这两个字段的"本期/同比"描述疑似写反，以查询结果合理性判断） | ☐ |
| S5-E1 | 某品牌客群流失到商场外的人数分层 | `SELECT brand_name, store_brand_drain_1_month AS m1, store_brand_drain_2_month AS m2, store_brand_drain_3_month AS m3, store_brand_drain_4_month AS m4, store_brand_drain_5_month AS m5, store_brand_drain_6_month AS m6, store_brand_drain_7_month AS m7, store_brand_drain_8_month AS m8, store_brand_drain_9_month AS m9, store_brand_drain_10_month AS m10, store_brand_drain_11_month AS m11, store_brand_drain_12_month AS m12, mbr_brand_drain_more_1_yr AS 一年以上 FROM ads_csmr_store_drain_df WHERE brand_name = '${品牌}' AND store_id = '${门店}' AND stats_time = '${本期}'` | ☐ |
| S5-E2 | 门店平均休眠周期同比 | `SELECT store_name, store_drain_avg AS 本期, store_drain_avg_yoy AS 同比 FROM ads_csmr_store_drain_df WHERE stats_time = '${本期}' ORDER BY 本期 DESC LIMIT 10` | ☐ |

## Skill 6：客流车流

```
S6 客流车流
├─ S6-A 客流（A1-A4）
└─ S6-B 停车（B1-B4）
```

| 编号 | 问题 | SQL（Doris） | 验证 |
|------|------|--------------|:---:|
| S6-A1 | 昨天某门店分时段进店人数 | `SELECT stats_time_period AS 时段, SUM(entry_people_cnt) AS 进店人数 FROM ads_flow_cst_flow_hour_df WHERE stats_time = '${昨天}' AND store_id = '${门店}' GROUP BY stats_time_period ORDER BY stats_time_period` | ☐ |
| S6-A2 | 哪个地点转化率最高 | `SELECT location_name, transfer_rate AS 转化率 FROM ads_flow_cst_flow_hour_df WHERE stats_time = '${昨天}' AND store_id = '${门店}' ORDER BY 转化率 DESC LIMIT 5` | ☐ |
| S6-A3 | 晚高峰各时段滞留人数 | `SELECT stats_time_period, SUM(strded_people_cnt) AS 滞留人数 FROM ads_flow_cst_flow_hour_df WHERE stats_time = '${昨天}' AND store_id = '${门店}' AND stats_time_period_math BETWEEN 17 AND 20 GROUP BY stats_time_period ORDER BY stats_time_period` ⚠️（时段数字格式待验证） | ☐ |
| S6-A4 | 某地点昨天逐小时进店走势 | `SELECT stats_time_period, entry_people_cnt AS 进店人数 FROM ads_flow_cst_flow_hour_df WHERE stats_time = '${昨天}' AND location_name = '${地点}' ORDER BY stats_time_period_math` | ☐ |
| S6-B1 | 昨天各门店进场车次和周转率 | `SELECT store_name, entry_car_cnt AS 进场车次, parking_turnover_rate AS 周转率 FROM ads_flow_store_parking_d_df WHERE stats_date = '${昨天}' ORDER BY 进场车次 DESC` | ☐ |
| S6-B2 | 各门店平均停车时长和线上缴费占比 | `SELECT store_name, avg_strded_hour_period AS 平均滞留时长, online_pay_cnt_rate AS 线上缴费占比 FROM ads_flow_store_parking_d_df WHERE stats_date = '${昨天}'` | ☐ |
| S6-B3 | 本月停车缴费金额和减免金额 | `SELECT store_name, SUM(parking_pay_amt) AS 缴费金额, SUM(remission_amt) AS 减免金额 FROM ads_flow_store_parking_d_df WHERE stats_date BETWEEN '${本月1日}' AND '${昨天}' GROUP BY store_name` | ☐ |
| S6-B4 | 线上缴费占比最低的门店 | `SELECT store_name, online_pay_cnt_rate AS 线上缴费占比 FROM ads_flow_store_parking_d_df WHERE stats_date = '${昨天}' ORDER BY 线上缴费占比 LIMIT 5` | ☐ |

## Skill 7：私域与投入产出

```
S7 私域与投入产出
├─ S7-A 企微（A1-A4）
├─ S7-B 客群标签（B1-B3）
├─ S7-C 投入产出（C1-C3）
└─ S7-D 全域客群（D1-D2）★v1.1新增
```

| 编号 | 问题 | SQL（Doris） | 验证 |
|------|------|--------------|:---:|
| S7-A1 | 各门店企微客户数和昨日新增 | `SELECT owner_store, SUM(wechat_cst_inc_cnt) AS 昨日新增 FROM ads_csmr_wechat_cst_stats_d_df WHERE stats_date = '${昨天}' GROUP BY owner_store ORDER BY 昨日新增 DESC` ⚠️（wechat_cst_cnt 疑似累计值：若是累计口径，取每门店 stats_date 最大那天的值而非SUM，测试时验证） | ☐ |
| S7-A2 | 导购XX名下会员/潜客企微客户数 | `SELECT owner_guide, is_mbr, is_stealer, SUM(wechat_cst_cnt) AS 客户数 FROM ads_csmr_wechat_cst_stats_d_df WHERE owner_guide = '${导购}' AND stats_date = '${昨天}' GROUP BY owner_guide, is_mbr, is_stealer` ⚠️（累计口径问题同上） | ☐ |
| S7-A3 | 各门店企微客户销售转化率 | `SELECT store_name, cst_inc_cnt_rate AS 转化率 FROM ads_mall_csmr_wechat_cst_stats_df WHERE stats_period = '${month}' AND stats_time = '${上月}' ORDER BY 转化率 DESC` ⚠️（cst_inc_cnt_rate 口径待确认，勿自行用销售/客户数重算） | ☐ |
| S7-A4 | 本月各门店企微客户新增排名 | `SELECT store_name, wechat_cst_inc_cnt AS 本月新增 FROM ads_mall_csmr_wechat_cst_stats_df WHERE stats_period = '${month}' AND stats_time = '${上月}' ORDER BY 本月新增 DESC LIMIT 10` | ☐ |
| S7-B1 | 某会员近一年消费品牌数/品类数/金额分段 | `SELECT oneid, consum_brand_cnt_365d AS 品牌数, consum_category_cnt_365d AS 品类数, consum_amt_365d AS 金额分段, consum_cnt_365d AS 累计次数 FROM ads_csmr_store_csmr_tag_df WHERE oneid = '${oneid}' AND store_id = '${门店}'` | ☐ |
| S7-B2 | 某会员品牌偏好Top3 | `SELECT oneid, consum_top1_brand_365d AS 偏好TOP1, consum_top2_brand_365d AS 偏好TOP2, consum_top3_brand_365d AS 偏好TOP3 FROM ads_csmr_store_csmr_tag_df WHERE oneid = '${oneid}' AND store_id = '${门店}'` | ☐ |
| S7-B3 | 积分返利券到期预警名单 | `SELECT oneid, point_coupon_warning AS 预警值 FROM ads_csmr_store_csmr_tag_df WHERE store_id = '${门店}' AND point_coupon_warning IS NOT NULL ORDER BY 预警值 LIMIT 50` ⚠️（预警值含义=距到期天数绝对值，过滤条件"临期"阈值待业务确认） | ☐ |
| S7-C1 | 上月会员营销总投入及构成 | `SELECT store_id, SUM(coupon_input_amt) AS 券投入, SUM(parking_input_amt) AS 停车投入, SUM(equity_input_amt) AS 权益投入, SUM(point_input_amt) AS 积分投入, SUM(gift_input_amt) AS 礼品投入, SUM(input_total_amt) AS 投入合计 FROM ads_trd_mbr_store_input_d_df WHERE stats_date BETWEEN '${上月1日}' AND '${上月末}' GROUP BY store_id ORDER BY 投入合计 DESC` | ☐ |
| S7-C2 | 投入产出比最差的门店 | `SELECT store_id, AVG(input_output_rate) AS 平均投入产出比 FROM ads_trd_mbr_store_input_d_df WHERE stats_date BETWEEN '${上月1日}' AND '${上月末}' GROUP BY store_id ORDER BY 平均投入产出比 LIMIT 5` ⚠️（行级比率简单平均为近似，正式口径=SUM(input_total)/SUM(ctbtn)，待确认后替换） | ☐ |
| S7-C3 | 某会员的贡献金额和实际贡献价值 | `SELECT mbr_id, SUM(ctbtn_amt) AS 贡献金额, SUM(actual_ctbtn_amt) AS 实际贡献价值 FROM ads_trd_mbr_store_input_d_df WHERE mbr_id = '${会员}' AND stats_date BETWEEN '${近30天起}' AND '${昨天}' GROUP BY mbr_id` | ☐ |
| S7-D1 | 全市至臻金卡会员有多少人 | `SELECT COUNT(*) AS 金卡会员数 FROM ads_csmr_csmr_tag_df WHERE is_gold_card = '${是}'` ⚠️（${是} 的存储值待验证） | ☐ |
| S7-D2 | 会员按来源渠道分布 | `SELECT source_channel AS 来源渠道, COUNT(*) AS 会员数 FROM ads_csmr_csmr_tag_df GROUP BY source_channel ORDER BY 会员数 DESC` | ☐ |

---

## 附1：表×样本覆盖矩阵（84题 / 🌟16）

| 表 | 题数 | 表 | 题数 | 表 | 题数 |
|----|----|----|----|----|----|
| ads_trd_mall_sale_d_df | 10 | ads_csmr_store_mbr_drain_df | 2 | ads_csmr_wechat_cst_stats_d_df | 1 |
| ads_mall_trd_hall_sale_h_last_year_df | 2 | ads_csmr_store_drain_analysis_d_df | 2 | ads_mall_csmr_wechat_cst_stats_df | 2 |
| ads_csmr_store_brand_whole_sale_df | 4 | ads_csmr_store_drain_assess_consum_d_df | 1 | ads_csmr_store_csmr_tag_df | 3 |
| ads_trd_mbr_sale_ord_d_df | 1 | ads_csmr_store_brand_drain_df | 4 | ads_csmr_csmr_tag_df | 2 |
| ads_trd_mbr_hall_sale_d_df | 3 | ads_csmr_store_drain_df | 2 | ads_trd_mbr_store_input_d_df | 3 |
| ads_trd_store_mbr_sale_df | 1 | ads_csmr_store_brand_drain_drc_df | 1 | ads_flow_cst_flow_hour_df | 4 |
| ads_trd_store_new_old_mbr_sale_df | 6 | ads_trd_brand_new_mbr_sale_df | 5 | ads_flow_store_parking_d_df | 4 |
| ads_csmr_store_high_mbr_info_df | 3 | ads_csmr_store_brand_trd/frq/attri | 3+3+2 | 关联4表 | 2+1+2+2 |
| ads_csmr_store_brand_new_mbr_sale_df | 0（与trd版重复，刻意不采） | | | | |

## 附2：九类必测问法（每个 Skill 的验收集必须全部覆盖）

| # | 问法类型 | 覆盖样本 | 主要防的坑 |
|---|----------|----------|-----------|
| 1 | 时间点取值 | S1-A1 等 | 时间默认T-1 |
| 2 | 时间段累计 | S1-A2/A3、S7-C1 | 范围过滤、节假日维度 |
| 3 | 排名TopN | S1-B1、S6-B4 | 排序+limit |
| 4 | 占比/构成 | S1-B3、S3-B 系列 | 分母口径、宽表列组 |
| 5 | 同比/环比/趋势 | S3-A5/C1、S1-E1、S2-E1 | _yoy/_mom/last_year表选择 |
| 6 | 区间过滤+计数 | S1-B7、S1-D4 | HAVING、聚合后过滤 |
| 7 | 对比 | S2-B2、S3-B3、S1-C2 | 分组对比 |
| 8 | 明细下钻 | S2-C2/C3、S6-A4 | 粒度切换 |
| 9 | 宽表列组取值 | S3-B1、S5-D1、S4-A1 | TopN列值理解 |

## 附3：样本维护规则

1. 每题 SQL 在 Doris 跑通、结果人工核对后，把 `☐` 改 `✅`；⚠️ 处假设确认后同步改《02_语义规则》并全局替换占位符取值。
2. 导入 WrenAI 前，将 `☐` 全改 `✅` 的题配 3 种说法变体（口语式/省略式/带错别字）形成训练对。
3. 上线后每周导出 wrenai 未能回答/改写失败的问题 → 补进样本树，版本号+1。
4. 数量基线：Phase 1（S1+S2）训练对 ≥40 条（含变体）；全量上线 7 个 Skill ≥200 条；白名单内任何表 ≥1 条样本。

## 附4：测试反馈收集表（测出问题时填）

| 编号 | 问题现象（报错/结果不符） | 根因分类（SQL逻辑/⚠️假设/表结构） | 处理人 | 状态 |
|------|--------------------------|-----------------------------------|--------|------|
| 示例：S3-D2 | 男女占比查出来一样 | ⚠️假设：源表列名复用 | 待数据组核对 |  open |
