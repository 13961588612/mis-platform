---
name: sm-shop-sale
description: 超市门店销售（经营总览 + 库存订货 + 线上明细/复购 + 折扣/出清/供应商分担/生命周期/经营方式 + 毛利瀑布/低毛利预警/生鲜占比盈亏）。当用户询问营业额、客单、会员/线上平台销售毛利、复购人数、前台/综合毛利、毛利瀑布、低毛利预警、生鲜销售占比、生鲜盈亏、损耗、促销、库存、滞销、缺货、周转、订货验收、退货、交叉率、折扣结构、出清、供应商促销分担、新品/重点/TOP、经销联营租赁时触发。品类结构请用 sm-shop-category-sale Skill。
---

# 门店销售（sm-shop-sale）

通过 MCP 工具 **`callShopSaleApi`** 查询。只传 **`apiName`** + **`params`**；**不要传 `serviceName` / `identity`**。

品类见 Skill **`sm-shop-category-sale`**（工具 `callShopCategorySaleApi`）。

---

## MCP 与公共入参

- MCP 服务名：**`mcp-sm-api-suite`**
- 工具：**`callShopSaleApi`**
- `items` **一律按门店**汇总，含 `storeId` / `storeName`
- 周/月键优先用日历 Skill `listYearWeeks` / `listYearMonths`；日报日清单用 `listMonthDates`（禁止默认 `listYearDates`）

| 字段 | 何时必填 | 说明 |
|------|----------|------|
| `period` | 始终 | `"day"` / `"week"` / `"month"` |
| `storeId` | 与 `areaId` 二选一 | 单店 |
| `areaId` | 与 `storeId` 二选一 | 区域（权限门店 ∩ 区域） |
| `startOrdDate` + `endOrdDate` | **仅 day** | `YYYY-MM-DD` 闭区间 |
| `ordWeek` | **仅 week** | ADS 周键 |
| `ordMonth` | **仅 month** | ADS 月键如 `"2026-10"` |
| `shopLevel` | 否 | 店型过滤 |

**返回信封：** `meta` / `summary` / `items[]`（按门店一行）

> 权限软失败（人员找不到 / 无门店权限 / 指定店不在权限内）：**不抛错**，`items=[]`，`meta.notice` 为提示文案，请把 `notice` 转述给用户。

### 对用户展示单位（强制；接口原值仍为元）

| 类型 | 展示 |
|------|------|
| **金额**（营业额/去券/主营/毛利额/损耗额/促销额/折扣额/库存额/订货验收退货额等，**不含客单价**） | 元 ÷ 10000 → **万元**，**保留 2 位小数**，后缀 `万元` |
| **客单价** `ticketPrice` / `onlineTicketPrice` | 仍为 **元**，保留 2 位小数，后缀 `元` |
| 客单数 / 人数 / SKU 数 | 整数 |
| 比率 / 占比 | 百分数（展示时按需 ×100）或接口已是比率则按 Skill 字段说明 |

未经 `sm-shop-ops-*-report`、直接口头/表格式回答时也须遵守上表。成文报告以对应 ops-report Skill 为准（规则一致）。

---

## 选用（router 代号 → apiName；权威在本表）

由 `sm-report-router` 确认槽位后加载本 Skill，**按下表复制 apiName**。

| router | 意图 | apiName |
|--------|------|---------|
| **S1** | 经营总览（销售+毛利+损耗+促销；**仅查数**） | `getShopSaleOverview`（主题成文 → overview-report；日/周/月综合 → diary/week/month-report） |
| **S1a** | 线上分平台/类目销售毛利 | `listOnlineSales`（`startSaleDate`+`endSaleDate`） |
| **S1b** | 复购会员人数 | `getRepurchaseSummary`（**仅 week/month**） |
| **S2** | 折扣三列 | `getDiscountStructure` |
| **S3** | 出清效率 | `getClearanceEfficiency` |
| **S4** | 供应商促销分担 | `getSupplierPromoShare` |
| **S5** | 新品/重点/TOP/出清结构 | `getProductLifecycleMix`（表答或并入 `sm-shop-ops-category-report` 生命周期） |
| **S6** | 经销/联营/租赁 | `getVentureStructure`（表答或并入 category-report 经营方式） |
| **S7** | 门店库存/滞销/缺货/周转/订货/退货/交叉率 | `getShopInventoryOverview`（**仅 week/month**） |
| **S8** | 毛利瀑布（成本→前台→后台调整→综合） | `getMarginWaterfall`（成文 → `sm-shop-ops-margin-report`） |
| **S9** | 生鲜占比/盈亏（类目 id 以 1 开头） | `getFreshOverview`（成文 → `sm-shop-ops-margin-report`） |
| **S10** | 低毛利预警（低毛利率主营销售） | `getLowMarginAlert`（**仅 week/month**；成文 → `sm-shop-ops-margin-report`） |
| — | 品类结构 | Skill **`sm-shop-category-sale`** |

