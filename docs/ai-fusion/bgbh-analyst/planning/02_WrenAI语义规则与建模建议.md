# WrenAI 0.13 语义规则与建模建议 v1.0

> 面向 WrenAI 的 Modeling（语义模型）/ Business Terms / Instructions / Question-SQL Pairs 四类配置。
> 各配置项名称以 0.13 实际控制台为准，标注【待验证】。

---

## 1. 建模范围（Modeling）

### 1.1 注册表清单（第一批上线 = Phase 1，10张）

| 批次 | 表 | 理由 |
|------|----|----|
| P1 | ads_trd_mall_sale_d_df | 经营日报主表，维度最全 |
| P1 | ads_trd_store_new_old_mbr_sale_df | 新老会员核心问题 |
| P1 | ads_trd_store_mbr_sale_df | 会员排名/清单 |
| P1 | ads_csmr_store_high_mbr_info_df | 高端会员 |
| P1 | ads_trd_brand_new_mbr_sale_df | 新客分析 |
| P1 | ads_csmr_store_brand_whole_sale_df | 品牌经营/坪效 |
| P1 | ads_flow_cst_flow_hour_df | 客流 |
| P1 | ads_flow_store_parking_d_df | 停车 |
| P1 | ads_csmr_store_drain_analysis_d_df | 流失总览 |
| P1 | ads_csmr_wechat_cst_stats_d_df | 企微 |
| P2 | ads_trd_mbr_hall_sale_d_df / ads_trd_mbr_sale_ord_d_df / ads_trd_mbr_store_input_d_df / 品牌客群3表 / drain 剩余3表 / 关联4表 / 小时销售表 | 见实施计划 |

### 1.2 表描述全集（可直接粘贴到 WrenAI Table Description）

统一模板：`{中文名}。粒度：{粒度}。维度：{主要维度}。度量：{指标}。注意：{使用约束}。`

#### 销售域 trd（8张）

**ads_trd_mall_sale_d_df**（百货销售日表）
> 粒度：日×厅房。维度：日期、商户、门店(含业态/销售排序)、厅房(含楼栋/楼层)、柜组、部门、品牌、大类/中类/小类、经营模式(经销/代销/联营/百货租赁/租赁/购物中心联营/临时场地/多经/写字楼)及租赁/非租赁分类、供应商、合同类型。度量：销售金额、含券金额、去券金额、去券去税金额、零售金额、销售成本、调账成本、销售毛利、毛利率、税额、销售数量、销售笔数、销售单价、优惠金额、折扣金额、折扣率。注意：金额为预汇总值，禁止跨重复维度再求和；sale_avg_price 是"件均价"不是客单价。

**ads_mall_trd_hall_sale_h_last_year_df**（百货同期厅房小时销售表）
> 粒度：小时时段×厅房×渠道。维度：统计时段、统计日期、节假日名称、日期类别、月份、年份、统计渠道类型、渠道、合同号。度量：去券金额、去券去税金额、销售件数、笔单价、优惠金额、折扣金额、折扣率。注意：本表存的是"去年同期"数据，用户问"同比/去年今天/同期"的时段销售时优先用本表，不要做日期偏移计算。

**ads_trd_mbr_sale_ord_d_df**（会员销售订单日表）
> 粒度：订单明细×日。维度：订单(编号/小票号/收款台/原订单)、会员(id/oneid/性别/年龄/留资日期/注册日期/会员状态/来源渠道/注册门店/会员等级/省市县区/所属导购)、商品(编码/名称)、合同号、供应商、经营模式及分类、发券会员号、订单时间/月/季/年、日期类别、假期名称、时段、日结日期、商户、门店、部门、柜组、厅房、品牌、大/中/小类、九级新客订单标记(whet_mall/store/dept/group/hall/category/brand/main_category 及月度/季度/年度新客)。度量：扣点、销售数量、销售金额、积分、折扣金额。注意：明细级表，人数字段不可与预聚合表混算；新客判定用 whet_* 标记列。

**ads_trd_mbr_hall_sale_d_df**（会员厅房销售日表）
> 粒度：日×会员×厅房。维度：统计日期、会员卡(id/编码/类型/所属门店)、会员(id/oneid/性别/年龄)、厅房(含楼栋/楼层)、柜组、部门、门店(含业态)、品牌、大/中/小类、经营模式及分类、供应商、合同类型。度量：日销售数量/金额/笔数、日利润贡献金额、日优惠券投入金额、日订单积分支付金额，及全部七项的环期(_mom)与去年同期(_yoy)值。注意："同比/环比"问法直接用 _yoy/_mom 列。

