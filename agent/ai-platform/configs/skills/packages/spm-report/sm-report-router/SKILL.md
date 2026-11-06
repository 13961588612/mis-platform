---
name: sm-report-router
skill_id: sm-report-router
description: 超市报表总控路由。意图与槽位（门店/时间/品类）确认后 skill() 下游；apiName 以下游 Skill 选用表为准。分析成文走 sm-shop-ops-*-report。
version: "3.2.0"
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
| `sm-shop-ops-comprehensive-report` | **综合分析成文**（整合分主题） |
| `sm-shop-ops-overview-report` | 经营总览 **主题**成文 |
| `sm-shop-ops-promo-report` | 促销专项 **主题**成文 |
| `sm-shop-ops-inventory-report` | 库存订货 **主题**成文 |

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
| S5 | 新品/重点/TOP/出清结构 | sale | `getProductLifecycleMix` |
| S6 | 经销联营租赁 | sale | `getVentureStructure` |
| S7 | 门店库存订货（仅周月） | sale → **inventory-report** | `getShopInventoryOverview` |
| R0 | 综合分析 / 全面诊断 / 经营数据综合报告 | sale(S1[+促销][+库存]) → **comprehensive-report** | 至少 `getShopSaleOverview` |
| P1 | 品类总览 | **category-sale** | `getShopCategoryOverview` |
| P2～P6 | 品类折扣/出清/分担/生命周期/经营方式 | category-sale | 见 category-sale「选用」 |
| P7 | 品类库存（仅周月） | category-sale | `getShopCategoryInventoryOverview` |
| X | 采购/财务总账/时段/坪效 | — | **拒答** |

### 1.1 成文 Skill 仲裁

| 用户说法 | 查数 | 成文 Skill |
|----------|------|------------|
| 综合分析 / 全面诊断 / 经营报告 / 综合报表 | 至少 S1；用户要「完整」时再补 S2～S4、S7 | `sm-shop-ops-comprehensive-report`（其内再 skill 分主题） |
| 经营总览 / 晨会指标 / 销售毛利损耗一起看 | S1 | `sm-shop-ops-overview-report` |
| 折扣 / 出清 / 供应商分担 / 促销专项 | S2/S3/S4 | `sm-shop-ops-promo-report` |
| 库存 / 滞销 / 缺货 / 周转 / 订货 | S7 | `sm-shop-ops-inventory-report` |

促销弱问（仅占比）→ S1 + overview-report（或综合里的总览节）。多主题硬拆两次问法时拆两次；「综合」走 R0 一次成文。

**主题（01）**：总览→S1；促销→S2/S3/S4；库存→S7/P7。晨会一轮 → **只 S1 一次** + overview 或 comprehensive（仅总览节）。同比/上期 → 同 apiName 再查对比期。空/notice **不**加载成文 Skill。

### 槽位矩阵

| 意图 | store | 时间 | 品类 |
|------|-------|------|------|
| M*/C1 | 否 | C1 要 year+period | M4 按接口 |
| S*/R0 | **是** | **是**（S7 仅 week/month） | 否 |
| P* | **是** | **是**（P7 仅 week/month） | 部门/柜组→`categoryLevel`；大中小类→**必须**`parentCategoryId` |

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
2. period：日/周/月；S7/P7 **只问周月**。  
3. **必须** `skill(sm-common-info-calendar)` 拉 ADS 清单（系统**有**周次与月度接口，勿拒答、勿公历自算）：

| `period` | 必调 `apiName` | 选中后写入销售 params |
|----------|----------------|------------------------|
| `day` | `listYearDates` | `startOrdDate`=`endOrdDate`=`ordDate` |
| `week` | `listYearWeeks` | `ordWeek`（原样） |
| `month` | `listYearMonths` | `ordMonth`（原样） |

S7/P7 不拉日清单；日清单不推荐今天及之后。  
4. 请选键；day→起止同日；**禁止**自算周序/月序；日 ≥ 今天 → 早停。

同比：再为同比期走一遍 1～4（或复用已确认店），同一 `apiName` 再查。

---

## 6. CAT（仅 P*）

| 意图 | 槽位 |
|------|------|
| 部门/柜组占比 | `categoryLevel`∈{部门,柜组} |
| 大/中/小类 | **必须** `parentCategoryId` |
| 下钻 | `parentCategoryId`；不清则 listCategories |

品类角色等场景默认大类时：`categoryLevel=大类`（见 category-sale）。

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
- [ ] 未传 identity/serviceName；截断未同参重试  