**日粒度硬禁止**：`period=day` **不得**调用 `getShopInventoryOverview` / `getLowMarginAlert` / `getRepurchaseSummary`。校验失败后 **禁止**改 `period=week` 重试来填日报；缺节声明「仅支持周/月」。同一期多个 apiName **同一轮并行**。

---

## `listOnlineSales` — 线上明细销售毛利

读 `ads_spm_trd_xsjlhz_onlineitem_df`（按日 `sdate`，**不是** `ord_date`）。

```json
{ "apiName": "listOnlineSales", "params": {
  "storeId": "6001",
  "startSaleDate": "2026-10-01",
  "endSaleDate": "2026-10-07",
  "groupBy": "platformStore"
}}
```

| 参数 | 说明 |
|------|------|
| `startSaleDate` + `endSaleDate` | 必填，`YYYY-MM-DD` 闭区间 |
| `groupBy` | 可选，默认 `platformStore`；另有 `platform` / `mainCategory` / `midCategory` |
| `platform` | 可选，按平台名过滤 |

| 字段 | 含义 |
|------|------|
| `platform` / `storeId` / `storeName` | 分组维（随 groupBy 有值或 null） |
| `mainCategoryId/Name` / `midCategoryId/Name` | 类目维（类目分组时有值） |
| `qty` / `saleAmt` / `saleAmtExTax` | 数量 / 含税销售 / 去税销售 |
| `costAmt` / `costAmtExTax` / `marginAmt` / `marginAmtExTax` / `marginRate` | 成本与毛利（`marginRate=marginAmt/saleAmt`） |

---

## `getRepurchaseSummary` — 复购会员人数

读 `ads_spm_trd_csmr_category_{week,month}_df`，`data_type='门店'`；`rep_cust` CAST 后 SUM。  
**仅 week/month**；**日报禁止调用**。

```json
{ "apiName": "getRepurchaseSummary", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```

| 字段 | 含义 |
|------|------|
| `repCustCnt` | 复购会员人数 |

> 复购漏斗（1 次 vs ≥2 次等）属阶段 6，不在本接口。

---

## `getShopInventoryOverview` — 门店库存订货总览

库存 + 滞销 + 缺货 + 周转 + 订货/验收 + 退货 + 交叉率，**一次返回**。  
**仅 `period=week|month`**（无 day 表）。**日报 / `period=day` 禁止调用本接口**，即使综合报告缺库存章。

```json
{ "apiName": "getShopInventoryOverview", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```

| 字段 | 含义 / 口径 |
|------|-------------|
| `invAmtExTax` / `slowMovingInvAmtExTax` / `slowMovingShare` | 库存 / 滞销 / `zx/hj` |
| `stockoutSkuCnt` / `stockoutSkuDenom` / `stockoutRate` | 缺货分子分母 / 率 |
| `cogsExTax` / `invAmtExTaxNum` / `periodDays` / `turnoverDays` / `turnoverRate` | 成本 / 周转分子库存 / 天数 / 周转天 / `bhsxscb/kcbhsje`（分母 0→null） |
| `orderAmt` / `receiveAmt` / `orderReceiveGapRatio` | 订货 / 验收 / `(dd-ys)/dd`（dd=0→null） |
| `returnAmtExTax` / `returnRate` | 退货 / `th/hj` |
| `frontMarginAmtExTax` / `mainSaleAmt` / `frontMarginRateExTax` / `crossRate` | 去税前台毛利 / 主营 / 毛利率 / `毛利率×周转率` |

---

## `getShopSaleOverview` — 门店总览（查数）

销售 + 毛利损耗 + 促销 **同条件一次返回**。  
**解读 / 同比上期 / 异常成文** 不在本 Skill，见对应 ops-report（总览 overview；日报 diary；周报 week；月报 month）。

```json
{ "apiName": "getShopSaleOverview", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```


### 销售

| 字段 | 含义 |
|------|------|
| `turnoverAmt` / `netSalesAmt` / `mainSaleAmt` / `qty` | 营业额 / 去券 / 主营 / 销量 |
| `ticketCount` / `ticketPrice` | 客单数 / 客单价 |
| `memberCustCnt` / `memberTurnoverAmt` / `memberTurnoverRatio` | 会员人数 / 会员营业额 / 占比 |
| `onlineTicketCount` / `onlineTicketPrice` / `onlineQty` / `onlineMainSaleAmt` / `onlineSalesRatio` | 线上指标 |