**ads_trd_store_mbr_sale_df**（门店会员销售表）
> 粒度：统计周期×门店×会员(oneid)。维度：stats_period(日/月/季/年/近3月/近6月/近一年/近2年)、统计时间、门店、oneid。度量：销售排名、销售排名比例、销售排名区间、销售金额。注意：个人级敏感数据，默认只输出TopN或聚合结果，不整表罗列。

**ads_trd_store_new_old_mbr_sale_df**（门店新老会员销售表）
> 粒度：新老会员×统计周期×门店（下挂厅房/柜组/部门/品牌/品类全维度）。维度：统计周期、统计时间、新老会员、厅房(含楼栋/楼层)、柜组、部门、门店(含业态/销售排序)、品牌、大/中/小类、经营模式、供应商。度量：会员人数、复购人数、销售金额、贡献率、复购率、客单价(avg_mbr_price)、平均消费天数。注意：复购率/贡献率/客单价均为预计算列，勿自行重算。

**ads_trd_mbr_store_input_d_df**（会员门店投入产出日表）
> 粒度：日×会员×门店。维度：统计日期、会员、会员卡(id/编码/类型/所属门店)、会员性别、门店(含业态/销售排序)。度量：销售数量/笔数/金额、贡献金额、优惠券投入、停车投入、权益投入、积分投入、礼品投入、投入合计、投入产出比、实际贡献价值。注意：投入产出比/贡献类为预计算口径；贡献金额与实际贡献价值口径差异待确认。

**ads_trd_brand_new_mbr_sale_df**（品牌/品类新客分析）
> 粒度：统计周期×门店×品类×品牌。维度：时间类型、时间、门店、品类、品牌。度量：品牌新客人数(前年/去年/本期)、品牌新客与门店品类新客中位数差异、品类新客人数及同比、新客消费金额及同比、新客客单价及同比、新客消费笔数及同比、人均消费笔数及同比。注意：与 ads_csmr_store_brand_new_mbr_sale_df 指标高度重复，问品牌新客优先用本表。

#### 消费者域 csmr（17张）

**ads_csmr_store_brand_whole_sale_df**（客群门店品牌销售人数分析）
> 粒度：统计周期×门店×品类×品牌。维度：门店、品类、品牌、供应商、品牌在门店的合作模式。度量：会员消费人数(前年同期/去年同期/本期)、人数与中位数差异、品牌在品类的销售/营收排名、品牌销售/营收排名、销售毛利率、回款率、销售坪效、营收坪效、消费品牌数、门店品牌TOP20%会员占比、门店销售、门店会员销售额、门店会员贡献率、门店会员客单价、门店活跃度（以上均含同比 _yoy 列）。注意：同比一律用 _yoy 预计算列。

**ads_csmr_store_brand_new_mbr_sale_df**（品牌新客销售表）
> 粒度：统计周期×门店×品类×品牌。维度：统计周期、时间、门店、品类、品牌。度量：品牌新客人数(前年/去年/本期)、与品类新客中位数差异、品类新客人数及同比、新客金额/客单价/笔数及同比、人均消费笔数及同比。注意：与 ads_trd_brand_new_mbr_sale_df 重复，优先用 trd 版本。

**ads_csmr_store_brand_trd_analysis_df**（客群门店品牌销售分析·消费金额分层）
> 粒度：统计周期×门店×品牌。维度：统计周期、门店、品牌。度量：品牌侧与门店侧各7档消费金额段人数(<3千/3-5千/5千-1万/1-2万/2-3万/3-5万/≥5万)、各档同比人数、各档人数占比。注意：分段值在列名中(brand_amt_range_person_cnt_1~7)，回答"哪个金额段人最多"需比较同组多列。

**ads_csmr_store_brand_frq_analysis_df**（客群门店品牌频次分析）
> 粒度：统计周期×门店×品牌。维度：统计周期、门店、品牌。度量：品牌复购率(本期/去年/前年)、品牌侧与门店侧1~8天及以上到店天数分段人数、各段同比、各段占比。注意：分段含义为"周期内到店天数"，8=8天及以上。

