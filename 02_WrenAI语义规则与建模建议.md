# 超市（生鲜/快消零售）WrenAI 语义规则与建模建议 v1.0

> 面向 WrenAI 的 Modeling（语义模型）/ Business Terms / Instructions / Question-SQL Pairs 四类配置。
> 配套文档：《01_超市数据分析体系.md》（主题/指标/缺口为准）；表与字段事实以两份数据字典 xlsx 为准。
> 与百货版的差异已在各处标注——超市字典**无 DWD/DIM 层**，明细仅 2 张 ADS 内嵌表，枚举字典大量缺失，待确认项比百货多。

---

## 1. 建模范围（Modeling）

### 1.1 注册表清单（按上线批次 B1→B5，与《03-1 按上线批次样本清单》《05 上线计划》严格同序）

> 批次内顺序 = 上线顺序 = 验收顺序。每批的验证样本见《03-1》对应章节；问数训练对见《03》Skill 分组。

| 批次 | 表 | 理由 |
|------|----|------|
| **B1 维度与销售汇总（6 张）** | | |
| B1 | dim_sprmrkt_chl_store_df | 门店维表（pilot 已有，99 家门店，**2026-10-21 已探查 15 列**）——提供门店/店型/区域/**零售业态 shopform**/类型/状态/开业时间维度；**实测无面积列 → 坪效缺口 P0-1 仍开放**；telephone/email/deliveryaddress 不映射 |
| B1 | dim_spm_chl_category_df | 品类维表（**7 列**：categoryid / categoryname / deptlevelid / goodstype / deptlevelname / goodstypename / parentcategoryid）。🟢 **三红利**：①`deptlevelname`+`goodstypename` → **枚举直接读中文名**（N3/N4 取真值）②`parentcategoryid` → **父链可 join，类目树上卷可审计**（N5/N6 验完整性）③层级枚举清晰：**1柜组/2大类/3中类/4小类**。🔴 **四处约束**：①`goodstype` **仅小类层 `deptlevelid=4` 有意义** ②`goodstype` 注释**未列出 `'4'`** 且注明「u50不用,lookup表定义」→ 权威枚举在 lookup 表，**以 `goodstypename` 为准**（N4 验）③**无标准品号数/销售配额列** → 动销率、品类宽度达成率、品类目标达成率**一律拒答** ④⚠️ **DDL 列注释须交叉验证**：注释与实测曾不一致（10-21 vs 10-23 两次读数不同）→ **注释只当线索，以 N3/N4 实测为准** |
| B1 | dim_sprmrkt_itm_item_df | 商品维表（pilot 已有）——商品属性与明细表 item_id 对齐 |
| B1 | ads_spm_trd_cpi_category_day_df | 销售汇总日表：经营日报主表（全 double，最稳） |
| B1 | ads_spm_trd_cpi_category_week_df | 周报趋势与门店周对标 |
| B1 | ads_spm_trd_cpi_category_month_df | 月报趋势（S1-D2 样本依赖） |
| **B2 商品属性与成本（6 张）** | | |
| B2 | ads_spm_trd_sale_category_{day,week,month}_df | 商品属性七重拆分 + 券/折扣 + 经销/联营/租赁 |
| B2 | ads_spm_trd_cost_category_{day,week,month}_df | 毛利瀑布/损耗/生鲜盈亏/后台费用（毛利主题唯一来源） |
| **B3 经营体检（2 张）** | | |
| B3 | ads_spm_trd_kpi_category_{week,month}_df | 库存/滞销/缺货/周转/订货验收/退货/低毛利/同期预计算（S4 唯一源） |
| **B4 会员域（14 张）** | | |
| B4 | ads_sprmrkt_csmr_store_csmr_tag_df | 会员标签与圈选主表（92 列，粒度=会员×门店） |
| B4 | ads_sprmrkt_csmr_number_{month,quarter,year}_df | 会员规模与同比（RIP 同期列直出） |
| B4 | ads_spm_csmr_rep_num_{week,month}_df | 复购漏斗（人数 vs ≥2 次人数） |
| B4 | ads_spm_csmr_lowfreq_num_month_df | 低频（=1 次）会员人数 |
| B4 | ads_spm_trd_csmr_category_{week,month}_df | 复购会员人数（rep_cust） |
| B4 | ads_spm_csmr_ops_{store,market}_year_df | 会员运营年清单（门店/全域二选一，勿与店型表混用） |
| B4 | ads_sprmrkt_csmr_{group,mall,market}_csmr_tag_df | 集团/百货/超市轻量标签（末批） |
| **B5 明细与跨业态（5 张）** | | |
| B5 | ads_sprmrkt_trd_mbr_ord_detl_df | 唯一会员交易明细：品类下钻/时段/购物篮/供应商 |
| B5 | ads_spm_trd_xsjlhz_onlineitem_df | 线上明细（平台×品类×毛利） |
| B5 | ads_spmrkt_mkt_consume_conver_{month,quarter,year}_df | 超市↔百货跨业态转化 |
| B5 | ads_spm_trd_csmr_category_{week,month}_df | 复购会员人数汇总（随 B4 会员主题一并验收） |
| **B5 可选** | dwd_spm_trd_sale_ord_detl_df | **字典外但 pilot 已有**：全量小票明细——若含非会员则解缺口 P0-3；需数据组先补 DDL |
| ✗ 不挂 | ads_sprmrkt_csmr_mall12_csmr_tag_df | 与 mall_csmr_tag_df 完全重复，治理前不挂 |
| ✗ 不挂 | ads_spm_csmr_ops_level_year_df | 与 ops_store_year_df 仅店型/门店之差，互斥，治理后择一 |
| ✗ 不挂 | ads_spm_csmr_ord_main_cat_freq_df | 表 1 真子集且无频次度量，直接从表 1 派生，不挂 |

### 1.2 表描述全集（可直接粘贴到 WrenAI Table Description）

