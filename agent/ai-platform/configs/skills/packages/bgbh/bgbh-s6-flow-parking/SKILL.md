---
name: bgbh-s6-flow-parking
skill_id: bgbh-s6-flow-parking
description: 百购商场客流与停车取数。当用户询问门店或地点分时段进店人数、离开与滞留人数、客流转化率、进场离场车次、车位周转率、平均滞留时长、停车缴费金额与减免、线上缴费占比等问题时使用。触发词包括：客流、人流、进店、转化率、滞留、停车、车流、车位、缴费等。
version: "1.0.0"
category: department_store
tags:
  - 百购
  - 问数
  - 客流
  - 停车
  - 转化率
  - bgbh-s6-flow-parking
source: package
status: active
timeout: 120
requires_approval: false
required_permissions:
  - iqd:ask:use
---

# S6 客流车流

## 触发与槽位

- 强触发词：客流、人流、进店、客流时段、转化率、滞留、停车、车流、车位、缴费
- 弱触发词：人多不多、空不空
- 槽位：时间（默认昨日）｜**门店（必填）**｜地点（location级，缺省=门店全部地点）｜时段

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

ads_flow_cst_flow_hour_df、ads_flow_store_parking_d_df

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

- 分时客流：`【S6】{时间} {门店}{地点}分时段的进入/离开/滞留人数和转化率`
- 地点对比：`【S6】{时间} {门店}各地点转化率排名`
- 停车总览：`【S6】{时间} {门店}进出场车次、周转率、平均滞留时长`
- 缴费：`【S6】{时间} {门店}停车缴费金额、线上缴费占比、减免金额`

## 口径路由

| 用户说法 | 落列 |
|----------|------|
| 进店/进场人数 | entry_people_cnt / entry_car_cnt |
| 转化率 | transfer_rate（预计算） |
| 滞留 | strded_people_cnt / strded_car_cnt / avg_strded_hour_period |
| 周转率 | parking_turnover_rate |
| 线上占比 | online_pay_cnt_rate |
| 优惠/减免 | offline_treat_amt / remission_amt |

## 回答模板

1. 结论：「{门店}昨日进店{X}人次，高峰在{时段}，转化率{Y}%。」
2. 分时表/地点排名表。
3. 追问建议：「看{高峰时段的销售表现}？」（→S1串联）

## 降级与拒答

- 客流来源为汇纳/nec/银联三方，若用户质疑口径：话术「客流来自{来源}统计，与销售系统口径不同」。
- 单品/单柜客流：location粒度不支持时说明。

## 验收用例

| 问法 | 校验点 |
|------|--------|
| 昨天下午三点人多吗 | 时段槽位+门店 |
| 哪个入口转化率最高 | location 排名 |
| 停车场昨天周转几次 | parking_turnover_rate |
| 停车券减免了多少钱 | remission_amt |