**ads_csmr_store_brand_attribute_analysis_df**（客群门店品牌属性分析）
> 粒度：统计周期×门店×品牌。维度：统计周期、门店、品牌。度量：6档年龄占比(<25/26-35/36-45/46-55/56-65/≥66)及同比、男性占比及同比、女性占比及同比。注意：源字段表中男性占比列名也写作 brand_female_person_cnt_rate（源文件疑似笔误，建模型时核对实际列名）。

**ads_csmr_brand_category_input_df**（门店同品类品牌输入关联分析）
> 粒度：统计周期×门店×品牌。维度：统计周期、统计时间、门店、品牌。度量：关联消费品类Top5(category_name_top_1~5)、同品类关联输入品牌Top5(id/名称/输入关联度)、全商场关联输入品牌Top5(id/名称/输入关联度)。注意：TopN宽表，品牌名在列值而非维度列；"输入"=消费该品牌的客人还买了哪些品牌。

**ads_csmr_brand_category_output_df**（门店同品类品牌输出关联分析）
> 粒度：统计周期×门店×品牌。维度：统计周期、统计时间、门店、品牌。度量：同品类关联输出品牌Top5、全商场关联输出品牌Top5（均含id/名称/输出关联度）。注意：TopN宽表；"输出"=该品牌的客人流失后流向哪些品牌。

**ads_csmr_brand_category_link_df**（门店品牌输入输出关联分析）
> 粒度：统计周期×门店×品牌×关联品牌。维度：统计周期、统计时间、门店、品牌品类、品牌、关联品牌品类、关联品牌、是否同类。度量：输入品牌购买人数、输出品牌购买人数、关联品牌购买人数、输入关联度、输出关联度。注意：关系对明细表，适合"某品牌与某关联品牌"的双边问法。

**ads_csmr_category_link_df**（门店品类关联分析）
> 粒度：统计周期×门店×品类×关联品类。维度：统计周期、统计时间、门店、品类、关联品类。度量：关联购买人数。注意：品类级关联，比品牌级更粗。

**ads_csmr_store_mbr_drain_df**（门店会员流失模型表）
> 粒度：统计周期×门店×会员。维度：统计周期、门店、会员、会员卡类型、性别、生日、年龄、高端会员区间。度量：最近一次消费日期、最近消费距今天数、年平均消费周期、同期年平均消费周期。注意：会员级流失清单来源；"流失中"判定=最近消费距今天数>年平均消费周期（口径待确认）。

**ads_csmr_store_drain_analysis_d_df**（门店会员流失分析日快照表）
> 粒度：快照日期×统计周期×门店×会员卡类型×高端会员区间×流失周期。维度：快照日期、统计周期、门店、会员卡类型、高端会员占比区间、流失周期。度量：流失人数、流失率。注意：快照表，查询时必须指定/默认最大 snapshot_date，避免跨快照累加翻倍。

**ads_csmr_store_drain_assess_consum_d_df**（门店会员流失考核消费日快照表）
> 粒度：快照日期×统计年份×门店×会员卡类型×高端会员区间。维度：快照日期、统计年份、门店、会员卡类型、高端会员占比区间。度量：考核流失人数、平均消费周期。注意：考核口径与 analysis 表不同，问"考核流失"必须且只能用本表。

**ads_csmr_store_brand_drain_df**（门店品牌消费客群品牌流失分析）
> 粒度：统计周期×门店×品牌。维度：周期时间、门店、品牌。度量：品牌流失率(前年/去年/本期)、门店品牌TOP20%会员在品牌年度流失人数占比、1~12个月及一年以上分层流失人数、近一年门店平均休眠周期及同比。注意：源字段描述中 brand_drain_avg 与 _yoy 的"本期/同比"疑似写反，以实际数据验证为准。

**ads_csmr_store_drain_df**（门店品牌消费客群商城流失分析）
> 粒度：统计周期×门店×品牌。维度：周期时间、门店、品牌。度量：1~12个月及一年以上分层流失人数(离开本商场)、门店平均休眠周期及同比。注意：与 brand_drain 表的区别是"流向商场外"而非流向其他品牌。

**ads_csmr_store_brand_drain_drc_df**（品牌流失会员去向）
> 粒度：统计周期×门店×品牌。维度：周期时间、门店、品牌。度量：流失会员去向品牌Top10(名称+人数，store_brand_drain_drc_1~10)。注意：TopN宽表；"流失会员去了哪些品牌"用本表。