统一模板：`{中文名}。粒度：{粒度}。维度：{主要维度}。度量：{指标}。注意：{使用约束}。`

#### P1 批次核心表（逐表全描述；其余批次表结构同构，描述可按日表类推）

**dim_sprmrkt_itm_item_df**（商品维表）
> 粒度：商品（item_id 唯一，**全量在册商品档案，无门店维度、无上架/下架状态**）。维度：商品(item_id/item_code/item_name/item_full_name/item_bar_code)、柜组(group_id/group_name)、**三级类目(main_category_id+name / mid_category_id+name / sub_category_id+name)**、商品类型(item_type_id+name)、条码编码类型(item_code_type_id+name)、经营类型(item_runtype+name)、一次性商品标志(item_timesflag+name)、公司商品类型(comgoodstype：0=公司/1=非公司/**2=自采**)、商品等级(goodsgrade)、品牌(brand_id+name)、产地(orignareaid/**producingarea**)、单位(item_unit)、规格(spfcn)。
> 属性度量（**全部 varchar，聚合必须 CAST**）：建议售价(adviceprice)、价格因子(pricerate)、增值税率(saletaxrate)、季节因数(season)、**保质期(retention_days + retention_days_unit)**、储存温度(lowtemp/hightemp ℃)、计重计数(item_size)、订货包装数(item_weight)、外箱长宽高(shelfspecl/w/h cm)、建档时间(indate)。
> 🔴 **2026-10-21 实测 47 列后的四条硬约束**：①**三级类目中文名也在此表**——与品类维表 `dim_spm_chl_category_df`（已灌数 8495 行）互为交叉校验路径（须跑 B1-3-M2 验证两侧 `dim_type_id` 与 `main_category_id` 是否同一套编码）②**本表无在架状态**——「在架商品数/动销率分母/门店商品宽度」一律做不了，保持拒答 ③`shelfspecl/w/h` 是**商品外箱尺寸不是货架/营业面积**，严禁用于算坪效 ④**只有建议售价、没有实际售价** → 价格弹性分析仍做不了（实际售价在 sale/明细侧）。

**ads_spm_trd_cpi_category_day_df**（日销售汇总）
> 粒度：日×**多档堆叠粒度**（data_type ∈ 门店/大类/中类/小类/门店大类/门店中类/门店小类，七档同表堆叠，**查询必须过滤 data_type，否则跨档重复计数**）；dim_type_id/name 含义随 data_type 变（'大类'/'门店大类'→大类编号，其余类推）。维度：日期(ord_date，格式 yyyy-MM-dd)、门店(store_id/name)、店型(shoplevel/name)、区域(aeraid/areaname，疑为 areaid 拼写)、data_type、dim_type。度量：客单数(kds)、客单价(kdj，预计算)、销售数量(qty)、去券销售金额(xsje，**注意本表 xsje=去券口径**)、营业额(turnover_amt)、主营销售收入(main_sale_amt)、线上客单数/客单价/数量/主营销售(xs_kds/xs_kdj/xs_qty/xs_main_sale_amt)、线上销售占比(xs_zb_main_sale_amt，预计算)、前台毛利(qtml/bhsqtml)、综合毛利(zhml/bhszhml)、后台费用(hjhzhsmoney/hjhzbhsmoney)。注意：全部度量为 double，可直接聚合；"销售"默认营业额 turnover_amt，"去券销售"用本表 xsje；金额含税/去税按列后缀配对使用，勿混算。

**ads_spm_trd_sale_category_day_df**（销售类别日汇总）
> 粒度：日×**多档堆叠粒度**（data_type 七档同表堆叠，**查询必须过滤 data_type**）；dim_type_id/name 含义随 data_type 变。维度：同上表（含 data_type、dim_type）。度量：在汇总表基础上增加——会员消费人数(cust_cnt，**string 需 CAST**)、会员销售收入(custsalevalue)、商品属性拆分七组（重点 key_/TOP top_/新品 new_main_sale_amt/出清 clear_main_sale_amt+clear_turnover_amt/促销 promotion_main_sale_amt+promotion_turnover_amt/折扣 all_disc_main_sale_amt/非折扣 no_disc_main_sale_amt）、经营属性拆分三组（经销 venture_/联营 joint_/租赁 rent_main_sale_amt）、供应商进价折扣分担(zkfd_costvalue/_taxout)、折扣金额(discvalue)、促销打折金额(disc_value，**与 discvalue 仅差下划线、含义不同**)、处理打折金额(clear_value)、促销券金额(coupon_amt/take_out_coupon_amt)。注意：⚠️ 本表 xsje=销售金额（**非去券**，与汇总表同名列不同义，引用必须带表名）；cust_cnt 为 string 而 KPI 表同名列为 double，跨表勿直接 join。

**ads_spm_trd_cost_category_day_df**（成本日汇总）
> 粒度：日×**多档堆叠粒度**（data_type 七档同表堆叠，**查询必须过滤 data_type**）；dim_type_id/name 含义随 data_type 变。维度：同上。度量：盈亏数量(常规 nmpkpyqty/生鲜 sxpkpyqty)、损溢含税/不含税(bsbyhsje/bsbybhsje)、常规盈亏(nmpkpyhsje/bhsje)、生鲜盈亏(sxpkpyhsje/bhsje)、损耗(报损报溢盘盈盘亏合计 shhsje/shbhsje)、含税/不含税销售成本(sumhsxscb/sumbhsxscb)、供应商折扣分担(HSSUPZK/BHSSUPZK，全大写列名)、配送加价(pshsaddje/psbhsaddje)、股权供应商调整毛利(tzhsml/tzbhsml)、物流成本(wlxscb/wlbxscb)、倒轧成本(hzhsxscbdg/hzbhsxscbdg)、后台收费(htmoney/hthsmoney)、物流/租赁分摊(wlft*/zlbhs*/zlhs*)、后台费用(hjhzhsmoney/hjhzbhsmoney)、前台毛利(qtml/bhsqtml)及重点/TOP/出清/促销拆分、综合毛利(zhml/bhszhml)及同组拆分。注意：**本表是损耗与生鲜盈亏的唯一来源**；毛利率无预计算列，用 qtml÷营业额（配对表取数）；生鲜只在盈亏/损耗侧有拆分，销售侧无生鲜维度。

