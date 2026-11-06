---
name: sm-report-router
skill_id: sm-report-router
description: 超市报表总控路由。区域/门店/分类/日历/销售/毛利/损耗/促销/库存订货/品类结构问数须先加载：意图与槽位 → MCP 拉权限门店与 ADS 日周月供选择 → 槽位齐后再 skill() 下游并指定 apiName。
version: "2.3.0"
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

**只做编排**：意图 → 槽位（给操作员选）→ 下游 Skill。  
槽位未齐禁止 `callShopSaleApi` / `callShopCategorySaleApi`。  
禁止公历臆造 `ordWeek`/`ordMonth`；禁止用 `listStores` 代替权限校验。  
工具一律只传 `apiName` + `params`。

### 【早停】当日及之后（T+1，高于槽位流水线）

底层**不提供当天及之后**的经营日数据。命中则**立刻对用户说明并结束本轮**，禁止继续工具链：

- **禁止**：`listYearDates` / `listYearWeeks` / `listYearMonths`、权限门店循环、下游 sale / category-sale、同参重试。
- **命中**：用户说「今天/今日/当天」；或已落到的 `startOrdDate`/`endOrdDate` **任一 ≥ 今天（本地自然日）**；或周/月键覆盖区间的起点已晚于昨天（整段尚无出数）。
- **固定话术**（可原样用）：`经营数据为 T+1，不提供当天及之后的数据；请改查昨天或更早的日期/已出数的周月。`
- 「昨天/前天/具体历史日」及日历清单里已有的周月键 → 正常走 §5。

| skill_id | MCP | 职责 |
|----------|-----|------|
| `sm-common-info-master-data` | `callCommonInfoApi` | 区域/门店/权限门店/分类 |
| `sm-common-info-calendar` | `callCommonInfoApi` | 日/周/月 ADS 清单 |
| `sm-shop-sale` | `callShopSaleApi` | 门店经营总览与结构 |
| `sm-shop-category-sale` | `callShopCategorySaleApi` | 门店内品类结构 |

---

## 1. 意图

| 代号 | 特征 | 目标 |
|------|------|------|
| M1 | 有哪些区域 | master → `listAreas` |
| M2 | 我能看哪些店 | master → `listAuthorizedStores` |
| M3 | 全部在营店 / 某区域有哪些店 / 某店在哪个区域 | master → `listStores` |
| M4 | 分类维表/下级/某编号 | master → `listCategoryLevels` 等 |
| C1 | 某年有哪些天/周/月（不查销售） | calendar → `listYearDates/Weeks/Months` |
| S1 | 门店总盘：营业额/客单/会员/毛利/损耗/促销 | sale → `getShopSaleOverview` |
| S2～S6 | 折扣/出清/供应商/生命周期/经销联营 | sale → 对应 apiName（见 §7） |
| S7 | 门店库存/滞销/缺货/周转/订货/退货/交叉率 | sale → `getShopInventoryOverview`（**仅 week/month**） |
| P1～P6 | 门店内品类销售/结构 | category-sale → 对应 apiName |
| P7 | 品类库存/滞销/缺货/周转/订货/退货 | category-sale → `getShopCategoryInventoryOverview`（**仅 week/month**） |
| X | 采购合同/财务总账/未上线 MCP | **拒答**（库存订货走 S7/P7，勿拒） |

仲裁：有「部门/柜组/大中小类/品类占比」→ P\*；库存+品类词 → P7；库存无品类词 → S7；只说销售毛利无品类词 → S1；「我能看哪些店」→ M2；「有哪些门店」→ M3。多问拆两次，槽位复用。

### 分析主题映射（01 体系 · 勿再拆独立主题 Skill）

经营总览 / 促销 / 库存 **已由** `sm-shop-sale`（及品类对称时 `sm-shop-category-sale`）覆盖。  
**禁止**再新建 `sm-theme-overview` 之类 Skill 注入；只在本路由表选型 → `skill(sm-shop-sale|…)` → 下表 `apiName`。

