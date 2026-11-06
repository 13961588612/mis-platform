---
name: sm-shop-sale
description: 超市门店销售（经营总览 + 库存订货 + 线上明细/复购 + 折扣/出清/供应商分担/生命周期/经营方式）。当用户询问营业额、客单、会员/线上平台销售毛利、复购人数、前台/综合毛利、损耗、促销、库存、滞销、缺货、周转、订货验收、退货、交叉率、折扣结构、出清、供应商促销分担、新品/重点/TOP、经销联营租赁时触发。品类结构请用 sm-shop-category-sale Skill。
---

# 门店销售（sm-shop-sale）

通过 MCP 工具 **`callShopSaleApi`** 查询。只传 **`apiName`** + **`params`**；**不要传 `serviceName` / `identity`**。

品类见 Skill **`sm-shop-category-sale`**（工具 `callShopCategorySaleApi`）。

---

## MCP 与公共入参

- MCP 服务名：**`mcp-sm-api-suite`**
- 工具：**`callShopSaleApi`**
- `items` **一律按门店**汇总，含 `storeId` / `storeName`
- 周/月键优先用日历 Skill `listYearWeeks` / `listYearMonths`

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
| **S1** | 经营总览（销售+毛利+损耗+促销；**仅查数**） | `getShopSaleOverview`（成文 → `sm-shop-ops-overview-report` / 综合 → `sm-shop-ops-comprehensive-report`） |
| **S1a** | 线上分平台/类目销售毛利 | `listOnlineSales`（`startSaleDate`+`endSaleDate`） |
| **S1b** | 复购会员人数 | `getRepurchaseSummary`（**仅 week/month**） |
| **S2** | 折扣三列 | `getDiscountStructure` |
| **S3** | 出清效率 | `getClearanceEfficiency` |
| **S4** | 供应商促销分担 | `getSupplierPromoShare` |
| **S5** | 新品/重点/TOP/出清结构 | `getProductLifecycleMix` |
| **S6** | 经销/联营/租赁 | `getVentureStructure` |
| **S7** | 门店库存/滞销/缺货/周转/订货/退货/交叉率 | `getShopInventoryOverview`（**仅 week/month**） |
| — | 品类结构 | Skill **`sm-shop-category-sale`** |

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
**仅 `period=week|month`**（无 day 表）。

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
**解读 / 同比上期 / 异常成文** 不在本 Skill，见 **`sm-shop-ops-overview-report`**（总览）或 **`sm-shop-ops-comprehensive-report`**（综合）。

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
| `pnlAmtTax` / `regularPnLAmtTax` / `freshPnLAmtTax` | 损溢 / 常规盈亏 / 生鲜盈亏 |
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

## 对比与暂缓

- **同比**：不依赖专用 YoY API；对「去年同周/同月/对应日」再用本 Skill 同一 `apiName` 查一次，与本期对照（时间键来自日历清单）。
- **暂不支持**：时段峰谷、坪效/人效（无接口、不问数硬编）。
- **仍暂缓的 API**：`compareStores` / `getMarginWaterfall` / `getLowMarginAlert`
