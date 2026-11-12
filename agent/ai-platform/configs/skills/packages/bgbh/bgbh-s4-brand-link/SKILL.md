---
name: bgbh-s4-brand-link
skill_id: bgbh-s4-brand-link
description: 百购商场品牌关联（交叉购买）分析取数。当用户询问某品牌的关联品牌、买某品牌的人还买什么、客人在买某品牌之后流向哪些品牌、品牌对之间的关联度、品类与品类的关联购买时使用。触发词包括：关联、连带、交叉购买、交叉销售、导流、互补、还买、搭配买、一起买、流向等。注意：带“流失”字样的流失去向问题应改用 bgbh-s5-member-drain。
version: "1.0.0"
category: department_store
tags:
  - 百购
  - 问数
  - 品牌关联
  - 交叉购买
  - 连带
  - bgbh-s4-brand-link
source: package
status: active
timeout: 120
requires_approval: false
required_permissions:
  - iqd:ask:use
---

# S4 品牌关联

## 触发与槽位

- 强触发词：关联、连带、交叉购买、交叉销售、导流、互补、还买、搭配买、一起买、流向
- 注意：带“流失”字样的流失去向问题走 bgbh-s5-member-drain，不走本技能
- 槽位：时间（默认近一年）｜**门店（必填）**｜**品牌（必填）**｜方向（输入/输出/双向，默认输入）｜范围（同品类/全商场，默认全商场）

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

ads_csmr_brand_category_input_df、ads_csmr_brand_category_output_df、ads_csmr_brand_category_link_df、ads_csmr_category_link_df

## 关键认知（写进表描述与改写规则）

- **输入** = 消费统计品牌**之前**买的其他品牌（客流来源）。
- **输出** = 消费统计品牌**之后**买的其他品牌（客流去向）。
- input/output 两张是 **TopN宽表**：品牌名在列值（brand_name_top_1~5），WrenAI改写时必须落到「XX品牌的关联{输入|输出}品牌Top5及关联度」，禁止把它当普通维度表做group by。
- link 表是**关系对明细**（品牌×关联品牌一行），适合"某品牌对某品牌"双边问法。

## 问句改写模板（传给 `iqd__ask` 的 `question`）

> **这份模板仍然有用，而且比原来更重要**——input/output 是 TopN 宽表，语义层极易理解错，
> 规范问句是唯一能把它拉回正确结构的手段（见上一节「关键认知」）。
> 变的是**投递对象**：不再直连 WrenAI，而是作为 `iqd__ask` 的 `question` 入参，由 iqd 编排层转交 WrenAI 消费。
>
> 调用要点：`iqd__ask(question=<本模板产出的规范问句>, connection_id=bg-data, thread_id=<追问时透传>)`。
> **必须显式传 `connection_id`**，缺省会回落到平台默认连接 → 查错库。
> 纪律口径：**不改变语义**；补全槽位与术语规范化属于允许范围（详见 `bgbh-router` §0）。
>
> ⚠️ **改写两条铁律**（详见 `bgbh-router` §0.7）：
> ① **保留中文业务词**（销售/门店/订单/客户），别改成英文列名——iqd 靠这些词给候选表打分；
> ② `【S#】` 前缀须与 `iqd_sql_pair` 样本库格式一致，两边不一致时前缀会帮倒忙。

- `【S4】{时间} {门店} {品牌}的关联{输入|输出}品牌Top5及{同品类|全商场}关联度` → input/output表
- `【S4】{时间} {门店} {品牌A}与{品牌B}的输入/输出关联度和购买人数` → link表
- `【S4】{时间} {门店} {品类}品类与哪些品类关联购买最多` → category_link表

## 口径路由

| 用户说法 | 落列 |
|----------|------|
| 关联度 | brand_ratio_N_ctg（同品类）/ brand_ratio_N_store（全商场）/ ipt_link_ratio、opt_link_ratio（link表） |
| 购买人数 | ipt/opt/brand_person_cnt_link |
| 是否同类 | if_category |

## 回答模板

1. **现状**：门店、品牌、方向（输入或输出）、Top 品牌、人数。关联度必须写明分母：同品类（`brand_ratio_N_ctg`）或全商场（`brand_ratio_N_store`）；双边问法用 `ipt_link_ratio` / `opt_link_ratio`。
2. **趋势**：本表没有单独的同比列时写「本次没有同比列」，不要把占比说成比上期升高。
3. **原因**：只比较两个分母下的比例和人数。不解释「为什么会一起买」，也不说「关联很强」。
4. **行动**：「要反向看{品牌B}的关联品牌吗？」或「看{品牌}的客群画像？」（→S3）
5. 明细表 Top5（名称、人数、关联度、分母、是否同品类）。

## 降级与拒答

- 输出方向慎用于"流失去向"语境：带"流失"二字一律走S5（drain_drc表才是流失口径）。
- 问"为什么关联"：分析型，规则话术。

## 验收用例

| 问法 | 校验点 |
|------|--------|
| 买周大福的人还买什么 | 方向=输入，Top5宽表取列 |
| 玛丝菲尔的客人流向哪些品牌 | 方向=输出；无"流失"字样→本Skill |
| 耐克和阿迪关联度高吗 | link表双边过滤 |
| 女装和什么品类搭着卖 | category_link |