**ads_spm_trd_kpi_category_week_df**（周 KPI 汇总）
> 粒度：周×**多档堆叠粒度**（data_type ∈ 门店/大类/中类/小类/门店大类/门店中类/门店小类，七档同表堆叠，**查询必须过滤 data_type，否则跨档重复计数**）；dim_type_id/name 含义随 data_type 变（'大类'/'门店大类'→大类编号，其余类推）。维度：周(ord_week/dlyear/dlweek/dlweekstart/dlweekend，ord_week 已含年份信息)、门店、店型、区域、data_type、dim_type。度量：销售全集（同 sale 表）、毛利全集（同 cost 表）、损耗(shhsje/shbhsje)、低毛利率主营销售(lowml_zyxxsr)、验收金额(ysje)、订货金额(ddje)、不含税退货金额(thbhsje)、分子库存不含税金额(kcbhsje，注释"分字"疑笔误)、分母销售不含税成本(bhsxscb)、缺货 SKU 数(Gdidsl=分子分母缺货 sku 数/hzGdidsl=分母缺货 sku 数，**两者口径关系待确认**)、门店客单数(shop_kds)、滞销库存不含税金额(zx_kcbhsje)、库存不含税金额(hj_kcbhsje)、销售成本(sumhsxscb)、复购会员人数(rep_cust，string)、本期销售(bq_turnover_amt)、同期销售(tq_turnover_amt)、销量影响因素(rate_turnover_amt)。注意：**本表定位 = 周/月度"门店经营体检宽表"（库存/订货/损耗/缺货/周转/同期一体），与 cpi 分工明确**——日报/线上拆分/线上占比走 cpi，毛利瀑布/生鲜盈亏/后台费用走 cost，KPI 不重复承载；周转天数=库存÷销售成本×7、订货偏差=(验收-订货)÷订货、退货率=退货÷销售成本，均为 C 级口径（见 01 文档 §3.5）；**问"同比/同期"直接用 bq_/tq_/rate_ 三列**；天数列 weekdays。

**ads_sprmrkt_trd_mbr_ord_detl_df**（会员订单明细事务事实表）
> 粒度：订单明细×商品行（一行=小票上一个商品）。维度：订单(ord_id/ord_rn/ord_no/cashier_no/orig_ord_id)、会员(mbr_id/mbr_card_id/mbr_card_code/mbr_phone/oneid——**跨表关联只用 oneid**)、商品(item_id/item_code/item_name)、供应商(venderid/vendername)、时间(ord_time/ord_date/complete_time 日结/year_month/quarter/year/week/date_type/holiday_name/time_period)、门店(store_id/name/shoplevel)、柜组(group_id/name)、大/中/小类、品牌(brand_id/name)、商品类型/条码类型/经营类型/一次性商品(item_type*/item_code_type*/item_runtype*/item_timesflag*)、商户(business_id/name)、线上线下(onoffln_mark)、发券会员号(send_coupon_mbr_no)。度量：销售数量(ord_qty)、销售金额(ord_amt)、执行价含税(cost)、合同价含税(contractcost)、积分(point)、折扣金额(discount_amt)、参与积分部分金额(xsje_jf)。标记：是否超市门店新客订单(whet_sprmrkt_new_cst_ord)、是否有效(is_valid)。注意：统计前**必须过滤 is_valid**（取值待确认）；明细级表的人数字段禁止与预聚合表混算；购物篮分析按 ord_no 归篮（仅会员篮）；cost 是执行价（近似成本），与合同价 contractcost 区分；缺 etl_time。

**ads_sprmrkt_csmr_store_csmr_tag_df**（门店消费者标签表）
> 粒度：会员×门店（同一会员 N 店消费=N 行）。属性：oneid/mbr_id/卡/手机号/是否粉丝/企微/会员(is_fans/is_wechat_user/is_mbr)/性别/年龄/留资/注册日期/会员状态/注册门店/会员等级(mbr_card_type_name)/注册业态/生命周期(consume_lifecycle)/生命状态(consume_lifestatus)/可用积分(alw_use_point，string)。消费标签：近 30/90/365 天次数/客单/间隔/金额(consum_cnt/avgamt/interdays_XXd、consum_amt_range_90d 为 string 金额分档**不可 SUM**)、累计与年度(2023/2024)次数金额、首末次消费(门店/全超市/线上/线下/倒数第二次)、高价值流水(consum_valued_loss_360d，命名与 90d/365d 不统一)、同物业百货未消费(consum_bh_loss_cs_90d)、周末/时段偏好、场景偏好五维(consum_kitchen/commodity/festival/leisure/other_90d，疑似占比得分待确认)、券偏好 TOP3、百货交叉(consum_bh_cnt/amt_365d/末次门店日期/偏好四维/品牌 TOP5/中类 TOP5)、超市小类/中类/品牌偏好 TOP5。注意：**去重人数必须先按 store_id 过滤**；含手机号等敏感字段默认不输出；"门店口径"与"全超市口径"列同名并存（consum_last_date 等），按分析场景选对列。

**ads_sprmrkt_csmr_number_month_df**（超市消费会员人数·月）
> 粒度：行式指标表（DATA_TYPE×DATA_DIM×DATA_LABEL×DATE_RANGE 描述一行是什么）。度量：消费会员人数(CSMR_NUMB)、同期消费会员人数(RIP_CSMR_NUMB)——同比=(CAST(CSMR_NUMB AS DOUBLE)-CAST(RIP_CSMR_NUMB AS DOUBLE))/CAST(RIP_CSMR_NUMB AS DOUBLE)。注意：**全字段 string 必须 CAST**；按 DATE_RANGE 取数；与季/年表结构逐列一致，**三表禁止 UNION 后再汇总**（同维度会被重复计数）；DATA_TYPE/DATA_DIM 枚举待确认。