### 毛利

| 字段 | 含义 |
|------|------|
| `frontMarginAmt` / `frontMarginAmtExTax` | 前台毛利含税 / 不含税 |
| `comprehensiveMarginAmt` / `comprehensiveMarginAmtExTax` | 综合毛利含税 / 不含税 |
| `frontMarginRate` / `comprehensiveMarginRate` | 前台 / 综合毛利率（分母=**营业额** `turnoverAmt`） |
| `frontMarginRateExTax` | 前台毛利率（去税）= `frontMarginAmtExTax / mainSaleAmt`（分母=**主营**） |

### 损耗

| 字段 | 含义 |
|------|------|
| `lossAmtTax` / `lossAmtExTax` / `lossAmtAbs` | 损耗含税 / 不含税 / 绝对值 |
| `pnlAmtTax` | 损溢 |
| `regularPnLAmtTax` / `regularPnLAmtExTax` / `regularPnLQty` | 常规盈亏含税 / 去税 / 数量 |
| `freshPnLAmtTax` / `freshPnLAmtExTax` / `freshPnLQty` | 生鲜盈亏含税 / 去税 / 数量 |
| `lossRateAbs` | 损耗率 = `lossAmtAbs / netSalesAmt` |

> 不要把损耗说成「吃掉了多少毛利」。

### 促销

| 字段 | 含义 |
|------|------|
| `promoTurnoverAmt` / `promoMainSaleAmt` | 促销营业额 / 主营 |
| `promoSalesRatio` | 促销销售占比（相对营业额） |
| `promoFrontMarginAmt` / `promoFrontMarginAmtExTax` | 促销前台毛利 |
| `couponAmt` / `couponAmtExTax` | 促销券 |

---

## `getDiscountStructure` — 折扣三列

> **注意：** `discvalue`（总折扣）≠ `disc_value`（促销打折）≠ `clear_value`（处理打折），三列独立。

```json
{ "apiName": "getDiscountStructure", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```

| 字段 | 含义 |
|------|------|
| `totalDiscAmt` | 总折扣金额（`discvalue`） |
| `promoDiscAmt` | 促销打折（`disc_value`） |
| `clearanceDiscAmt` | 处理打折（`clear_value`） |
| `turnoverAmt` | 营业额 |
| `totalDiscRate` / `promoDiscRate` / `clearanceDiscRate` | 各折扣 / 营业额 |

---

## `getClearanceEfficiency` — 出清效率

```json
{ "apiName": "getClearanceEfficiency", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```

| 字段 | 含义 |
|------|------|
| `clearTurnoverAmt` / `clearMainSaleAmt` | 出清营业额 / 主营 |
| `clearanceDiscAmt` | 处理打折（`clear_value`） |
| `clearFrontMarginAmt` / `ExTax` | 出清前台毛利（`clear_qtml` / `clear_bhsqtml`） |
| `clearSalesRatio` | 出清销售占比 |
| `clearanceRecoveryRatio` | 回收比 = `clearFrontMarginAmt / clearanceDiscAmt`（越接近 1 越好） |

---

## `getSupplierPromoShare` — 供应商促销分担

```json
{ "apiName": "getSupplierPromoShare", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```

| 字段 | 含义 |
|------|------|
| `supplierShareAmt` / `ExTax` | 供应商分担（sale.`zkfd_costvalue`） |
| `costSupplierShareAmt` | cost 侧 `hssupzk`（对照） |
| `totalDiscAmt` | 总折扣 `discvalue` |
| `supplierShareRate` | `supplierShareAmt / totalDiscAmt` |

---

## `getProductLifecycleMix` — 新品/重点/TOP/出清

```json
{ "apiName": "getProductLifecycleMix", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```

| 字段 | 含义 |
|------|------|
| `newMainSaleAmt` / `newMainShare` | 新品主营 / 占主营 |
| `keyTurnoverAmt` / `keyMainSaleAmt` / `keyTurnoverShare` | 重点品 |
| `topTurnoverAmt` / `topMainSaleAmt` / `topTurnoverShare` | TOP 品 |
| `clearTurnoverAmt` / `clearMainSaleAmt` / `clearTurnoverShare` | 出清品 |
| `turnoverAmt` / `mainSaleAmt` | 营业额 / 主营 |

---

## `getVentureStructure` — 经销/联营/租赁

```json
{ "apiName": "getVentureStructure", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```