**ads_csmr_store_high_mbr_info_df**（门店高端会员信息表）
> 粒度：统计周期×统计渠道×高端会员区间。维度：统计周期、时间周期、统计渠道类型、渠道、高端会员区间。度量：高端会员人数、高端会员销售金额、高端会员贡献率。注意：高端区间阈值定义待确认。

**ads_csmr_store_csmr_tag_df**（门店消费者标签表）
> 粒度：会员(oneid)×门店。属性：会员/客户id、手机号、是否粉丝/企微用户/会员/至臻金卡/潜客、性别、年龄、留资/注册日期、会员状态、来源渠道、注册门店、等级、省市县区、所属导购。消费标签：近365天消费品牌数/品类数/日均消费金额/平均购买间隔/金额分段/累计次数/贡献金额/实际贡献价值/品牌偏好Top3、年度平均到店周期、券/停车/权益/积分/礼品投入、积分返利券到期预警、新人礼包领取后使用情况。注意：含手机号等敏感字段，默认不输出。

**ads_csmr_csmr_tag_df**（消费者标签表·全域）
> 粒度：会员(oneid)。属性：会员/客户id、手机号、是否粉丝/企微用户/会员/至臻金卡/潜客、性别、年龄、留资/注册日期、会员状态、来源渠道、注册门店、等级、省市县区、所属导购。注意：无门店维度的全域标签，用于"全市/全部会员"类画像；敏感字段默认不输出。

**ads_csmr_wechat_cst_stats_d_df**（企微客户统计日表）
> 粒度：日×是否会员×是否潜客×归属门店×所属导购×来源门店。维度：统计日期、是否会员、是否潜客、归属门店、所属导购、来源门店。度量：企微客户数、企微客户新增人数。

**ads_mall_csmr_wechat_cst_stats_df**（企微客户统计表·多周期）
> 粒度：统计周期×门店×导购。维度：stats_period(day/month/quarter/year)、统计时间、是否会员、是否潜客、所属导购、门店(消费门店/归属门店)。度量：企微客户新增人数、销售人数、转化率(cst_inc_cnt_rate，口径待确认)。

#### 流量域 flow（2张）

**ads_flow_cst_flow_hour_df**（客户流量时段表）
> 粒度：地点×小时。来源：汇纳/nec/银联。维度：门店、地点(名称/类型)、统计时间、统计时段。度量：进入人数、离开人数、滞留人数、转化率。注意：地点(location)比门店更细（楼层/区域级），问"门店客流"需按门店汇总。

**ads_flow_store_parking_d_df**（门店停车日表）
> 粒度：门店×日。维度：统计日期、门店。度量：车位数量、进场/离场/滞留车数量、车流周转率、平均滞留时长、线下缴费笔数/应收/实收/优惠、免费放行次数、线上缴费笔数及占比、线上应收/免费(券)/免费(积分)/实收、缴费总笔数、停车缴费金额、减免金额。

#### DWD 明细层（13张，默认不向终端用户开放，仅下钻模板/人工取数）

- **dwd_trd_mbr_ord_detl_df** 会员订单明细事务事实表。粒度：订单明细。来源CRM(会员消费记录)。度量：订单明细数量/金额、积分、折扣金额；维度：订单、会员(oneid)、门店、厅房、品牌、供应商、商品、扣点。
- **dwd_trd_mbr_ord_pay_detl_df** 会员订单支付明细。度量：支付金额、折扣金额；特有维度：支付方式(pay_mode)。
- **dwd_mall_trd_sale_ord_detl_df** 百货销售订单明细(ERP全量，含非会员)。度量：订单数量/金额/优惠金额/折扣金额。
- **dwd_chl_contract_df** 合同基本信息。维度：合同号/类型、经营模式(枚举同mall表)、供应商、门店、签订/起止/退场时间、状态、进/销项税率、结算扣率。
- **dwd_chl_store_item_df** 门店商品事实表。粒度：商品×门店。维度：商品、门店、合同号、状态。
- **dwd_mkt_item_use_coupon_detl_df** 商品用券明细。度量：金额、用券余额、券溢余金额、商品数量；维度：会员、厅房、商品、订单状态。
- **dwd_mkt_coupon_deal_record_df** 优惠券处理记录。度量：借方/贷方金额、余额；维度：处理类型、券类型、促销ID、门店、有效期。
- **dwd_mkt_equity_record_df** 会员权益记录。维度：权益类别、券状态、活动、联名品牌、满减金额；时间：获取/使用/失效。
- **dwd_mkt_gift_ivnt_change_detl_df** 礼品库存变更明细。度量：变动数量/金额、库存数量/单价。
- **dwd_mkt_point_change_detl_df** 积分变更明细。度量：基础/升级/未处理/赠送变动积分。
- **dwd_flow_cst_flow_df** 客户流量事实表(明细级，含进出人数)。注：dwd/ads 粒度差异以实际为准【待确认】。
- **dwd_flow_parking_aprch_off_detl_df** 停车进出场明细。维度：车牌、车型、进出口类型、进出场时间；度量：停车时长(分钟)。
- **dwd_flow_parking_pay_detl_df** 停车支付明细。度量：应收/实付金额；维度：支付来源/渠道/类型、车牌。