**ads_spmrkt_mkt_consume_conver_month_df**（超市会员超市&百货消费转化·月）
> 粒度：月×百货门店×超市门店（DATA_TYPE×DATA_LABEL×DATE_RANGE 行式）。维度：百货门店(BHMDID/BHMDMC)、超市门店(CSMDID/CSMDMC)、数据范围(DATE_RANGE)。度量：百货总消费人数(BHXFRS)、超市消费人数(CSXFRS)、会员消费转化率(CSXFZHL，预计算)、超市消费笔数(CSXFBS)、超市消费金额(CSXFJE)、超市消费客单(CSXFKD)、人均消费次数(RJXFCS)、人均消费金额(RJXFJE)。注意：全 string 需 CAST；转化率直接用 CSXFZHL 勿自行重算（除非常数校验）；与季/年表互斥取数，禁 UNION；BHMDID×CSMDID 组合规则待确认。

**ads_spm_trd_xsjlhz_onlineitem_df**（线上销售明细）
> 粒度：明细×平台×门店×部门×大中小类。维度：日期(sdate，⚠️ 其余表为 ord_date/ord_week/ord_month)、平台(platform)、门店(store_id/name)、部门(mshop/mshopname)、大/中/小类、小票号(salebillno)。度量：数量(qty)、含税销售金额(truesalevalue)、不含税销售金额(ratesalevalue)、含税成本(costvalue)、不含税成本(ratecostvalue)、含税毛利(hsml)、不含税毛利(bhsml)。注意：唯一的非会员可见明细（线上单不依赖会员），但**无 oneid/会员字段**——不能与人相关的问题联用；毛利率按 hsml÷truesalevalue 现场算。

**ads_spm_csmr_rep_num_month_df**（重复消费会员人数·月）
> 粒度：行式指标表（同 number 表结构）。度量：消费会员人数(CONSUM_CNT)、消费大于 2 次人数(CONSUM_CNT2，**"大于 2 次"是否含 2 次待确认，复购业务定义通常 ≥2**)。注意：全 string 需 CAST；与 lowfreq 表（CONSUM_CNT1=1 次）互补成"1 次/多次"结构，**但两表粒度均为月才可互算**；与周表（rep_num_week）粒度不同，禁跨表相除。

#### P2 表（按系列简描述）

- **sale/cost 二系列 week/month（4 张）**：字段与日表完全同构，仅时间维度列不同（week：ord_week/dlyear/dlweek/起止；month：ord_month/dlyear/dlmonth/起止）。成本周/月表较日表多 `zyxxsr`（主营销售收入）。注意：同一查询选单一时段表，禁日+周混算。（cpi 周/月已提入 P1，见 §1.1）
- **ads_spm_trd_kpi_category_month_df**：字段同周 KPI，唯一差异 weekdays→monthdays。
- **ads_spm_trd_csmr_category_{week,month}_df**：仅 rep_cust（复购会员人数，string）+ 维度列；表注释沿用"销售类别汇总"为误填，实为复购汇总。
- **consume_conver_{quarter,year} / number_{quarter,year}（4 张）**：与对应月表逐列一致，仅时间口径不同；按 DATE_RANGE 择一，禁 UNION。
- **ads_sprmrkt_csmr_{group,mall,market}_csmr_tag_df（3 张）**：粒度=会员（无门店）；属性列同门店标签表前 18 列；group 表含近一年总消费次数/金额+超市/百货各自末次门店日期；mall/market 表分别为百货/超市业态近一年次数金额+末次门店日期。**market 表 consum_cs_* 是全超市口径，与门店标签表"本门店口径"不可互换**。
- **ads_spm_csmr_ops_{store,market}_year_df（2 张）**：粒度=会员×门店 / 会员（全域）；度量=近一年(consum_cnt/amt_365d)与前一年(consum_cnt/amt_730d，**字段名 730d=近两年 与注释"前一年"矛盾，待确认**)次数金额+首末次消费+运营归属(member_ops，取值待确认)。全指标 string 需 CAST；两表联合可算"会员在本店消费占其全超市份额"。
- **ads_spm_csmr_lowfreq_num_month_df**：行式；CONSUM_CNT（总人数）/CONSUM_CNT1（=1 次）。

### 1.3 关系（Relationships，建议最小集）

| 主表 | 从表 | 关联键 | 说明【待验证：以实际控制台为准】 |
|------|------|--------|------|
| ads_sprmrkt_trd_mbr_ord_detl_df | ads_sprmrkt_csmr_store_csmr_tag_df | oneid | 明细↔标签（会员分析主链路） |
| ads_sprmrkt_csmr_store_csmr_tag_df | ads_spm_csmr_ops_market_year_df | oneid | 标签↔全域运营（份额计算） |
| ads_spmrkt_mkt_consume_conver_month_df | （无） | BHMDID/CSMDID | 无维表，门店名已冗余在表内 |

> 注意：超市字典无 DIM 层，门店/品类名称已冗余在各 ADS 内，**首批不建门店/品类关系**；consume_conver 的百货门店与超市门店编码体系不同（BHMDID vs CSMDID），**不可互相关联**。

### 1.4 列级规则（Column Description / Calibrated）

