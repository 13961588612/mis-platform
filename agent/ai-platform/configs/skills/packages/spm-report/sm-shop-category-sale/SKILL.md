---
name: sm-shop-category-sale
description: 超市门店内品类结构（销售/毛利/损耗/促销总览 + 品类库存订货 + 折扣/出清/供应商/生命周期/经营方式 + 类目四象限/类目ABC）。当用户询问某店各部门/柜组/大中小类销售占比、品类毛利、品类角色（利润品/客流品/结构品/问题品）、品类ABC、品类损耗/促销、品类库存、折扣/出清/供应商分担/新品重点TOP/经销联营，或按父分类下钻子类时触发。
---

# 品类销售（sm-shop-category-sale）

通过 MCP 工具 **`callShopCategorySaleApi`** 查询（不是 `callShopSaleApi`）。

门店级见 Skill **`sm-shop-sale`**。

---

## MCP 前提

- 工具：**`callShopCategorySaleApi`**
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

### 对用户展示单位（强制；接口原值仍为元）

与 **`sm-shop-sale`** 相同：

| 类型 | 展示 |
|------|------|
| **金额**（品类营业额/主营/毛利额/损耗额/促销额/折扣额/库存额/订货验收退货额等，**不含客单价**） | 元 ÷ 10000 → **万元**，**保留 2 位小数**，后缀 `万元` |
| **客单价**（若有） | **元**，保留 2 位小数，后缀 `元` |
| 客单数 / SKU 数等 | 整数 |
| 占比 / 率 | 按字段口径展示为百分数或小数说明 |

直接回答用户时也须换算；勿原样甩「元」级大数。

---

## 选用（router 代号 → apiName；权威在本表）

由 `sm-report-router` 确认门店/时间/品类槽后加载本 Skill，**按下表复制 apiName**。  
级别：`部门` / `柜组` / `大类` / `中类` / `小类`。品类角色 / ABC 等默认 **`categoryLevel=大类`**。

| router | 意图 | apiName |
|--------|------|---------|
| **P1** | 品类销售/毛利/损耗/促销总览（**仅查数**） | `getShopCategoryOverview`（成文 → `sm-shop-ops-category-report`） |
| **P2** | 品类折扣三列 | `getShopCategoryDiscountStructure`（成文 → category-report **轻量**；勿默认 promo） |
| **P3** | 品类出清效率 | `getShopCategoryClearanceEfficiency`（同上） |
| **P4** | 品类供应商促销分担 | `getShopCategorySupplierPromoShare`（同上） |
| **P5** | 品类新品/重点/TOP/出清 | `getShopCategoryProductLifecycleMix`（有数可成文 → category-report） |
| **P6** | 品类经销/联营/租赁 | `getShopCategoryVentureStructure`（有数可成文 → category-report） |
| **P7** | 品类库存/滞销/缺货/周转/订货/退货 | `getShopCategoryInventoryOverview`（**仅 week/month**；可选进 category-report） |
| **P8** | 类目角色四象限（利润/客流/结构/问题） | `getShopCategoryRoleMatrix`（成文 → category-report） |
| **P9** | 类目级 ABC（累计营业额） | `getShopCategoryAbc`（成文 → category-report） |
| — | 门店级（无类目） | Skill **`sm-shop-sale`** |

**解读 / 品类管理报告成文** 不在本 Skill，见 **`sm-shop-ops-category-report`**。

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
| `frontMarginAmt` / `ExTax` / `frontMarginRate` / `frontMarginRateExTax` / `frontMarginShare` | 前台毛利与占比；`frontMarginRate`=含税/营业额；`frontMarginRateExTax`=去税毛利/主营 |
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

### `getShopCategoryInventoryOverview` — 品类库存订货

**仅 week/month**。指标口径与门店档 `getShopInventoryOverview` 同构，另带 `categoryId` / `categoryName`。  
可选进成文 → `sm-shop-ops-category-report`（库存要点节）。

| 字段 | 含义 |
|------|------|
| `invAmtExTax` / `slowMovingInvAmtExTax` / `slowMovingShare` | 库存 / 滞销 / 占比 |
| `stockoutSkuCnt` / `stockoutSkuDenom` / `stockoutRate` | 缺货 |
| `turnoverDays` / `turnoverRate` / `crossRate` | 周转 / 交叉率 |
| `orderAmt` / `receiveAmt` / `orderReceiveGapRatio` | 订货 / 验收 / 缺口率 |
| `returnAmtExTax` / `returnRate` | 退货 |

---

## 主题二扩展（ADS 近似，非订单明细）

入参同总览。数据来自品类总览的销售占比 + 前台毛利率，**按门店分别**计算。品类角色 / ABC 默认 **`categoryLevel=大类`**。

### `getShopCategoryRoleMatrix` — 类目角色四象限

| 角色 | 规则（相对本店中位数） |
|------|------------------------|
| `利润品` | 高占比 × 高毛利率 |
| `客流品` | 高占比 × 低毛利率 |
| `结构品` | 低占比 × 高毛利率 |
| `问题品` | 低占比 × 低毛利率 |

| 字段 | 含义 |
|------|------|
| `role` | 上述四角色之一 |
| `turnoverShare` / `frontMarginRate` | 划分依据 |
| `shareMedian` / `marginRateMedian` | 本店阈值 |
| `summary.roleCounts` / `roleTurnoverAmt` | 各角色计数与营业额 |

### `getShopCategoryAbc` — 类目级 ABC

门店内按 `turnoverAmt` 降序累计：`A` 累计前仍 <80%；`B` <95%；其余 `C`。

| 字段 | 含义 |
|------|------|
| `abcClass` | `A` / `B` / `C` |
| `rank` / `cumulativeShare` | 店内排名与累计占比 |
| `summary.classCounts` / `classTurnoverShare` | 各类计数与营业额占比 |

> **局限：** 类目级（非单品）；单品 ABC / 动销率 / 供应商销售集中度仍需订单明细，本 Skill 暂不覆盖。

---

## 对比与成文分流

- **同比**：同门店档——另查对比期时间键，同一 `apiName` 再调一次。
- **成文**（详 router §1.1）：P1～P9 → `sm-shop-ops-category-report`（P2～P4 仅轻量节）；门店促销专项才走 promo。
- **门店级无类目** → `sm-shop-sale`。