#### DIM 维表层（12张，字段已完整提取）

**dim_chl_store_df**（门店维度表，T+1，粒度：门店）
> 门店：store_id(主键)、store_name(主键)、store_shotr_name(门店简称，源字段疑似拼写，应为short)。属性：商户名称business_name、门店类型store_type、开业时间store_start_time、门店级别store_level(A/B/C)、业态store_busi_type、状态store_status(闭店/停用等)、客流类别排序cst_flow_type_sort、客流门店排序cst_flow_store_sort、销售排序sale_sort、城市city、所属区域belong_area。

**dim_chl_hall_df**（厅房维度表，T+1，粒度：厅房）
> 厅房：hall_id(主键)、hall_code、hall_name。属性：楼栋building、楼层floor_name、状态status_id、品牌brand_id/brand_name、柜组group_id/code/name、部门dept_id/code/name、门店store_id/store_name。注意：该表同时冗余了柜组/部门/门店层级名称，是层级钻取的主要维表。

**dim_chl_brand_df**（品牌维度表，T+1，粒度：品牌）
> 品牌：brand_id(主键)、brand_name。属性：小类/中类/大类 的id/编码/名称（sub/mid/main_category）。注意：main_category_id/name 的字段描述写成"大类名称"（与ADS表同样问题），实际按列名理解为大类。

**dim_chl_cashier_df**（收款台维度表，T+1，粒度：收款台）
> 收款台：cashier_code。属性：门店store_id/store_code/store_name、折扣/退货/柜组/超市/PAD/虚拟收款台标记。注意：最后一行字段分类"属性"无字段名（源文件空行，待确认）；线上/线下平台判定规则见枚举字典（收款台号后四位重复数字=线上）。

**dim_csmr_mbr_df**（会员维度表，T+1，粒度：会员id，来源crm.hyk_gkda）
> 会员：mbr_id、mbr_name、oneid(=nvl(phone,gkid))。属性：手机号mbr_phone、性别mbr_gender、生日/年龄mbr_birthday/mbr_age(由csrq推算)、地址mbr_address、车牌号mbr_license_plate。注意：含敏感字段，默认不输出。

**dim_csmr_mbr_card_df**（会员卡维度表，T+1，粒度：会员卡id，来源crm.hyk_hyxx）
> 会员卡：mbr_card_id、mbr_card_code(主键)、mbr_card_type_id/name、会员卡状态mbr_card_status(status>=0正常，-4停用，-1作废)、会员卡门店mbr_card_store_code/name。会员：mbr_id、mbr_name、oneid(=nvl(phone,gkid,hyid))。属性：手机号、性别、生日、年龄、地址、车牌号。注意：sheet中表英文名称误写为"c"；一人多卡场景以本表为准。

**dim_csmr_wechat_cst_df**（微信客户维度表，T+1，粒度：客户id，来源有赞/企微）
> 客户：CST_ID(客户ID)、CST_NO(客户编码)。核心属性：oneid、OPENID/UNIONID/WXAPP_OPENID/WXQY_OPENID(区分公众号/小程序/企微)、CARD_NO(会员卡号)、REGISTER_DATE、STATUS(05粉丝会员/10注册会员/50消费会员/90停用会员)、SOURCE_CHANNLE_TYPE(10实体门店/20网络平台/30电话OB/40电话IB/50目录销售/60分销批发/70微信平台/80ICC平台/90其他)、SOURCE_SITE_ID(来源门店)、BELONG_SITE_ID(归属门店)、AGENT_INFO(专属顾问)、WXCP_USERIDS(企业微信好友工号)、AGENT_ALLOW_DATE(分配导购日期)、GENDER/BIRTHDAY、省市县名称。注意：100列级宽表，问数只暴露上述核心列；敏感字段默认不输出。