| 01 主题 | 用户说法（例） | 路由 | apiName（sale；品类对称见 §7 P*） |
|---------|----------------|------|-----------------------------------|
| **经营总览** | 经营情况、营业额、客单、会员占比、毛利损耗促销一起看、日报 | **S1** | `getShopSaleOverview` |
| 经营总览·线上 | 线上/平台销售毛利 | S1 衍生 | `listOnlineSales`（日区间） |
| 经营总览·复购人数 | 复购会员人数 | S1 衍生 | `getRepurchaseSummary`（仅周月） |
| 经营总览·同比 | 较去年同期/同比 | **S1×2** | 同 apiName；日历取本期+同比期各查一次再对照 |
| **促销** | 折扣构成 | **S2** | `getDiscountStructure` |
| 促销 | 出清效率 | **S3** | `getClearanceEfficiency` |
| 促销 | 供应商促销分担 | **S4** | `getSupplierPromoShare` |
| 促销·弱 | 只问促销占比/促销毛利（无「折扣三列/出清/分担」） | **S1** 即可 | overview 内 promo* / coupon* |
| **库存** | 库存/滞销/缺货/周转/订货/退货 | **S7** | `getShopInventoryOverview`（仅周月） |
| 库存·品类 | 某大类库存… | **P7** | `getShopCategoryInventoryOverview` |

时段峰谷 / 坪效 → §9 暂不支持。店长晨会「销售+毛利+损耗+促销」一轮说清 → **只打 S1 一次**，勿拆四次 MCP。

### 槽位矩阵

| 意图 | store | 时间 | 品类 |
|------|-------|------|------|
| M*/C1 | 否 | C1 要 year+period | M4 按接口 |
| S* | **是**（单店 `storeId` 或明确 `areaId`） | **是**（S7 仅 week/month） | 否 |
| P* | **是** | **是**（P7 仅 week/month） | 部门/柜组→`categoryLevel`；大中小类→**必须**`parentCategoryId` |

---

## 2. 短路径（M*/C1）

`skill(master|calendar)` → 调对应 `apiName` → `notice`/`items=[]` 原样转述 → 表格回答。  
`listAuthorizedStores` 软失败：转述 notice，停。

---

## 3. 经营流水线（S*/P*）

```
意图+apiName → STORE → TIME → (P* 则 CAT) → skill(下游)+MCP → 回答
```

**一步一确认**；缺槽位只展示选项，本轮不调销售 MCP。已确认槽位写入会话板，用户未改则沿用。

会话板：`intent` / `storeId` / `year` / `period` / `ordWeek|ordMonth|start+end` / `categoryLevel|parentCategoryId` / `target_skill` / `target_apiName`

---

## 4. STORE（默认单店）

- 默认只查一家；未明确多店对比/汇总时禁止循环多店、禁止擅自挑第一家。
- 权限 ≥2 且未选定唯一店 → **必须列表请选**，本轮不调销售 MCP。

```
skill(sm-common-info-master-data)
→ callCommonInfoApi { "apiName":"listAuthorizedStores", "params":{} }
```

| 结果 | 动作 |
|------|------|
| `items=[]`+notice | 转述，停 |
| 恰好 1 家 | 复述将查该店，请确认或另选 |
| ≥2 家 | 表列门店号/名/区域，请回复门店号或名称 |

用户已口述店名仍先拉权限列表再匹配；不在列表 → 无权限+再列可选。  
区域汇总仅用户明确时写 `areaId`，勿瞎填 `storeId`。禁止改调 `listStores` 绕过权限。

---

## 5. TIME（顺序固定）

