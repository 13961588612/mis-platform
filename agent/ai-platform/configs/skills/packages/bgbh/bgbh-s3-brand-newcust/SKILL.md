---
name: bgbh-s3-brand-newcust
skill_id: bgbh-s3-brand-newcust
description: 百购商场品牌与新客分析取数。当用户询问品牌或品类的新客人数及同比、新客消费金额与客单价、品牌消费力金额分层、到店频次与复购率、品牌客群年龄性别画像等问题时使用。触发词包括：新客、拉新、新会员、品牌新客、品牌客群、品牌画像、品牌频次、消费力、复购率等。
version: "1.0.0"
category: department_store
tags:
  - 百购
  - 问数
  - 品牌
  - 新客
  - 拉新
  - bgbh-s3-brand-newcust
source: package
status: active
timeout: 120
requires_approval: false
required_permissions:
  - iqd:ask:use
---

# S3 品牌与新客

## 触发与槽位

- 强触发词：新客、拉新、新会员、品牌新客、品牌客群、品牌画像、品牌频次、复购率、消费力
- 弱触发词：品牌
- 槽位：时间（默认上月）｜**门店（必填，缺则追问）**｜**品牌（必填）**｜指标（默认新客人数）

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

ads_trd_brand_new_mbr_sale_df（品牌新客优先用本表）、ads_csmr_store_brand_trd_analysis_df、ads_csmr_store_brand_frq_analysis_df、ads_csmr_store_brand_attribute_analysis_df、ads_csmr_store_brand_whole_sale_df

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

- 新客：`【S3】{时间} {门店} {品牌}的品牌新客人数及同比`（指标换：新客消费金额/新客客单价/新客笔数/人均笔数）
- 品类视角：`【S3】{时间} {门店} {品类}品类新客人数及与门店品类中位数差异`
- 消费力：`【S3】{时间} {门店} {品牌}消费人数最多的金额段及各段占比`
- 频次：`【S3】{时间} {门店} {品牌}的品牌复购率及到店天数分段人数`
- 画像：`【S3】{时间} {门店} {品牌}客群年龄结构/性别占比`

## 口径路由

| 用户说法 | 落列 |
|----------|------|
| 新客人数 | brand_new_mbr_cnt（前年 last_2y / 去年 last_y / 本期） |
| 新客同比 | _yoy 后缀列（预计算） |
| 金额分段 | brand_amt_range_person_cnt_1~7：1=<3千 2=3-5千 3=5千-1万 4=1-2万 5=2-3万 6=3-5万 7=≥5万 |
| 频次分段 | brand_frq_range_person_cnt_1~8：到店1~8天，8=8天及以上 |
| 复购率 | brand_reprch_rate（三年：_last_y/_last_2y） |
| 年龄分段 | 1=<25 2=26-35 3=36-45 4=46-55 5=56-65 6=≥66 |

## 回答模板

1. 结论：「{门店}{品牌}上月新客{X}人，同比{+/-Y}%；新客客单价{Z}元。」
2. 明细表（分层问题给全分段表，标注占比）。
3. 追问建议：「要不要看该品牌的{客群画像 / 关联品牌}？」（关联→S4）

## 追问链

新客下滑(S3) → 客群画像(S3) → 关联品牌(S4) → 品牌流失(S5-C) → 流失去向(S5-D)

## 降级与拒答

- 品牌名模糊（音近/别名）：先列候选品牌请用户确认，禁止猜测查询。
- 多品牌对比（≤5个）：支持，改写为品牌集合过滤。
- "新客为什么少"：分析型，取数后规则话术。

## 验收用例

| 问法 | 校验点 |
|------|--------|
| 玛丝菲尔上月新客多少 | 品牌名精确匹配，brand_new_mbr_cnt |
| 女装品类哪个品牌拉新最猛 | mid_category 过滤+排序 |
| 周大福客人消费力在什么水平 | 金额分段占比表 |
| 雅戈尔客群都是什么人 | 年龄/性别占比 |
| 某品牌复购率三年趋势 | brand_reprch_rate 三个年度列 |