| 规则 | 示例 |
|------|------|
| string 指标列标注"必须 CAST" | `CSMR_NUMB：消费会员人数（string，聚合/排序/同比前必须 CAST 为数值）` |
| 双义列名标注表级口径 | `xsje：去券销售金额（仅 cpi 汇总表为此口径；sale_category 表同名列为"销售金额"，引用必须带表名）` |
| 易混列对标注差异 | `discvalue：折扣金额（全折扣口径）；disc_value：促销打折金额（仅促销口径）——两者不可互换` |
| 预计算列标注"勿重算" | `kdj：客单价（预计算=营业额/客单数，勿自行重算）；CSXFZHL：会员消费转化率（预计算）；xs_zb_main_sale_amt：线上销售占比（预计算）；rate_turnover_amt：销量影响因素（预计算同期比）` |
| 明细表强制过滤条件 | `is_valid：是否有效（取值待确认；所有统计默认 WHERE is_valid=有效值）` |
| 枚举列描述中列取值 | `date_type：日期类别（工作日/周末/节假日？取值待确认）；time_period：时段（取值粒度待确认）；onoffln_mark：线上线下标记（取值待确认）` |
| 粒度自描述 | `门店消费者标签表：一行=会员×门店，同会员多店多行，人数统计必须先按 store_id 过滤` |
| 金额单位标注 | 所有 amt/je/value 字段描述尾缀`单位：元` |
| 口径矛盾显性标注 | `consum_cnt_730d：前一年超市累计消费次数（字段名 730d 与注释"前一年"矛盾，使用前先确认）` |
| data_type 必标注七档与过滤要求 | `data_type：粒度档（门店/大类/中类/小类/门店大类/门店中类/门店小类），查询必过滤，默认 '门店'；不带过滤聚合会跨档重复计数` |

### 1.5 维度枚举字典（超市，级别标注）

| 维度 | 枚举值/定义 | 级别 | 用法 |
|------|------------|------|------|
| 日期类别 date_type | 工作日/周末/节假日（推断） | C 待确认 | 订单明细、日历效应分析 |
| 时段 time_period | 取值粒度未知（小时段/市别？） | C 待确认 | 早晚市/峰谷分析 |
| 周几 week | 周一~周日（推断） | C 待确认 | 周内曲线 |
| 节假日 holiday_name | 假期名称 | A（字段在，取值待确认） | 档期分析 |
| 线上线下 onoffln_mark | 线上/线下（推断） | C 待确认 | 渠道拆分（汇总表用 xs_* 列组等价） |
| 平台 platform | 第三方平台名称（取值待确认） | C | 线上明细 |
| 店型 shoplevel/shoplevelname | 门店级别 id/名称（订单明细备注：与店型上卷口径一致） | A- | 门店对标 |
| 区域 aeraid/areaname | 区域编码/名称（疑 areaid 拼写） | A- | 区域汇总 |
| 商品属性拆分（列组非枚举） | 重点 key_* / TOP top_* / 新品 new_* / 出清 clear_* / 促销 promotion_* / 折扣 all_disc_* / 非折扣 no_disc_* | A | 生命周期与促销分析 |
| 经营属性拆分（列组） | 经销 venture_* / 联营 joint_* / 租赁 rent_* | A | 经营模式结构 |
| 生鲜/常规（列组） | 生鲜 sxpkpy* / 常规 nmpkpy* | A（仅成本侧） | 生鲜盈亏（销售侧无对应拆分=缺口） |
| 行式指标表元数据 | DATA_TYPE 数据类型 / DATA_DIM 数据维度 / DATA_LABEL 数据标识 / DATE_RANGE 数据范围 | C 全部待确认 | 取数前必须先 distinct 探明 |
| 门店维表枚举（待 distinct） | shopstatus 门店状态 / shoptype 门店类型 / **shopform 零售业态** / shoplevel 门店级别 / openingtime 开业时间（格式待确认） | C 待确认 | 业态是超市对标核心维度；状态用于过滤在营店；开业时间用于成熟度分析 |
| **汇总表粒度档 data_type** | **门店 / 大类 / 中类 / 小类 / 门店大类 / 门店中类 / 门店小类**（用户 2026-10-20 确认，A 级） | A | **查询必过滤**；dim_type_id 含义随档变：'大类'/'门店大类'→大类编号，'中类'/'门店中类'→中类编号，其余类推 |
| ⚠️ 同名不同义 | 汇总表 `data_type`（粒度档，小写）≠ 行式表 `DATA_TYPE`（元数据列，大写） | A | 写列描述/Instructions 时不可混 |
| 会员等级 mbr_card_type_name | 等级名称 | A-（枚举待确认） | 分层 |
| 生命周期 consume_lifecycle / 状态 consume_lifestatus | 分群定义 | C 待确认 | 生命周期分析 |
| 会员运营归属 member_ops | 归属规则 | C 待确认 | 运营分派 |
| 会员新客标记 whet_sprmrkt_new_cst_ord | 是/否（Y/N 还是 1/0 待确认） | C | 拉新分析 |
| 场景偏好 consum_{kitchen,commodity,festival,leisure,other}_90d | 疑似占比/得分 | C 待确认 | 偏好画像 |
| 同期 RIP_* | 去年同期值（物化） | A | 同比直算 |

**仍待确认（字典未覆盖）**：~~ds 分区格式~~（正式环境将剔除 ds 字段，2026-10-20 用户告知）、各表数据延迟（T+?）、所有"待确认"枚举的实际存储值、消费转化表 DATA_TYPE/DATA_LABEL 全量枚举。

---

## 2. 业务术语（Business Terms）

> 每条 = 术语 + 默认解释 + 指向表/列。问数时展开注入。

