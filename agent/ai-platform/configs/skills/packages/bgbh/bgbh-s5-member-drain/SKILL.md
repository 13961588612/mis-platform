---
name: bgbh-s5-member-drain
skill_id: bgbh-s5-member-drain
description: 百购商场会员流失分析取数。当用户询问门店或品牌的会员流失人数与流失率、考核口径流失、流失会员名单与唤醒对象、品牌流失率三年对比、分层流失人数、流失会员去向Top10、平均休眠周期等问题时使用。触发词包括：流失、沉睡、休眠、唤醒、预警、流失率、流失人数、流失去向、多久没来等。注意：流失类问题必须锁定门店与快照日期，禁止跨快照累加。
version: "1.0.0"
category: department_store
tags:
  - 百购
  - 问数
  - 会员流失
  - 沉睡
  - 流失率
  - bgbh-s5-member-drain
source: package
status: active
timeout: 120
requires_approval: false
required_permissions:
  - iqd:ask:use
---

# S5 会员流失

## 触发与槽位

- 强触发词：流失、沉睡、休眠、唤醒、预警、流失率、流失人数、流失去向、多久没来
- 弱触发词：不消费、没动静（需含门店或会员对象共现词）
- 槽位：时间（默认最近快照日）｜**门店（必填，流失类禁止全店跑）**｜对象（会员整体/品牌/卡类型/高端区间）｜品牌（对象=品牌时必填）｜流失周期

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

ads_csmr_store_drain_analysis_d_df、ads_csmr_store_drain_assess_consum_d_df、ads_csmr_store_mbr_drain_df、ads_csmr_store_brand_drain_df、ads_csmr_store_drain_df、ads_csmr_store_brand_drain_drc_df

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
>
> **追问链专用**：S5-C → S5-D 等多步编排时传 `thread_id` 复用上下文，避免靠用户复述品牌/门店。

- 总览：`【S5】快照日{时间} {门店} {卡类型}会员各{流失周期}的流失人数和流失率`
- 高端：`【S5】快照日{时间} {门店} 高端会员（{高端区间}）流失分布`
- 考核：`【S5】{年份} {门店}考核口径流失人数和平均消费周期`
- 会员清单：`【S5】{门店} 最近消费距今天数超过年平均消费周期的会员清单`（→store_mbr_drain）
- 品牌流失：`【S5】{时间} {门店} {品牌}的品牌流失率（本期/去年/前年）及1~12月分层流失人数`
- 去向：`【S5】{时间} {门店} {品牌}流失会员去向Top10`

## 口径路由

| 用户说法 | 落表 |
|----------|------|
| 流失人数/流失率 | drain_analysis（drain_cnt/drain_rate） |
| 考核流失 | drain_assess（assess_drain_cnt）——唯一考核口径表 |
| 流失中会员名单 | store_mbr_drain：last_consum_days > avg_consum_period_y |
| 品牌流失率 | brand_drain：brand_drain_rate / _1y / _2y |
| 流失去向 | drain_drc：store_brand_drain_drc_1~10_name/cnt |
| 流失周期枚举 | 1月≤30天、2月=31~60天……一年以上>365天（维度字典A级） |

## 铁律

1. **快照表必须锁 snapshot_date**（默认取最大），禁止跨快照累加。
2. 门店槽位必填——流失考核涉及门店业绩，全店跑数无意义且量大。
3. "去向"问题只能走 drain_drc（流失口径），与 S4 输出关联（经营口径）区分。
4. 考核流失（`drain_assess`）在枚举与口径未签字前，回答里写明「不能当正式考核数」。不要用未确认的新老会员、高端区间存储值解释流失原因。

## 回答模板

1. 结论：「{门店}昨日高端会员流失37人，流失率4.2%，主要集中在{流失周期}。」
2. 明细表（清单类给脱敏会员标识+关键字段）。
3. 追问建议：「要不要导出{流失会员名单}？」「看{某品牌}流失会员去向？」

## 追问链

流失率总览(S5-A) → 高端/卡类型拆分(S5-A) → 会员级清单(S5-B) → 品牌流失(S5-C) → 去向Top10(S5-D) → 关联品牌召回建议(分析型话术)

## 降级与拒答

- 会员清单仅输出内部id/脱敏标识，禁输出手机号明文。
- 跨门店"全集团流失排名"：支持（analysis表group by store），但必须先确认时间快照。

## 验收用例

| 问法 | 校验点 |
|------|--------|
| 我们店流失严重吗 | 追问门店→drain_analysis 最近快照 |
| 金卡会员流失多少人 | 卡类型过滤+周期全量 |
| 今年考核流失多少 | drain_assess，年份槽位 |
| 哪些会员该唤醒了 | store_mbr_drain 超周期判定 |
| 耐克流失率三年对比 | brand_drain 三个率列 |
| 流失的人都去哪了 | drain_drc Top10 |
