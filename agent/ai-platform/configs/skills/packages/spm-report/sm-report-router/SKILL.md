---
name: sm-report-router
skill_id: sm-report-router
description: 超市报表总控路由。意图与槽位（门店/时间/品类）确认后 skill() 下游；apiName 以下游 Skill 选用表为准。分析成文走 sm-shop-ops-*-report。
version: "3.7.0"
category: supermarket
tags:
  - 超市
  - 总控路由
  - 槽位
  - sm-report-router
source: package
status: active
timeout: 90
requires_approval: false
required_permissions:
  - spm:report:read
---

# 超市报表总控路由（sm-report-router）

**只做编排**：意图 → 槽位 → `skill(下游)`。  
**不做**：apiName 字段说明书（见 `sm-shop-sale` / `sm-shop-category-sale`）。禁止主题 Skill **重复注入 apiName**。  
**成文**：查数成功后按 §1.1 加载 `sm-shop-ops-*-report`（解读 Skill **禁止**再调销售 MCP）。

槽位未齐禁止销售/品类 MCP。禁止公历臆造周月键；禁止用 `listStores` 代替权限。工具只传 `apiName` + `params`。

### 【早停】T+1（高于槽位流水线）

不提供当天及之后经营日。命中则固定话术结束，禁止日历/权限/下游 MCP：

`经营数据为 T+1，不提供当天及之后的数据；请改查昨天或更早的日期/已出数的周月。`

命中：用户说今天/今日/当天；或 `startOrdDate`/`endOrdDate` 任一 ≥ 今天；或周月键起点已晚于昨天。

| skill_id | 职责 |
|----------|------|
| `sm-common-info-master-data` | 区域/门店/权限/分类 |
| `sm-common-info-calendar` | 日/周/月清单 |
| `sm-shop-sale` | 门店经营/促销/库存等 **查数** apiName |
| `sm-shop-category-sale` | 品类结构/库存等 apiName |
| `sm-shop-ops-comprehensive-report` | **综合分析成文**（拼装；章序见其正文） |
| `sm-shop-ops-overview-report` | 主题一 经营总览成文 |
| `sm-shop-ops-category-report` | 主题二 品类管理成文 |
| `sm-shop-ops-promo-report` | 主题三 促销专项成文（门店） |
| `sm-shop-ops-margin-report` | 主题四 毛利与损耗专项成文 |
| `sm-shop-ops-inventory-report` | 主题五 库存订货成文（门店） |

---

## 1. 意图 → 下游

| 代号 | 特征 | target_skill | 选用提示（apiName 在下游 Skill） |
|------|------|--------------|----------------------------------|
| M1 | 有哪些区域 | master | `listAreas` |
| M2 | 我能看哪些店 | master | `listAuthorizedStores` |
| M3 | 在营店/区域门店 | master | `listStores` |
| M4 | 分类维表/下级 | master | `listCategoryLevels` 等 |
| C1 | 某年有哪些天 / 周次 / 月度 | calendar | 按粒度三选一：`listYearDates` / `listYearWeeks` / `listYearMonths` |
| S1 | 经营总览（营业额/客单/毛利损耗促销一起） | **sale** → **overview-report** | `getShopSaleOverview` |
| S1a | 线上分平台 | sale | `listOnlineSales` |
| S1b | 复购人数 | sale | `getRepurchaseSummary` |
| S2 | 折扣三列 | sale → **promo-report** | `getDiscountStructure` |
| S3 | 出清效率 | sale → **promo-report** | `getClearanceEfficiency` |
| S4 | 供应商促销分担 | sale → **promo-report** | `getSupplierPromoShare` |
| S5 | 新品/重点/TOP/出清结构 | sale → 表答或并入 **category-report**「生命周期」 | `getProductLifecycleMix` |
| S6 | 经销联营租赁 | sale → 表答或并入 **category-report**「经营方式」 | `getVentureStructure` |
| S7 | 门店库存订货（仅周月） | sale → **inventory-report** | `getShopInventoryOverview` |
| S8 | 毛利瀑布 | sale → **margin-report** | `getMarginWaterfall` |
| S9 | 生鲜占比/盈亏 | sale → **margin-report** | `getFreshOverview` |
| S10 | 低毛利预警（仅周月） | sale → **margin-report** | `getLowMarginAlert` |
| R0 | 综合分析 / 全面诊断 / 经营数据综合报告 | 见 §1.3 查数预算 → **comprehensive-report** | 至少本期 S1；完整见 §1.3 |
| P1 | 品类总览 | **category-sale** → **category-report** | `getShopCategoryOverview` |
| P2～P4 | 品类折扣/出清/分担 | category-sale → **category-report**（一句/轻量节） | 见 category-sale；**勿默认走 promo** |
| P5～P6 | 品类生命周期/经营方式 | category-sale → **category-report** | 见 category-sale「选用」 |
| P7 | 品类库存（仅周月） | category-sale → **category-report**（库存要点） | `getShopCategoryInventoryOverview` |
| P8 | 类目角色四象限 | category-sale → **category-report** | `getShopCategoryRoleMatrix` |
| P9 | 类目 ABC | category-sale → **category-report** | `getShopCategoryAbc` |
| X | 采购/财务总账/时段/坪效 | — | **拒答** |