**dim_csmr_oneid_index_df**（oneid倒排表，T+1，粒度：oneid）
> id_type/id_value/oneid/mbr_id/mbr_card_id/union_id/open_id/cst_id。用途：跨源身份打通（会员/微信/企微），一般不做终端问数表，仅供关联。

**dim_itm_item_df**（商品维度表，T+1，粒度：商品代码，来源erp.spxx）
> 商品：item_id、item_code、item_no(货号)、item_name、item_full_name、item_bar_code。属性：商品分类item_cl、类型item_type、单位、质量等级、单价lsdj、品牌brand、生产厂家、规格、进项/销项/消费税率、保持期天数、负库存销售标记等。

**dim_pub_date_df**（日期维表，T+1，粒度：日期；sheet名dim_pub_date，目录注册名dim_pub_date_df，建模以库中实际表名为准）
> 主键day_yyyymmdd。属性：day/day_cn/day_lunar/day_solar、日期的 环比(day_mom)/同比(day_yoy)/同比前年(day_year_before_last) 及数字版、年月year_month、月month及环比/同比月、季度quarter、周week/周数/年内周/周起止/环比周/同比周、月末最后一天。用途：所有同比/环比口径的日期侧支撑。

**dim_pub_date_hoilday_df**（日期假日维度表，T+1，粒度：日期）
> day(主键)、hol_name(节假日名称)。用途：节假日 join 维；注意字段分类误写为"厅房"。

**dim_trd_pay_mode_df**（支付方式维度表，T+1，粒度：支付方式id；sheet内表名误写为dim_trd_pay_type_df，以目录为准）
> 主键pay_mode_id。属性：pay_mode_name、支付类型pay_type、收款类别collect_money_type、手续费比例cmsn_rate/类别cmsn_type、积分标记point_mark、满减标记full_sbtrtn_mark、优惠券相关标记、找零方式、显示顺序display_rn。

#### DWS 汇总层（2张，仍为嵌入图片，字段待补档）

dws_trd_mbr_hall_sale_d_df（会员厅房销售汇总）、dws_trd_mbr_store_input_1d_df（会员门店投入产出汇总）。ADS 同名表已覆盖其主要场景，问数平台**首批可不挂 DWS**。

---

## 1.5 维度枚举字典（DIM文件「维度清单」sheet 提取，级别A，直接录入业务术语/列描述）

| 维度 | 枚举值/定义 | 用法 |
|------|------------|------|
| 日期类型 | 周末、节假日、平时 | 对应 day_type/date_type 列 |
| 部门级别 | 1门店 / 2(暂不用) / 3部门 / 4柜组 / 5厅房 | 组织层级钻取 |
| 经营模式 | 0经销 1代销 3联营 5百货租赁 6租赁 14临时场地 15多经 18写字楼 | operate_mode |
| 经营模式分类 | 5/6→租赁，其余→非租赁 | operate_mode_type |
| 百货_门店流失周期 | 1月≤30天，2月=31~60天，3月=61~90天……依次类推，一年以上>365天 | drain_period |
| 百货_门店品牌流失周期 | 同上，但按"当前门店下统计品牌最近一次消费时间"计算 | drain 品牌系 |
| 门店高端会员占比 | 1% / 2%-5% / 6%-10% / 11%-20% / 21%-50%；定义为门店会员购买金额排名前1%、前2%-5%(不含1%)…… | high_mbr_range |
| 关联输入品牌 | 期间内、统计门店下、消费统计品牌**之前**消费的其他品牌 | input 系 |
| 关联输出品牌 | 期间内、消费统计品牌**之后**消费的其他品牌 | output 系 |
| 消费金额分段 | 500以下/500-1000/1000-2000/2000-3000/3000-5000/5000-10000/1万-2万/2万-3万/3万-5万/5万以上（前开后闭） | consum_amt_365d |
| 平均购买间隔 | 近一年两次购买间隔天数之和÷(购买次数-1) | avg_prch_interval |
| 年度平均到店周期 | 365÷会员上一年订单所在天数 | avg_store_period_y |
| 用户身份 | 是否会员=是否注册；是否潜客=是否有订单；是否至臻金卡=手动标签(一年更新一次) | csmr_tag |
| 会员性别 | 男、女、未知 | gender |
| 会员年龄 | 25岁以下/26-35/36-45/46-55/56-65/66岁以上 | age |
| 平台(线上/线下) | 线上=收款台号后四位为重复数字；线下=其他收款台 | 订单宽表 |
| 会员投入类型 | 停车投入、积分投入(细分：停车/订单/年度积分返利)、权益投入、优惠券投入、礼品投入 | input 系 |
| 积分类型 | 基础积分、多倍积分 | point 系 |
| 客流来源 | 汇纳/nec/银联（location 级） | flow 系 |
| 品牌新客/各层级新客 | 标记字段取值：是、否 | whet_* |

