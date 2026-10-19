---
name: bgbh-s2-member
skill_id: bgbh-s2-member
description: 百购商场会员经营取数。当用户询问会员规模、会员销售、会员贡献率、复购率、客单价、新老会员对比、高端会员/至臻金卡、会员销售排名、会员个人消费明细等问题时使用。触发词包括：会员、VIP、复购、客单价、会员贡献、会员销售、高端会员、金卡、至臻金卡等。注意：客单价属会员口径，不要与销售单价混淆。
version: "1.0.0"
category: department_store
tags:
  - 百购
  - 问数
  - 会员
  - 客单价
  - 复购率
  - bgbh-s2-member
source: package
status: active
timeout: 120
requires_approval: false
required_permissions:
  - iqd:ask:use
---

# S2 会员经营

## 触发与槽位

- 强触发词：会员、VIP、复购、客单价、会员贡献、会员销售、高端会员、金卡、至臻金卡
- 弱触发词：顾客、客人（需带消费类共现词）
- 槽位：时间（默认上月）｜门店｜新老（新/老/全部）｜会员层级（整体/卡类型/高端区间/个人oneid）｜指标

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

ads_trd_store_new_old_mbr_sale_df、ads_trd_store_mbr_sale_df、ads_csmr_store_high_mbr_info_df、ads_trd_mbr_hall_sale_d_df、ads_trd_mbr_sale_ord_d_df

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

- 规模贡献：`【S2】{时间} {门店} {新老}会员的{指标}`
- 对比：`【S2】{时间} {门店}新会员与老会员的销售金额、人数、客单价对比`
- 高端会员：`【S2】{时间} {渠道类型}高端会员（{高端区间}）的人数、销售金额、贡献率`
- 个人排名：`【S2】{时间} {门店}会员销售排名 Top{N}`（N≤50，默认20）
- 个人明细：`【S2】会员{oneid/手机号} {时间}在{门店}的消费厅房/订单明细`
- 同比：`【S2】{时间} {门店}会员销售{指标}及同期值` → 用 mbr_hall_sale_d 的 _yoy 列

## 口径路由

| 用户说法 | 落列 |
|----------|------|
| 客单价 | avg_mbr_price（new_old表）；禁止用 mall 表 sale_avg_price 替代 |
| 复购率/复购人数 | reprch_rate / reprch_cnt（预计算） |
| 贡献率 | cntrb_rate；高端会员用 high_mbr_ctbtn_rate |
| 客单/贡献"同比" | mbr_hall_sale_d 表 _yoy 列 |
| 高端会员 | high_mbr_range 区间过滤；金卡=至臻金卡标签（ads_csmr_csmr_tag.is_gold_card） |
| 会员人数 | mbr_cnt（预计算，禁止count distinct混算） |

## 回答模板

1. 结论先行：「{时间}{门店}会员销售{X}万元，贡献率{Y}%，客单价{Z}元。」
2. 明细表 + 同比列（有则带）。
3. 追问建议：「要不要拆{新老会员 / 各卡类型}看结构？」或「贡献下滑的会员是否有流失迹象？」（→S5串联）

## 追问链

会员贡献异常 → 新老拆分(S2) → 卡类型/高端结构(S2) → 流失名单(S5) → 个体下钻订单(S2 mbr_sale_ord_d)

## 降级与拒答

- 会员个人手机号/身份证/地址等敏感字段：不返回原文，话术「涉及会员隐私，仅提供消费汇总数据」。
- 非会员（散客）分析：当前仅企微潜客标签可近似，话术说明口径。
- "为什么会员不复购"：分析型，走背景取数+规则话术。

## 验收用例

| 问法 | 校验点 |
|------|--------|
| 上月会员贡献率多少 | new_old表，贡献率=预计算列 |
| 新会员和老会员客单价差多少 | mbr_new_old 分组对比 |
| 高端会员贡献率排名 | high_mbr_info + ctbtn_rate |
| 本店消费前20的会员 | store_mbr_sale sale_rn |
| 某会员最近一单买了什么 | mbr_sale_ord_d 订单下钻 |
| 会员销售同比如何 | _yoy 列而非日期函数 |