### 1.1 Ops 成文关系（权威）

```
                    ┌── sm-shop-ops-comprehensive-report ──┐
                    │  拼装（不查数）；章序见 comprehensive   │
                    └──────────┬───────────────────────────┘
       ┌───────────┬──────────┼──────────┬──────────┐
   overview    category     promo     margin   inventory
   (主题一)    (主题二)    (主题三)   (主题四)   (主题五)
      S1      P1/P5～P9   S2～S4    S8～S10      S7
              (+P2～P4轻)            (深拆)
```

| Skill | 只做什么 | 不做什么 |
|-------|----------|----------|
| **comprehensive** | 按章序 `skill()` 分主题拼一份 | 不查数；用户只要单主题时**不走**本 Skill |
| **overview** | 晨会总览：销售+轻量毛利损耗+促销占比；可带 S1a/S1b 轻量句 | 不做瀑布/生鲜专项/低毛利深拆；不做促销三列深拆 |
| **category** | 品类结构/四象限/ABC/生命周期/经营方式；P2～P4、P7 轻量节 | 不做门店促销专项全文；不做门店库存总览全文 |
| **promo** | **仅**用户明确「促销专项/折扣三列/出清/供应商分担」且为**门店** S2～S4 | 不接 P2～P4（品类侧默认进 category）；弱问占比走 overview |
| **margin** | 瀑布/生鲜盈亏/低毛利专项 | 不接晨会「毛利损耗两列表」（那是 overview） |
| **inventory** | **门店**库存订货总览（周月） | 不接 P7（品类库存进 category） |

### 1.2 成文仲裁

| 用户说法 | 查数 | 成文 Skill |
|----------|------|------------|
| 综合 / 全面诊断 / 经营报告 | 见 §1.3（完整＝本期月全套 + 上月对照） | `comprehensive-report` |
| 经营总览 / 晨会 | S1（可附 S1a/S1b） | `overview-report` |
| 品类管理 / 结构 / 四象限 / ABC | P1[+P8][+P9][+P5/P6]；P2～P4 有数则轻量并入 | `category-report` |
| 促销专项 / 折扣三列 / 出清 / 分担（门店） | S2/S3/S4 | `promo-report` |
| 毛利瀑布 / 生鲜盈亏 / 低毛利 / 毛利损耗**专项** | S8[+S9][+S10] | `margin-report` |
| 库存 / 滞销 / 缺货 / 周转 / 订货（门店） | S7 | `inventory-report` |

**硬规则**：

