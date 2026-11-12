---
name: bgbh-s1-daily-report
skill_id: bgbh-s1-daily-report
description: 百购商场经营日报取数。当用户询问百货整体或门店/厅房/柜组/品牌/品类维度的销售额、销售笔数、毛利与毛利率、折扣率、优惠金额、销售单价、坪效、回款率、分时段销售、同比环比等经营日报类问题时使用。触发词包括：日报、经营、经营业绩、销售业绩、销售概况、卖了多少、营业额、流水、销售排名、坪效等。
version: "1.0.0"
category: department_store
tags:
  - 百购
  - 问数
  - 经营日报
  - 销售业绩
  - 坪效
  - bgbh-s1-daily-report
source: package
status: active
timeout: 120
requires_approval: false
required_permissions:
  - iqd:ask:use
---

# S1 经营日报

## 触发与槽位

- 强触发词：日报、经营、经营业绩、销售业绩、销售概况、卖了多少、营业额、流水、销售排名
- 弱触发词：销售、业绩（单独出现且无共现词时路由本技能）
- 槽位：时间（默认昨日T-1）｜门店（默认全部门店）｜层级（门店/厅房/柜组/部门/品牌/大类/中类/小类，默认门店）｜业态｜指标（默认销售金额+笔数）

## 依赖表（部署前置检查，不是运行时校验）

> **为什么不再是「SQL 校验、越表即拒答」**：本 Skill 运行在 Worker 侧，`iqd__ask` 在 `view=user` 下
> 已由 iqd 的 `ResponseProjector` 删除 `sql` / `sql_dialect` 键 —— **本层根本拿不到 SQL**，
> 无法解析表名做校验。保留这条约束只会得到一个永远不触发的死规则，还容易被误认为已有防护。
>
> 越表拦截的**真正落点**在 iqd 侧，两层硬执行（fail-closed）：
> ① catalog 的「纳入问数范围（in_scope）」+ `iqd_scope_policy`；② 表级 ACL。
>
> **本清单现在的三个用途**：
> 1. **上线前置检查**：下表须已在 iqd 管理面勾选 in_scope，否则本 Skill 取数只会报错、不会出数；
> 2. `iqd__ask` 的 `scope_hint` 候选值（该参数当前标注为「后台测试用」，常态启用待平台确认）；
> 3. 样本/SQL 训练对入库时的挂表依据。

ads_trd_mall_sale_d_df、ads_mall_trd_hall_sale_h_last_year_df、ads_csmr_store_brand_whole_sale_df

## 问句改写模板（传给 `iqd__ask` 的 `question`）

> **这份模板仍然有用，而且比原来更重要**——它产出的是规范问句，正是本 Skill 存在的理由。
> 变的是**投递对象**：不再直连 WrenAI，而是作为 `iqd__ask` 的 `question` 入参，由 iqd 编排层转交 WrenAI 消费。
>
> 调用要点：`iqd__ask(question=<本模板产出的规范问句>, connection_id=bg-data, thread_id=<追问时透传>)`。
> **必须显式传 `connection_id`**，缺省会回落到平台默认连接 → 查错库。
> 纪律口径：**不改变语义**；补全槽位与术语规范化属于允许范围（详见 `bgbh-router` §0）。
>
> ⚠️ **改写两条铁律**（详见 `bgbh-router` §0.7）：
> ① **保留中文业务词**（销售/门店/订单/客户），别改成英文列名——iqd 靠这些词给候选表打分；
> ② `【S#】` 前缀须与 `iqd_sql_pair` 样本库格式一致，两边不一致时前缀会帮倒忙。

- 总盘：`【S1】{时间} {门店}的{指标}（合计）`
- 排名：`【S1】{时间} {层级}的{指标}排名，取前{N}`（N默认10）
- 时段：`【S1】{时间} {门店}分时段的笔单价/去券金额`（→小时同期表）
- 坪效：`【S1】{时间} {门店}{品类}各品牌销售坪效/营收坪效排名`

## 口径路由

| 用户说法 | 落列 |
|----------|------|
| 销售/营业额/流水/业绩 | sale_amt |
| 净额/不含券/去券 | sale_uncpn_amt |
| 不含税/去税 | sale_uncpn_taxout_amt |
| 毛利 | sale_gross_profit（率用 sale_gross_profit_rate，勿重算） |
| 折扣/让利 | sale_discount_amt（率用 sale_discount_rate） |
| 优惠 | sale_treat_amt |
| 件单价/销售单价 | sale_avg_price（**不是客单价**，客单价→S2） |
| 坪效 | sales_per_square_meter（营收坪效 revenue_per_square_meter） |
| 同比/去年同期 | 优先 ads_mall_trd_hall_sale_h_last_year_df 或 _yoy 列 |

## 回答模板

按 `bgbh-router` 四层写，不要只给一句结论。

1. **现状**：时间、范围、指标、数值、所用列。例：「昨日（10-12）全部门店销售 386.5 万元（含券 sale_amt）。」全部门店合计时声明未剔除新开店。
2. **趋势**：有同期表或 `_yoy` 才写升降。没有则写「本次没有同比列」。
3. **原因**（用户问为什么才写，每条标待验证）：先看金额、件数、折扣率、去券是否同向。用户问销售为何变化时，再按路由取客流、转化率、笔单价；三数没齐就不要指定主因。不要按经营模式编码过滤。
4. **行动**：只给一个下钻。「要不要看各门店排名 / 折扣率最高的品牌 / 下午时段表现？」
5. **明细表**：TopN。金额用万元或亿元，并写单位。

## 追问链

日报总盘 → 门店排名(S1) → 单店厅房下钻(S1) → 品牌折扣异常(S1) → 会员结构(S2) → 流失风险(S5)

## 降级与拒答

- 用户问"今天实时"：数据T+1，话术「销售数据每日更新，目前最新为{最新日期}」。
- 库存/进货/线上订单：转总控路由拒答清单。
- 毛利类问题但表无数据：提示「该维度毛利暂未上线」。

## 验收用例

| 问法 | 校验点 |
|------|--------|
| 昨天卖了多少 | 默认T-1、全店、sale_amt |
| 这周各门店销售排名 | 周期=本周，group by store_name |
| 上月联营销售占比 | operate_mode 过滤联营，占比=联营/全部 |
| 国庆每天卖了多少 | 日期范围+hol_name |
| 昨天哪个时段卖得最好 | 走小时表 |
| 三楼昨天各厅房销售 | building/floor_name/hall_name |