**仍待确认（清单sheet未覆盖）**：stats_period/stats_time 全量枚举、mbr_new_old 枚举、is_mbr/is_stealer/is_fans/is_gold_card 实际存储值（字典给的是业务定义，存储值可能是Y/N/1/0）、ctbtn_amt 与 actual_ctbtn_amt 口径差、各ADS表分区键与数据延迟。

### 1.3 关系（Relationships，建议最小集）

| 主表 | 从表 | 关联键 | 说明【待验证：以0.13关系配置为准】 |
|------|------|--------|------|
| dim_chl_store_df | 各 ADS 表 | store_id | 门店维 |
| dim_chl_hall_df | mall/hall 系 ADS | hall_id | 厅房维 |
| dim_chl_brand_df | 品牌系 ADS | brand_id | 品牌维 |
| dim_pub_date | ADS 日表 | stats_date | 日期维（含日期类别/节假日，直接冗余在 ADS 内，关系可选） |
| dim_csmr_mbr_df | 会员系 ADS | mbr_id / oneid | 会员维 |

> 注意：ADS 表已高度反规范化（store_name、brand_name 冗余在表内），**首批建议只建 store_id 一个关系族，其余靠冗余列回答**，降低 join 幻觉。

### 1.4 列级规则（Column Description / Calibrated)

| 规则 | 示例 |
|------|------|
| 枚举列必须在描述中列出取值 | `day_type：日期类别（工作日/周末/节假日，取值待确认）`；`operate_mode：经营模式（经销/代销/联营/百货租赁/租赁/购物中心联营/临时场地/多经/写字楼）`；`mbr_new_old：新老会员标记（取值待确认）` |
| 预计算列标注"勿重算" | `sale_gross_profit_rate：销售毛利率（已预计算=销售毛利/销售金额，勿自行用其他公式）` |
| _yoy/_mom 列标注语义 | `sale_amt_yoy：日同期（去年同期）销售金额——"同比"问法优先取本列` |
| whet_* 列组统一说明 | `whet_store_new_cst_ord 等九个字段为各级新客订单标记（1是/0否，取值待确认）` |
| 金额单位标注 | 所有 amt 字段描述尾缀`单位：元` |

---

## 2. 业务术语（Business Terms）

> 每条 = 术语 + 默认解释 + 指向表/列。这是 wrenai 术语库的直接录入内容。

| 术语 | 标准解释（问数时展开注入） | 主表.列 |
|------|--------------------------|---------|
| 销售额/销售金额 | 默认=ads_trd_mall_sale_d_df.sale_amt；若问"去券"用 sale_uncpn_amt；问"会员销售"切到会员系表 | mall_sale / new_old_mbr |
| 客单价 | 人均消费金额 avg_mbr_price（注意：mall 表 sale_avg_price 是"销售单价"即件均价，非客单价；小时表 avg_ord_price 是笔单价） | new_old_mbr.avg_mbr_price |
| 连带率/人均消费笔数 | person_avg_cnt | brand_new_mbr.person_avg_cnt |
| 复购率 | reprch_rate（预计算） | new_old_mbr |
| 会员贡献率 | 会员销售金额占比，用预计算 cntrb_rate / mbr_ctb_rate | new_old_mbr / whole_sale |
| 坪效 | 销售坪效 sales_per_square_meter；营收坪效 revenue_per_square_meter | whole_sale |
| 回款率 | ord_cod_rate | whole_sale |
| 高端会员 | 由 high_mbr_range 区间字段界定（阈值待确认）；金卡=至臻金卡 is_gold_card | high_mbr_info / csmr_tag |
| 新客/新会员 | 分两级回答：①品牌新客=brand_new_mbr_cnt 系预计算；②明细判定用 whet_*_new_cst_ord 标记 | brand_new_mbr / mbr_sale_ord |
| 流失会员 | drain 系快照表；品牌维度用 brand_drain_rate；去向查 drain_drc | drain 系 |
| 沉睡/休眠 | 平均休眠周期 store_drain_avg / brand_drain_avg | drain 系 |
| 客流/进店人数 | entry_people_cnt；转化率 transfer_rate | cst_flow_hour |
| 车流 | entry_car_cnt；周转率 parking_turnover_rate | parking |
| 企微客户 | wechat_cst_cnt；新增 wechat_cst_inc_cnt | wechat_stats |
| 潜客 | is_stealer='是'（取值待确认） | csmr_tag |
| 投入产出比 | input_output_rate（预计算）；投入合计 input_total_amt | mbr_store_input |
| 贡献金额/实际贡献价值 | ctbtn_amt / actual_ctbtn_amt（口径差异待确认） | mbr_store_input |