1. 单主题问法 → **只**加载对应主题 Skill，禁止 comprehensive。  
2. 晨会毛利损耗表 → **overview**；专项深拆 → **margin**。  
3. 促销弱问（仅占比）→ S1 + overview；品类 P2～P4 → **category** 轻量，**禁止**默认 promo。  
4. 门店 S5/S6 → 表答，或并入 category「生命周期/经营方式」；品类 P5/P6 同。  
5. S1a/S1b → overview 轻量句或表答，不新开成文 Skill。  
6. 多主题硬拆两次问法 → 拆两次；「综合」→ R0 一次。  
7. 空/notice → **不**加载成文 Skill。品类会默认大类。  
8. **完整综合 / 按周对比查数预算 → 必须遵守 §1.3**（防打满 max_turns）。

### 1.3 完整综合 & 按周对比（查数预算 · 强制）

> 背景：一次「上月完整综合 + 按周全 API 扫」会打满 `max_turns=100` 仍不成文。下列为**硬上限**。

#### A. 「完整综合 / 全面诊断 / 经营数据综合报告」默认

| 项 | 规则 |
|----|------|
| **本期粒度** | 用户说上月/本月/月报 → **`period=month`**；说上周/本周 → week；未指明且要「完整」→ **默认月** |
| **对照** | **默认只加一期对照**：上月↔再上一月，或本周↔上一周（同 apiName **再查 1 次**） |
| **本期查数（完整）** | 每 apiName **只查本期 1 次**：S1 + S2～S4 + S7 + S8～S10 + P1[+P8/P9]（P5/P6 可选） |
| **对照查数** | 对上述同一批 apiName，用对照月/周键 **各再查 1 次**（合计约 2×N，禁止更多） |
| **禁止** | 为「完整」再拆成月内每一周去扫 S2～S10 / P* / 库存 |

#### B. 「按周对比 / 周趋势 / 各周对比」默认

| 项 | 规则 |
|----|------|
| **只比 S1** | 仅 `getShopSaleOverview`：对目标月内各周（或用户点名的周）各查 **1 次** |
| **禁止** | 按周循环调用 S2～S10、P1～P9、库存、复购、线上明细等 |
| **与完整综合同现** | 深拆主题仍按 **A（月粒度本期+上月）**；周对比 **额外只加 S1 各周**，写在总览章「分周走势」 |

#### C. 自检（进成文前）

- [ ] 未对非 S1 接口做「一周一轮」循环  
- [ ] 完整综合对照期 ≤ 1 期  
- [ ] 有数后再 `skill(comprehensive)`；禁止边查边无限加周

### 槽位矩阵

| 意图 | store | 时间 | 品类 |
|------|-------|------|------|
| M*/C1 | 否 | C1 要 year+period | M4 按接口 |
| S*/R0 | **是** | **是**（**S7/S10** 仅 week/month） | 否 |
| P* | **是** | **是**（P7 仅 week/month；P8/P9 默认大类） | 部门/柜组→`categoryLevel`；大中小类→**必须**`parentCategoryId` |

会话板：`intent` / `storeId` / `year` / `period` / 时间键 / 品类槽 / `target_skill` / `target_apiName` / `report_skill`

---

## 2. 短路径（M*/C1）

`skill(master|calendar)` → 下游选用表中的 `apiName` → notice/空表转述 → 回答。

用户只问「有哪些周 / 月度清单 / 某年周次」→ **C1**，必须 `skill(sm-common-info-calendar)` 后调对应接口，**禁止**说系统没有周/月数据。

| 用户问法 | `apiName` |
|----------|-----------|
| 有哪些天 / 日期清单 | `listYearDates` |
| 有哪些周 / 周次 / 第几周 | `listYearWeeks` |
| 有哪些月 / 月度清单 | `listYearMonths` |

---

## 3. 经营流水线（S*/P*/R0）

```
意图 → STORE → TIME → (P* 则 CAT) → skill(sale|category-sale) → apiName → MCP
  →（有数）skill(对应 sm-shop-ops-*-report) → 成文
  →（R0）skill(comprehensive) → 再 skill 分主题 → 拼装
```