| 术语 | 标准解释（问数时展开注入） | 主表.列 |
|------|---------------------------|---------|
| 营业额/流水 | 默认=营业额 turnover_amt（含税含券前）；问"去券销售"→ cpi 表 xsje | cpi_category_day.turnover_amt |
| 销售金额 | ⚠️ 双义：sale_category 表 xsje=销售金额；cpi 表 xsje=去券销售金额。问数默认引导到营业额 | 两表.xsje |
| 主营销售/主营销售收入 | main_sale_amt（日表）/ zyxxsr（周月成本表） | sale_category / cost_category |
| 客单数/客单价 | kds / kdj（预计算）；门店口径 shop_kds | 各汇总表 |
| 连带率 | 平均每笔件数 = qty÷kds（近似，非"购买品类数"口径） | sale_category |
| 件单价 | turnover_amt÷qty | cpi_category |
| 线上销售占比 | xs_zb_main_sale_amt（预计算） | cpi_category |
| 前台毛利 | 销售-销售成本，qtml（去税 bhsqtml） | cost_category |
| 综合毛利 | 含后台调整，zhml（去税 bhszhml） | cost_category |
| 毛利率 | qtml÷turnover_amt（C 级口径，含税去税需配对一致） | cost+cpi 表 |
| 损耗金额/损耗率 | 报损报溢盘盈盘亏合计成本 shhsje/shbhsje；损耗率=shhsje÷turnover_amt（C 级，分母口径待统一） | cost_category |
| 生鲜盈亏 | 生鲜商品盈亏净成本额 sxpkpyhsje（去税 sxpkpybhsje），对照常规 nmpkpy* | cost_category |
| 促销销售占比 | promotion_turnover_amt÷turnover_amt | sale_category |
| 促销毛利 | disc_qtml（去税 disc_bhsqtml） | cost_category |
| 折扣率 | discvalue÷turnover_amt；促销折扣率=disc_value÷turnover_amt | sale_category |
| 出清 | 出清商品销售 clear_main_sale_amt/营业额 clear_turnover_amt/让渡 clear_value/回收毛利 clear_qtml | sale+cost |
| 促销券金额 | coupon_amt（去税 take_out_coupon_amt） | sale_category |
| 供应商分担 | 供应商进价折扣分担 zkfd_costvalue；成本侧 HSSUPZK/BHSSUPZK | sale+cost |
| 滞销库存 | zx_kcbhsje（不含税）；滞销占比=÷hj_kcbhsje | kpi_category |
| 缺货 SKU | Gdidsl（分子分母缺货 sku 数）/ hzGdidsl（分母缺货 sku 数），口径关系待确认 | kpi_category |
| 库存周转天数 | hj_kcbhsje÷bhsxscb×周期天数（周×7/月×30，期末库存近似） | kpi_category |
| 订货偏差率 | (ysje-ddje)÷ddje | kpi_category |
| 退货率 | thbhsje÷bhsxscb | kpi_category |
| 会员消费人数 | cust_cnt（类别表 string/KPI 表 double）；周期人数用 CSMR_NUMB | sale_category / number_month |
| 复购人数 | rep_cust；CONSUM_CNT2（"大于2次"口径待确认） | kpi / rep_num |
| 低频会员 | CONSUM_CNT1（周期内仅消费 1 次） | lowfreq_num |
| 会员消费转化率（跨业态） | CSXFZHL（百货客→超市客，预计算） | consume_conver |
| 超市新客订单 | whet_sprmrkt_new_cst_ord 标记 | mbr_ord_detl |
| RFM | R=最近消费日期、F=近90天次数、M=近90/365天金额，由门店标签表拼装 | store_csmr_tag |
| 同物业未交叉 | 近3个月百货消费但超市未消费 consum_bh_loss_cs_90d | store_csmr_tag |
| 同比 | 优先物化列：KPI 表 bq_/tq_/rate_、会员人数表 RIP_* | 同左 |

---

| `goodstype`（**商品类型，🔴 仅小类层 `deptlevelid=4` 有意义**） | ⚠️ **枚举待 N4 定案**：**10-23 实测注释 = `1=生鲜 / 2=食品 / 3=非食品`**；**10-21 截图注释 = `0普通/1生鲜/2电器/3服装/9大类`**（两次读数冲突） | 🔴 **枚举待 N4 实证**：①列注释**未列出 `'4'`** → 是否存在待验 ②注释注明「**u50不用, lookup表定义**」→ **权威枚举在 lookup 表**，本表 goodstype 可能是从属/冗余属性，**以 `goodstypename` 为准** ③**`1` = 生鲜为 A 级业务定论** ④业态外 2/3/（4?）须显式排除 |
| `deptlevelid`（**品类级别 = 层级真值**） | **1 柜组 / 2 大类 / 3 中类 / 4 小类**（🆕 可与 `deptlevelname` 列交叉验证） | ✅ **2026-10-22 实测定案**（跑 `WHERE deptlevelid='1'/'2'/'3'/'4'`）：1=柜组（id 3 位）/ 2=大类（5 位）/ 3=中类（7 位）/ 4=小类（9 位）。✅ **10-23 实测注释「1=柜组 2=大类 3=中类 4=小类」与 10-22 实际跑数一致**（此前「1=大类…4=细类」的注释已被修正）。⚠️ 但 `goodstype` 注释两次读数冲突 → **所有枚举仍须以 N3/N4 实测为准**。🔴 **层级真值 = `deptlevelid`**；**`goodstype` 仅小类层（`deptlevelid=4`）有意义** |
| `note` | `'0'` 与 NULL 混杂 | A 级：**空占位**，不作分析维度、不输出 |
## 3. 同义词/别名规则（Instructions 或列描述内覆盖）