0. **先判当日及之后**（见文首【早停】）：命中则固定话术结束，**不要**进入下面 1～4。  
1. **year**：已给四位年→确认；今年/去年→换算后复述；未提→追问后停。  
2. **period**：日→`day`；周→`week`；月→`month`；未清→追问（S7/P7 **只问周/月二选一**，说明无日表）。  
3. **拉桶**：`skill(sm-common-info-calendar)` → `listYearDates|Weeks|Months` + `{year}`；空清单→换年/粒度，停。展示日清单时**不要**把今天及之后的公历日当成可选经营日推荐。S7/P7 **不要**拉日清单。  
4. **请选**：展示周键/月键/日期表；选定后 week→`ordWeek`，month→`ordMonth`，day→`startOrdDate`+`endOrdDate`（单日两端相同）。**禁止**公历自算周序。选定日若 ≥ 今天 → 回【早停】，禁止调销售 MCP。

---

## 6. CAT（仅 P*）

| 意图 | 槽位 |
|------|------|
| 各部门/柜组占比 | 仅 `categoryLevel`∈{部门,柜组} |
| 大/中/小类 | **必须** `parentCategoryId`；禁止裸传大中小类级别 |
| 某分类下钻 | `parentCategoryId`；不清则 `listCategories` 等 |

都缺则请选：①部门/柜组 ②父分类下钻（给名称或编号）。

---

## 7. 槽位齐后落地

1. `skill(target)`，`apiName` **从 Skill 正文原样复制**  
2. `params` 只含已确认槽位  
3. 调对应 MCP  

**sale / `callShopSaleApi`：** S1 `getShopSaleOverview`；S2 `getDiscountStructure`；S3 `getClearanceEfficiency`；S4 `getSupplierPromoShare`；S5 `getProductLifecycleMix`；S6 `getVentureStructure`；S7 `getShopInventoryOverview`  

**category-sale：** P1 `getShopCategoryOverview`；P2 `getShopCategoryDiscountStructure`；P3 `getShopCategoryClearanceEfficiency`；P4 `getShopCategorySupplierPromoShare`；P5 `getShopCategoryProductLifecycleMix`；P6 `getShopCategoryVentureStructure`；P7 `getShopCategoryInventoryOverview`  

示例：`{"apiName":"getShopSaleOverview","params":{"period":"month","storeId":"0021","ordMonth":"2026年-9月"}}`（月键以日历清单原样为准）

| 结果 | 动作 |
|------|------|
| 有数据 | §8 回答 |
| `items=[]`+notice | 转述 notice |
| 硬错误 | 业务语言说明，建议重试 |
| `Tool output truncated` | 用 summary/可见 items 作答，**禁止同参重调** |

---

## 8. 回答口径（对用户）

- 槽位阶段：选项表 + 请回复什么；无假数字。  
- 取数成功：一句结论 → Markdown 表 → 至多一句业务口径。  
- **禁止**写入 apiName/工具名/Skill/字段名；损耗勿说成「吃掉毛利」；禁止空口「与之前一致」。

---

## 9. 拒答与对比约定

采购合同 / 财务总账 / 未上线 MCP → 未开放。  
**时段峰谷 / 坪效 / 人效** → **暂不支持**（说明数据未开放，勿空查）。  
库存订货 → **走 S7/P7**，勿拒答。  
**同比 / 较去年同期**：不新开专用 API；在日历中选定**本期 + 同比期**时间键，**各查一次**同一 `apiName`，再对照作答（禁止臆造同比列）。  
WrenAI/NL2SQL（`spm-analyst`）本阶段**暂停**，超市问数一律本 Agent + MCP。百购 → 百购分析智能体。  
当天及之后的经营日 / 尚未出数的周月 → 【早停】固定话术，禁止空转工具链。

---

## 10. 取数前自检

- [ ] 未命中「当日及之后」早停（否则已结束、无 MCP）  
- [ ] 意图已归类；S/P 已确认单店（或多店已经用户明确）  
- [ ] year+period+时间键来自日历或已校验，且日键早于今天 
- [ ] P* 品类槽位正确；已 skill 下游且 apiName 来自正文  
- [ ] 未传 identity/serviceName；截断未同参重试  