一步一确认；缺槽只展示选项，本轮不调销售 MCP。已确认槽位沿用至用户改口。

---

## 4. STORE

默认单店；未明确多店时禁止循环多店、禁止擅自挑第一家。权限 ≥2 且未选定 → **必须列表请选**。

```
skill(sm-common-info-master-data)
→ listAuthorizedStores
```

| 结果 | 动作 |
|------|------|
| 空+notice | 转述，停 |
| 1 家 | 复述确认 |
| ≥2 | 表列请选 |

口述店名仍先权限匹配；不在列表 → 无权限。区域汇总仅用户明确时用 `areaId`。禁止改调 `listStores` 绕权。

---

## 5. TIME

0. 先判 T+1 早停。  
1. year → 确认或追问。  
2. period：日/周/月；S7/S10/P7 **只问周月**。  
3. **必须** `skill(sm-common-info-calendar)` 拉 ADS 清单（系统**有**周次与月度接口，勿拒答、勿公历自算）：

| `period` | 必调 `apiName` | 选中后写入销售 params |
|----------|----------------|------------------------|
| `day` | `listYearDates` | `startOrdDate`=`endOrdDate`=`ordDate` |
| `week` | `listYearWeeks` | `ordWeek`（原样） |
| `month` | `listYearMonths` | `ordMonth`（原样） |

S7/P7 不拉日清单；日清单不推荐今天及之后。  
4. 请选键；day→起止同日；**禁止**自算周序/月序；日 ≥ 今天 → 早停。

同比 / 上期：再为对照期走一遍 1～4（或复用已确认店），同一 `apiName` 再查。  
**完整综合 / 按周对比**：对照范围与可循环接口以 **§1.3** 为准（完整＝本期+上期各 1 次全套；按周＝仅 S1）。

---

## 6. CAT（仅 P*）

| 意图 | 槽位 |
|------|------|
| 部门/柜组占比 | `categoryLevel`∈{部门,柜组} |
| 大/中/小类 | **必须** `parentCategoryId` |
| 下钻 | `parentCategoryId`；不清则 listCategories |

品类角色 / ABC 等场景默认大类时：`categoryLevel=大类`（见 category-sale）。

---

## 7. 落地

1. `skill(sm-shop-sale|sm-shop-category-sale|master|calendar)`  
2. **`apiName` 必须从该 Skill「选用」表原样复制**  
3. `params` 仅已确认槽位  
4. **有数据** → 按 §1.1 `skill(sm-shop-ops-*-report)`；解读 Skill **禁止**再调销售 MCP  

| 结果 | 动作 |
|------|------|
| 有数据 | 加载对应成文 Skill |
| 空+notice | 转述；**不**加载成文 Skill |
| 硬错 | 业务语言 |
| truncated | 用可见部分；**禁止同参重试** |

---

## 8. 回答

槽位阶段：选项表、无假数。  
成文：以对应 `sm-shop-ops-*-report` 为准。  
无成文 Skill 的意图：结论 → 表 → 至多一句口径。  
禁止暴露 apiName/工具名/Skill/字段名；损耗勿说「吃毛利」。

---

## 9. 拒答

采购/财务总账/未上线 MCP；**时段峰谷 / 坪效 / 人效**暂不支持。  
库存走 S7/P7。`spm-analyst` 暂停。百购 → 百购分析智能体。

---

## 10. 自检

- [ ] 未命中 T+1 早停  
- [ ] S/P/R0 店与时间（及 P 品类）已确认  
- [ ] 时间键来自日历；apiName 来自下游正文  
- [ ] 成文 Skill 与 §1.1 一致；空结果未加载成文  
- [ ] R0/完整综合遵守 §1.3：本期+上期，未按周扫非 S1  
- [ ] 「按周对比」仅 S1；未传 identity/serviceName；截断未同参重试  
