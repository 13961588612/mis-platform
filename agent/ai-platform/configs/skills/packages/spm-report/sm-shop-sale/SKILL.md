---
name: sm-shop-sale
skill_id: sm-shop-sale
description: 超市门店销售（经营总览 + 折扣/出清/供应商分担/生命周期/经营方式）。当门店与时间槽位已由 sm-report-router 确认后，用户询问营业额、客单、会员/线上销售、前台/综合毛利、损耗率、生鲜盈亏、促销占比、折扣结构、出清效率、供应商促销分担、新品/重点/TOP、经销联营租赁时触发。品类结构请用 sm-shop-category-sale。经营问数请先加载 sm-report-router。
version: "1.0.1"
category: supermarket
tags:
  - 超市
  - 门店销售
  - 毛利
  - 损耗
  - 促销
  - sm-shop-sale
source: package
status: active
timeout: 60
requires_approval: false
required_permissions:
  - spm:report:read
handler: mcp:mcp-sm-api-suite:callShopSaleApi
mcp_server: mcp-sm-api-suite
---

# 门店销售（sm-shop-sale）

通过 MCP 工具 **`callShopSaleApi`** 查询。只传 **`apiName`** + **`params`**；**不要传 `serviceName` / `identity`**。

品类见 Skill **`sm-shop-category-sale`**（工具 `callShopCategorySaleApi`）。

---

## MCP 与公共入参

- MCP 服务名：**`mcp-sm-api-suite`**
- 工具：**`callShopSaleApi`**（平台工具名形如 `mcp__mcp-sm-api-suite__callShopSaleApi`）
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

---

## 选用

| 意图 | apiName |
|------|---------|
| 门店经营/毛利/损耗/促销（任一或同时） | `getShopSaleOverview` |
| 折扣三列（总折扣/促销打折/处理打折） | `getDiscountStructure` |
| 出清效率（出清销售 + 毛利回收） | `getClearanceEfficiency` |
| 供应商促销分担 | `getSupplierPromoShare` |
| 新品/重点/TOP/出清结构 | `getProductLifecycleMix` |
| 经销/联营/租赁 | `getVentureStructure` |
| 品类结构 | Skill **`sm-shop-category-sale`** |

---

## `getShopSaleOverview` — 门店总览

销售 + 毛利损耗 + 促销 **同条件一次返回**。

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
| `frontMarginRate` / `comprehensiveMarginRate` | 前台 / 综合毛利率（分母=营业额） |

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

## 暂缓

- `compareStores` / `getYoYMetrics`
- `getMarginWaterfall` / `getLowMarginAlert`
