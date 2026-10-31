---
name: sm-shop-category-sale
skill_id: sm-shop-category-sale
description: 超市门店内品类结构（销售/毛利/损耗/促销总览 + 折扣/出清/供应商/生命周期/经营方式）。当门店与时间槽位已由 sm-report-router 确认后，用户询问某店各部门/柜组/大中小类销售占比、品类毛利、品类损耗、品类促销、品类折扣/出清/供应商分担/新品重点TOP/经销联营，或按父分类下钻子类时触发。经营问数请先加载 sm-report-router。
version: "1.0.1"
category: supermarket
tags:
  - 超市
  - 品类销售
  - 类目结构
  - sm-shop-category-sale
source: package
status: active
timeout: 60
requires_approval: false
required_permissions:
  - spm:report:read
handler: mcp:mcp-sm-api-suite:callShopCategorySaleApi
mcp_server: mcp-sm-api-suite
---

# 品类销售（sm-shop-category-sale）

通过 MCP 工具 **`callShopCategorySaleApi`** 查询（不是 `callShopSaleApi`）。

门店级见 Skill **`sm-shop-sale`**。

---

## MCP 前提

- MCP 服务名：**`mcp-sm-api-suite`**
- 工具：**`callShopCategorySaleApi`**（平台工具名形如 `mcp__mcp-sm-api-suite__callShopCategorySaleApi`）
- 只传 **`apiName`** + **`params`**
- **不要传 `serviceName` / `identity`**
- `items`：**门店 + 类目**一行（`storeId` + `categoryId` / `categoryName`）
- 周/月键优先用日历 Skill `listYearWeeks` / `listYearMonths`
- 分类维表可用 `callCommonInfoApi`：`listCategories` / `listChildCategories` / `getCategoryById`

---

## 公共入参

时间 + 门店范围与 sm-shop-sale 相同，**另加** `categoryLevel` | `parentCategoryId` **二选一**。

| 字段 | 何时必填 | 说明 |
|------|----------|------|
| `period` | 始终 | `"day"` / `"week"` / `"month"` |
| `storeId` / `areaId` | 二选一 | 单店或区域 |
| `startOrdDate`+`endOrdDate` / `ordWeek` / `ordMonth` | 按 period | 同 sm-shop-sale |
| `categoryLevel` | 与 parent 二选一 | `部门` / `柜组` / `大类` / `中类` / `小类` |
| `parentCategoryId` | 与 level 二选一 | 查该父类下一级子类 |

### `data_type` 映射（门店内）

| 模式 | 入参 | `data_type` |
|------|------|-------------|
| 按级别 | `categoryLevel=大类` 等 | `门店部门` / `门店柜组` / `门店大类` / `门店中类` / `门店小类` |
| 按父类 | 父为大类 → 查中类 | `门店中类`（父 deptLevel→下级 `门店*`） |

占比均在**单店、当前结果集**内计算（总览的 share）；结构类指标的 rate/share 按该类目自身营业额/主营计算。

> 权限软失败（人员找不到 / 无门店权限等）：**不抛错**，`items=[]`，`meta.notice` 为提示文案，请转述给用户。

---

## 选用

| 意图 | apiName |
|------|---------|
| 品类销售/毛利/损耗/促销（任一或同时） | `getShopCategoryOverview` |
| 品类折扣三列 | `getShopCategoryDiscountStructure` |
| 品类出清效率 | `getShopCategoryClearanceEfficiency` |
| 品类供应商促销分担 | `getShopCategorySupplierPromoShare` |
| 品类新品/重点/TOP/出清 | `getShopCategoryProductLifecycleMix` |
| 品类经销/联营/租赁 | `getShopCategoryVentureStructure` |
| 门店级（无类目） | Skill **`sm-shop-sale`** |

---

## `getShopCategoryOverview` — 品类总览

同条件一次返回：**销售 + 毛利 + 损耗 + 促销**。

```json
{ "apiName": "getShopCategoryOverview", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40",
  "categoryLevel": "大类"
}}
```

```json
{ "apiName": "getShopCategoryOverview", "params": {
  "period": "week", "storeId": "6001", "ordWeek": "2026-W40",
  "parentCategoryId": "1024"
}}
```

### 销售

| 字段 | 含义 |
|------|------|
| `turnoverAmt` / `netSalesAmt` / `mainSaleAmt` / `qty` | 营业额 / 去券 / 主营 / 销量 |
| `turnoverShare` | 门店内营业额占比（0～1） |

### 毛利 / 损耗 / 促销

| 字段 | 含义 |
|------|------|
| `frontMarginAmt` / `ExTax` / `frontMarginRate` / `frontMarginShare` | 前台毛利与占比 |
| `lossAmtTax` / `ExTax` / `lossAmtAbs` / `lossRateAbs` | 损耗 |
| `pnlAmtTax` / `regularPnLAmtTax` / `freshPnLAmtTax` | 损溢 / 常规 / 生鲜 |
| `promoTurnoverAmt` / `promoMainSaleAmt` / `promoSalesRatio` | 促销销售 |
| `promoFrontMarginAmt` / `ExTax` / `couponAmt` / `ExTax` | 促销毛利 / 券 |

> 不要把损耗说成「吃掉了多少毛利」。

---

## 结构类（与门店档对称；指标字段同 sm-shop-sale）

入参同总览（须带 `categoryLevel` 或 `parentCategoryId`）。

### `getShopCategoryDiscountStructure`

> `discvalue` ≠ `disc_value` ≠ `clear_value`

| 字段 | 含义 |
|------|------|
| `totalDiscAmt` / `promoDiscAmt` / `clearanceDiscAmt` | 总折扣 / 促销打折 / 处理打折 |
| `totalDiscRate` / `promoDiscRate` / `clearanceDiscRate` | 相对该类目营业额 |

### `getShopCategoryClearanceEfficiency`

| 字段 | 含义 |
|------|------|
| `clearTurnoverAmt` / `clearMainSaleAmt` / `clearanceDiscAmt` | 出清销售 / 处理打折 |
| `clearFrontMarginAmt` / `ExTax` | 出清前台毛利 |
| `clearSalesRatio` / `clearanceRecoveryRatio` | 占比 / 回收比 |

### `getShopCategorySupplierPromoShare`

| 字段 | 含义 |
|------|------|
| `supplierShareAmt` / `ExTax` / `costSupplierShareAmt` | 供应商分担（sale `zkfd_*` / cost `hssupzk`） |
| `totalDiscAmt` / `supplierShareRate` | 总折扣与分担率 |

### `getShopCategoryProductLifecycleMix`

| 字段 | 含义 |
|------|------|
| `newMainSaleAmt` / `newMainShare` | 新品 |
| `key*` / `top*` / `clear*` | 重点 / TOP / 出清 |
| `turnoverAmt` / `mainSaleAmt` | 营业额 / 主营 |

### `getShopCategoryVentureStructure`

| 字段 | 含义 |
|------|------|
| `ventureMainSaleAmt` / `jointMainSaleAmt` / `rentMainSaleAmt` | 经销 / 联营 / 租赁主营 |
| `ventureShare` / `jointShare` / `rentShare` | 占主营比 |