| 字段 | 含义 |
|------|------|
| `ventureMainSaleAmt` / `ventureShare` | 经销主营 / 占比 |
| `jointMainSaleAmt` / `jointShare` | 联营 |
| `rentMainSaleAmt` / `rentShare` | 租赁 |
| `mainSaleAmt` | 主营合计 |

---

## `getMarginWaterfall` — 毛利瀑布（查数）

入参同 `getShopSaleOverview`（day/week/month）。读 cost，营业额 JOIN cpi。  
**成文** → `sm-shop-ops-margin-report`。

```json
{ "apiName": "getMarginWaterfall", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```

链路（含税主口径；去税并列 `*ExTax`）：

营业额 → 销售成本 → 前台毛利 →（后台费用 / 供应商分担 / 配送加价 / 物流分摊 / 股权调整）→ 综合毛利。

| 字段 | 含义 | 成文「对毛利」默认 |
|------|------|-------------------|
| `turnoverAmt` | 营业额（起点） | — |
| `cogsAmtTax` / `cogsAmtExTax` | 销售成本 | 🔴减（相对营业额） |
| `frontMarginAmt` / `frontMarginAmtExTax` | 前台毛利 | —（节点） |
| `backendFeeAmtTax` / `backendFeeAmtExTax` | 后台费用 | 🔴减综合毛利 |
| `supplierShareAmtTax` / `supplierShareAmtExTax` | 供应商分担 | 🟢增综合毛利 |
| `deliveryMarkupAmtTax` / `deliveryMarkupAmtExTax` | 配送加价 | 🟢增综合毛利 |
| `logisticsAllocAmtTax` / `logisticsAllocAmtExTax` | 物流分摊 | 🔴减综合毛利 |
| `equityAdjMarginAmtTax` / `equityAdjMarginAmtExTax` | 股权调整 | 跟符号：正增负减 |
| `comprehensiveMarginAmt` / `comprehensiveMarginAmtExTax` | 综合毛利（终点） | — |

> 成文须写清每项 **增/减毛利多少**（见 `sm-shop-ops-margin-report` §2）；勿只写「调整」。科目并列入账，**禁止**说损耗「吃毛利」。

---

## `getFreshOverview` — 生鲜经营总览（查数）

入参同总览。生鲜类目口径：**`dim_type_id LIKE '1%'`**（与 `dim_spm_chl_category_df.categoryid LIKE '1%'` 一致；**不用 goodstype**）。销售取 `data_type='门店小类'`，盈亏取 cost `门店` 预置列。  
**成文** → `sm-shop-ops-margin-report`。

```json
{ "apiName": "getFreshOverview", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```

| 字段 | 含义 |
|------|------|
| `freshTurnoverAmt` / `freshMainSaleAmt` / `freshQty` | 生鲜销售 |
| `storeTurnoverAmt` / `storeMainSaleAmt` | 门店合计（分母） |
| `freshSalesShare` / `freshMainShare` | 生鲜占门店营业额/主营（0～1） |
| `freshFrontMarginAmt` / `freshFrontMarginAmtExTax` | 生鲜前台毛利（门店小类） |
| `freshPnLAmtTax` / `freshPnLAmtExTax` / `freshPnLQty` | 生鲜盈亏 |
| `regularPnLAmtTax` / `regularPnLAmtExTax` / `regularPnLQty` | 常规盈亏 |
| `meta.freshCategoryRule` | 口径说明回显 |

---

## `getLowMarginAlert` — 低毛利预警（查数）

仅 **week/month**（无 day）。KPI `lowml_zyxxsr`。  
**日报 / `period=day` 禁止调用**，禁止改 week 重试。**成文** → `sm-shop-ops-margin-report`。

```json
{ "apiName": "getLowMarginAlert", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40"
}}
```

| 字段 | 含义 |
|------|------|
| `lowMarginMainSaleAmt` | 低毛利率主营销售 |
| `mainSaleAmt` / `turnoverAmt` | 主营 / 营业额 |
| `lowMarginMainShare` | `lowMarginMainSaleAmt / mainSaleAmt`（0～1） |

---

## 对比与暂缓

- **同比**：不依赖专用 YoY API；对「去年同周/同月/对应日」再用本 Skill 同一 `apiName` 查一次，与本期对照（时间键来自日历清单）。
- **暂不支持**：时段峰谷、坪效/人效（无接口、不问数硬编）。
- **仍暂缓的 API**：`compareStores` / `getYoYMetrics`
- **成文分流**：S1(+S1a/S1b) → overview；S2～S4 → promo；S5/S6 → 表答或 category；S7 → inventory；S8～S10 → margin；日/周/月综合 → diary/week/month-report