| 用户说法 | 映射到 |
|----------|--------|
| 超市/卖场/门店/店 | store（未指定=全部超市门店合计） |
| 店型/门店级别 | shoplevel/shoplevelname |
| 销售额/销售/流水/业绩 | 默认营业额 turnover_amt；"去券"→cpi.xsje |
| 小票/订单/单/笔 | ord（笔数=kds 客单数） |
| 品类/大类/中类/小类 | main/mid/sub_category（明细表）；汇总表下钻暂走 dim_type（待确认） |
| 生鲜 | 无直接维度：盈亏/损耗侧引导 sxpkpy 列组；销售侧说明"暂无法按生鲜拆分"（缺口 P0-2） |
| 蔬菜/水果/肉/水产等具体品类 | 中类/小类名称（先 distinct 确认命名） |
| 损耗/报损/报溢 | shhsje 系 |
| 滞销/不动销/卖不动 | zx_kcbhsje；明细层=周期无销售的 item_id |
| 缺货/断货 | Gdidsl/hzGdidsl |
| 周转/库存天数 | hj_kcbhsje÷bhsxscb×天数 |
| 促销/活动/档期 | 促销商品属性列组（promotion_*）+ 时间窗；说明"无活动 ID 维度"（缺口 P0-4） |
| 出清/清仓 | clear_* 列组 |
| 券/优惠券 | coupon_amt；券偏好看 consum_topN_coupon_90d |
| 折扣/打折 | discvalue（总）/ disc_value（促销）/ clear_value（出清） |
| 复购/回头客/重复购买 | rep_cust / CONSUM_CNT2 |
| 低频/只来一次 | CONSUM_CNT1 |
| 拉新/新客 | whet_sprmrkt_new_cst_ord；新注册用 register_date |
| 早晚市/时段/峰谷 | time_period（明细表）；周几=week；周末节假日=date_type+holiday_name |
| 线上/外卖/到家 | xs_* 列组 / platform（明细表） |
| 会员标签/画像/圈选 | store_csmr_tag |
| 百货→超市/导流/转化 | consume_conver 表（CSXFZHL） |
| 供应商/厂家 | venderid/vendername（明细表）；商户 business_name 勿混 |

---

## 4. 全局指令（Instructions，注入每次问数）

1. **时间默认规则**：未指定时间默认最近一个完整自然日（T-1）或最近完整周/月，并在回答中声明所用时间。周表用 dlweekstart/dlweekend，月表用 dlmonbegin/dlmonend。
2. **string CAST 规则**：13 张表共 223 个字段为 string（含金额/人数/率）。建模层已配 CAST 视图；若直查原表，数值运算前必须显式 CAST，禁止字符串比较与求和。
3. **行式指标表规则**：DATA_TYPE/DATA_DIM/DATA_LABEL/DATE_RANGE 是元数据描述列，不是维度分组列；取数按 DATE_RANGE 过滤，月/季/年同构表**禁止 UNION 后汇总**。
4. **聚合防重规则**：门店消费者标签表与 ops_store 表粒度为"会员×门店"，人数统计必须先按 store_id 过滤；人数一律用预计算 cnt/NUMB 列，禁止 count(distinct) 与预聚合表混算。
5. **金额口径规则**："销售"默认营业额（含税）；"去券"→cpi 表 xsje；"去税/不含税"→用 bhs/不含税列并整式配对；"毛利"默认前台毛利 qtml，问"综合毛利"才用 zhml。
6. **明细表规则**：mbr_ord_detl 默认带 is_valid=有效 过滤；人数字段不出现在该表口径中（明细级，人数须回预聚合表）。
7. **同期规则**：问同比/同期优先用物化列（bq_/tq_/rate_、RIP_*），不自行拼日期偏移。
8. **互斥表规则**：ops_store（门店）与 ops_level（店型）互斥择一；consume_conver 月/季/年三表互斥择一；百货标签 mall 与 mall12 治理完成前只用 mall。
9. **生鲜口径规则（2026-10-21 业务定论 + 换表修订）**：生鲜的唯一权威判定 = 品类维表 **`goodstype='1' AND deptlevelid=4`**（🔴 小类层；**新表 `deptlevelid=4` = 小类**）。**禁止**在大类行（level 1）/中类行（level 2）/小类行（level 4）上读 `goodstype` 判品类。🟢 **新表红利**：`parentcategoryid` 提供直接父指针 → **大类/中类的生鲜占比必须沿父链从小类上卷**（可 join、可审计），**禁止**直接读大类行的 goodstype。⚠️ 取数档位须与层级对齐（小类清单 → ADS `data_type='小类'` 档）。🔴 业态外 `goodstype IN ('2','3')`（及待定的 `'4'`）须显式排除；`goodstype='9'` 大类码类目金额为**手工录入总额**、**不参与品类体系** → 须剔除或单独标注。⚠️ **换表后取数链路待 N8/N9 定位，定位前「生鲜销售额占比」一律拒答**。
10. **失效问法兜底**：涉及"为什么/建议/预测"类分析型问题，不下 SQL，走智能体分析链路并提示"该问题不支持直接取数"。

11. **类目树数值聚合规则（通用，当前表内无线可验）**：🔴 **任何维度树（品类/组织/商品分类）的数值列，默认都不可跨层相加**——除非实测证明父行值 = 子女之和。正确算法是「取目标节点下所有末级子节点求和」（**结构聚合**），而非「对各层求和再相加」（数值聚合）。🟢 本表**当前无量化列**（无标准品号数/销售配额），故本条暂无线可验；**若数据组补回数值列，此规则立即生效**。
12. **汇总表粒度规则（data_type 必过滤，2026-10-20 用户确认值集）**：凡查询 cpi/sale/cost/kpi 系列（14 张）必须带 `data_type` 过滤，默认 `'门店'`；类别下钻用 `'大类'/'中类'/'小类'`，单店类别下钻用 `'门店大类'/'门店中类'/'门店小类'`；**不带过滤的聚合 = 跨粒度重复计数**（'门店'行已含门店总量，'大类'行又含一遍）。智能体改写后 SQL 缺 data_type 时自动补 `data_type='门店'`；⚠️ 同名陷阱：行式表 `DATA_TYPE`（大写，元数据列）与本规则无关。

---

## 5. 待确认清单（阻塞项，上线前必须闭环）