---

## 3. 同义词/别名规则（Instructions 或列描述内覆盖）

| 用户说法 | 映射到 |
|----------|--------|
| 商场 / 商城 / mall / 百货 | 门店（store）或全域，默认全域=不按门店过滤 |
| 专柜 / 厅 / 厅房 / 铺位 | hall |
| 品牌 / 牌子 | brand_name |
| 品类 / 大类 / 中类 / 小类 | 分别对应 main/mid/sub_category，用户说"品类"默认=中类 mid_category |
| 楼层 / 楼栋 | floor_name / building |
| 柜组 | group_name |
| 商户 / 供应商 | business_name（商户）≠ supplier_name（供货商），勿混 |
| 会员 / VIP / 顾客（带消费） | mbr 系 |
| 钱 / 销售额 / 业绩 / 流水 | sale_amt |
| 去年今天 / 同比 / 同期 | _yoy 列或 last_year 表 |
| 环比 / 环期 | _mom 列 |
| 周末 / 节假日 / 大促日 | day_type + hol_name |
| 高端 / 高净值 / 大金卡 | high_mbr_range / is_gold_card |

---

## 4. 全局指令（Instructions，注入每次问数）

1. **时间默认规则**：用户未指定时间时，默认"最近一个完整自然日"（T-1），并在回答中声明所用时间。
2. **聚合防重规则**：ADS 表为预聚合表，禁止对同一粒度列重复 GROUP BY 导致翻倍；涉及"人数"类指标必须用预计算 cnt 字段，禁止 count(distinct) 与非明细表混用。
3. **金额口径规则**：用户说"销售"默认 sale_amt；出现"去券/净额/不含券"→ sale_uncpn_amt；"含税/去税"→ 用 sale_uncpn_taxout_amt。
4. **门店范围规则**：未指定门店=全部百货门店合计；单店问题必须带 store_name 过滤。
5. **周期表规则**：stats_period 为过滤条件而非分组维度；问"近一年"= stats_period='近一年'（或映射值，枚举待确认），不要自己拼日期区间。
6. **失效问法兜底**：涉及"为什么/建议/预测"类分析型问题，不下 SQL，走智能体分析链路并提示"该问题不支持直接取数"。

---

## 5. 待确认清单（阻塞项，上线前必须闭环）

| # | 问题 | 找谁 | 怎么确认 |
|---|------|------|----------|
| 1 | ~~DIM 12张表字段明细~~ **已解决**（重新解析成功，见1.2节）；DWS 2张表仍为嵌入图片 | 数据组建模同学 | 要原始设计文档或元数据导出；首批可不挂DWS |
| 2 | stats_period / stats_time 全部枚举值（日/月/季/年/近3月/近6月/近1年/近2年 为文档推断，存储值待验证） | 数据组 | 对每张周期表 `select distinct stats_period` |
| 3 | mbr_new_old 枚举取值；is_mbr/is_stealer/is_fans/is_gold_card/whet_* 实际存储值（Y/N还是1/0）——维度清单只给了业务定义 | 数据组 | distinct 查询截图留痕 |
| 4 | high_mbr_range 分段阈值、contribution 口径（ctbtn_amt vs actual_ctbtn_amt） | 数据组+运营 | 口径文档邮件确认 |
| 5 | 各表分区键与数据延迟（T+?） | 数据组 | `show partitions` + 调度平台截图 |
| 6 | WrenAI 0.13 业务术语/指令/样本对的配置上限与格式 | 平台侧 | 控制台实测 |

---
