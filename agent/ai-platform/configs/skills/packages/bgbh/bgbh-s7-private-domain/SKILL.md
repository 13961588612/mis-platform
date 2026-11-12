---
name: bgbh-s7-private-domain
skill_id: bgbh-s7-private-domain
description: 百购商场私域运营与会员投入产出取数。当用户询问企微客户数与新增、导购名下企微客户、企微客户转化率、会员365天消费标签与品牌偏好、会员营销投入构成（券/停车/权益/积分/礼品）、投入产出比、会员贡献金额等问题时使用。触发词包括：企微、企业微信、私域、导购、投入产出、ROI、券投入、积分投入、权益投入、礼品投入、标签、画像等。涉及手机号等隐私字段必须脱敏。
version: "1.0.0"
category: department_store
tags:
  - 百购
  - 问数
  - 企微
  - 私域
  - ROI
  - bgbh-s7-private-domain
source: package
status: active
timeout: 120
requires_approval: false
required_permissions:
  - iqd:ask:use
---

# S7 私域与投入产出

## 触发与槽位

- 强触发词：企微、企业微信、私域、导购、投入产出、ROI、券投入、积分投入、权益投入、礼品投入、标签、画像
- 槽位：时间（默认上月）｜门店（默认全部门店）｜导购（问导购维度时必填）｜会员（个人标签/投入时填 oneid 或脱敏标识）｜指标

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

ads_csmr_wechat_cst_stats_d_df、ads_mall_csmr_wechat_cst_stats_df、ads_csmr_store_csmr_tag_df、ads_csmr_csmr_tag_df、ads_trd_mbr_store_input_d_df

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
> **脱敏注意**：本 Skill 涉及会员个人数据。iqd 侧已按 `iqd_mask_rule` 在唯一脱敏出口处理，
> 本层**不得**在 question 里夹带手机号等明文去反向检索。

- 企微盘子：`【S7】{时间} {门店}企微客户数与新增人数`（可切：会员/潜客、归属门店、来源门店）
- 导购：`【S7】{时间} {门店} 导购{姓名}名下企微客户数（会员/潜客）`
- 转化：`【S7】{时间} {门店}企微客户销售转化率`
- 标签：`【S7】会员{标识}近一年消费标签`（品牌/品类数、金额分段、偏好Top3、到店周期、购买间隔）
- 投入：`【S7】{时间} {门店}会员营销投入合计及构成（券/停车/权益/积分/礼品）`
- ROI：`【S7】{时间} {门店}投入产出比排名`

## 口径路由

| 用户说法 | 落列 |
|----------|------|
| 企微客户数/新增 | wechat_cst_cnt / wechat_cst_inc_cnt |
| 转化率 | cst_inc_cnt_rate（口径待确认，标注） |
| 365天消费标签 | consum_*_365d 系列 + consum_top1~3_brand_365d |
| 投入构成 | coupon/parking/equity/point/gift_input_amt |
| 投入产出比 | input_output_rate（预计算） |
| 贡献 | ctbtn_amt / actual_ctbtn_amt（口径差异待确认，回答时注明所用列） |

## 回答模板

1. 结论：「{门店}上月企微客户{X}人，新增{Y}人；会员营销投入{Z}万元，投入产出比{N}。」
2. 明细表 / 投入构成饼图建议。
3. 追问建议：「看投入产出比最差的门店？」「查某会员的365天消费标签？」

## 降级与拒答（本Skill敏感最多）

- 手机号/微信号/地址等：**一律脱敏**，话术「隐私字段不展示」。
- 券核销逐笔/积分逐笔明细：DWD不开放，话术「仅提供汇总口径」。
- "这个会员值不值得维护"：分析型，取标签数据后规则话术，不直接给结论性评分。

## 验收用例

| 问法 | 校验点 |
|------|--------|
| 各门店企微客户数 | wechat_stats_d 门店分组 |
| 导购小王上月加了多少客户 | owner_guide 过滤 |
| 会员近一年花了多少 | store_csmr_tag 金额分段+贡献 |
| 上月券投入多少 | coupon_input_amt 门店汇总 |
| 投入产出比最差的门店 | input_output_rate 排序 |