| # | 问题 | 找谁 | 怎么确认 |
|---|------|------|----------|
| 1 | ~~dim_type 承载维度与 data_type 值集~~——**用户 2026-10-20 确认：data_type 七档（门店/大类/中类/小类/门店大类/门店中类/门店小类），dim_type_id 随档取对应编号**；剩余：与 dim_spm_chl_category_df 映射核对 | 数据组（陈永松） | 抽样核对 |
| 2 | is_valid / whet_sprmrkt_new_cst_ord / date_type / time_period / week / onoffln_mark 实际取值 | 数据组 | distinct 截图留痕 |
| 3 | consume_lifecycle / consume_lifestatus / member_ops / consum_bh_loss_cs_90d / is_fans / is_wechat_user / is_mbr 取值 | 数据组 | distinct 截图留痕 |
| 4 | CONSUM_CNT2「大于2次」是否含 2 次 | 数据组 | 口径邮件确认 |
| 5 | consum_cnt_730d 是近两年还是前一年 | 数据组 | 口径邮件确认（字段名与注释矛盾） |
| 6 | Gdidsl/hzGdidsl 分子分母关系；kcbhsje 注释"分字库存"是否"分子"笔误 | 数据组 | SQL 血缘 + 确认邮件 |
| 7 | xsje 两表双义（销售金额 vs 去券销售金额）是否刻意 | 数据组 | 口径邮件确认 |
| 8 | consum_*_90d 偏好字段（厨房/日用/年节/休闲/其他）是金额、次数还是占比得分 | 数据组 | 抽样 100 行看数值分布 |
| 9 | DATA_TYPE/DATA_DIM/DATA_LABEL/DATE_RANGE 全量枚举（number/conver/rep/lowfreq 共 8 张行式表） | 数据组 | distinct 查询 |
| 10 | ~~ds 分区格式~~（正式环境将剔除 ds 字段，消项）；各表数据延迟（T+?）仍待 | 数据组 | 调度平台截图 |
| 11 | consume_conver 表 BHMDID×CSMDID 门店组合规则；与 store_id 的映射 | 数据组+运营 | 抽样核对 + 口径确认 |
| 13 | 门店维表枚举：shopstatus / shoptype / **shopform** / shoplevel 取值；openingtime 格式；**营业面积字段是否存在或能否补** | 数据组+运营 | 跑 03-1 B1-1-S3 取 distinct；面积问题书面回复 |
| 14 | 🔴🔴 **`goodstype` 枚举定案（最高优先）**：**10-23 实测注释 = `1生鲜/2食品/3非食品`**，**10-21 截图注释 = `0普通/1生鲜/2电器/3服装/9大类`**，**两次读数冲突**。跑 **N4**（`goodstype`×`goodstypename` 交叉，限小类层）定案。⚠️ 同时需确认：①查的是哪个环境（pilot / 正式库）②是否有 `'0'`/`'9'` 取值 ③`goodstypename` 是否为中文真值 | 数据组 | 跑 03-1 **N4**（判读表见样本行） |
| 16 | `dim_sprmrkt_itm_item_df` 三级类目编码是否与 ADS 汇总表 `dim_type_id` 同源（与品类维表互为交叉校验） | 数据组 / 本地跑 B1-3-M2 | join 对照两侧 ID+名称 |
| 17 | ~~生鲜口径定案~~ ✅ **业务定论沿用**：`goodstype='1'` 且**小类层**；🔴 **新表小类 = `deptlevelid=4`**；🟢 上卷改走 `parentcategoryid` 父链 join | — | 已闭环（取数链路见 N8/N9） |
| 15 | ~~pilot 库品类维表为空~~ ✅ **2026-10-21 晚已灌数（8495 行），S0 门禁全绿（8495/8495/4/6/0）** | — | 已闭环；空表诊断三连保留为通用排查范式（见 03-1 B1-2-S0 注记） |
| 12 | WrenAI 业务术语/指令/样本对配置上限与格式 | 平台侧 | 控制台实测 |
| 18 | ~~goodstype=4 定性~~ ✅ **已定性为「家电商品」**（S8 抽样 30/30）→ ⚠️ **待 S12 全量 203 条复核**（抽样非随机） | 数据组 | 跑 B1-2-S12 分段抽样 |
| 19 | 🔴 品类维表是否**集团跨业态共用主数据**（业态外 goodstype 2/3/4 合计 **33.0%**：电器 723 + 服装 1877 + 家电 203） | 数据组 | 跑 B1-2-S9 看 ADS 小类档命中数 |
| 20 | ~~层级真值待定~~ ✅ **层级真值 = `deptlevelid`**（业务定论 + 新表注释 + `deptlevelname` 可交叉验证） | — | 已闭环 |
| 22 | 🔴 **品类维表 `dim_spm_chl_category_df` 的落地**：①平台 catalog **尚未登记**（需注册含 `in_scope=1`）②需建立关系 `dim_spm_chl_category_df → ads_spm_trd_cost_category_day_df`（供品类毛利下钻） | 平台侧 + 数据组 | 注册后跑 `iqd_catalog_item` 复查 + 关系指向核查 |
| 23 | 🔴 **`goodstype` 权威来源**：新表注释注明「u50不用, lookup表定义」→ **权威枚举在 lookup 表**。本表 `goodstype` 是否为从属/冗余属性？两者是否可能不一致？ | 数据组 | 跑 N4 看 `goodstype`×`goodstypename` 是否一一对应；不一致则以 `goodstypename` 为准 |
| 24 | 🔴 **是否需要补列「标准品号数」与「销售配额」**？当前品类维表**无这两列** → 「品类宽度达成率」「品类目标达成率」「动销率」三个场景全部拒答 | 业务方 + 数据组 | 业务确认是否有此需求 → 需补则明确口径（品号数是**类目档案标准品号数**还是**门店在架商品数**，后者才可用于动销率） |
| 26 | ⚠️ **判定层与取数档位对齐性待实证**：生鲜判定在**小类(`deptlevelid=4`)**，ADS `data_type` 七档含「小类」→ **理论同层对齐**。仍须实证：①ADS 各档实际命中哪一层（**N12**）②生鲜小类上卷到中类是否完整（**N13**，断链会漏算） | 数据组 | 跑 **N12** + **N13** |

---

> 下一步：按本配置产出《03_样本问题树 + Doris SQL 全集（按 Skill 分组）》（对照百货 03 文档格式），SQL 中所有 ⚠️ 假设以上表第 5 节闭环结果为准全局替换。
