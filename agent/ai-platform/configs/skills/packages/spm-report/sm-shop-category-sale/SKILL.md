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
- `items`：**门店 × 类目 × 时段**一行；**返回**里有 `storeId`（单店字段），**入参不要传 `storeId`**
- 周/月键优先用日历 Skill `listYearWeeks` / `listYearMonths`
- 分类维表可用 `callCommonInfoApi`：`listCategories` / `listChildCategories` / `getCategoryById`

**每次业务查询都必须带类目维，三选一，缺一不可：**

1. `categoryLevel`：**中文字符串**，只能是 `部门` / `柜组` / `大类` / `中类` / `小类`
2. 或 `parentCategoryId`（分类 id 字符串）
3. 或 `categoryIds`（分类 id，标量或数组）

用户没说看哪一层、也没给 `parentCategoryId` / `categoryIds` 时：**不要猜默认层级**，应询问或报错（接口本身会拒）。

**禁止**把 `categoryLevel` 写成数字或数字串：`1` / `"1"` / `deptLevelId` / `"门店大类"` 都会报错。`1` 是维表 `deptLevelId`，不是本接口的 `categoryLevel`。

---

## 公共入参

时间 + 门店范围字段名与 sm-shop-sale 相同（`storeIds` / `ordDates` / `ordWeeks` / `ordMonths` / `compare`），**另加**类目三选一。**条数上限不同**：按级别/父类展开时不是「最多 5 店 × 5 时段」。

| 字段 | 何时必填 | 说明 |
|------|----------|------|
| `period` | 始终 | `"day"` / `"week"` / `"month"` |
| `storeIds` | `categoryLevel` / `parentCategoryId` 时 **必须且仅 1 个**；`categoryIds` 时与 `areaId` 二选一，最多 5 店 |
| `areaId` | 仅 `categoryIds` 模式 | 按级别/父类 **禁止** `areaId` |
| `ordDates` / `ordWeeks` / `ordMonths` | 按 period | `categoryLevel` / `parentCategoryId`：**当期数组长度必须 = 1**（标量也行）。`categoryIds`：最多 5 个当期 |
| `compare` | 否 | 仅 `"previous"`：按日历补上一期（**不占**当期额度，这才是「本周 vs 上周」的写法） |
| `categoryLevel` | 三选一 | `部门` / `柜组` / `大类` / `中类` / `小类` |
| `parentCategoryId` | 三选一 | 查该父类下一级子类 |
| `categoryIds` | 三选一 | 指定分类 id（须同级），标量或数组最多 5 |

**对比两周/两月时不要把两个键都塞进 `ordWeeks` / `ordMonths`。** 会报：`categoryLevel / parentCategoryId 只支持单个当期时段（compare:previous 可另补上一期）`。

**不要传** `storeId` / `ordWeek` / `ordMonth`（已更名为 `storeIds` / `ordWeeks` / `ordMonths`）。传了旧名会同时报「请改用 storeIds」和「storeIds 与 areaId 必须二选一」。

### `data_type` 映射（门店内）

| 模式 | 入参 | `data_type` |
|------|------|-------------|
| 按级别 | `categoryLevel=大类` 等 | `门店部门` / `门店柜组` / `门店大类` / `门店中类` / `门店小类` |
| 按父类 | 父为大类 → 查中类 | `门店中类`（父 deptLevel→下级 `门店*`） |
| 按 id | `categoryIds=["10","20"]` | 按这些 id 自身级别映射到对应 `门店*` |

占比按 **同一门店同一时段** 内计算（总览的 share）；结构类指标的 rate/share 按该类目自身营业额/主营计算。多个时段时 `summary` 为 `null`。

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

## 选用

| 意图 | apiName |
|------|---------|
| 品类销售/毛利/损耗/促销（任一或同时） | `getShopCategoryOverview` |
| 品类库存/滞销/缺货/周转/订货/退货/交叉率 | `getShopCategoryInventoryOverview`（**仅 week/month**） |
| 品类折扣三列 | `getShopCategoryDiscountStructure` |
| 品类出清效率 | `getShopCategoryClearanceEfficiency` |
| 品类供应商促销分担 | `getShopCategorySupplierPromoShare` |
| 品类新品/重点/TOP/出清 | `getShopCategoryProductLifecycleMix` |
| 品类经销/联营/租赁 | `getShopCategoryVentureStructure` |
| 类目角色四象限（利润/客流/结构/问题） | `getShopCategoryRoleMatrix` |
| 类目级 ABC（累计营业额） | `getShopCategoryAbc` |
| 门店级（无类目） | Skill **`sm-shop-sale`** |

router 代号（`sm-report-router` 确认槽后按下表复制 apiName）：P1 总览 → `getShopCategoryOverview`（成文 → `sm-shop-ops-category-report`）；P2 折扣；P3 出清；P4 供应商分担；P5 生命周期；P6 经营方式；P7 库存（**仅 week/month**）；P8 四象限；P9 ABC。

**日粒度硬禁止**：`period=day` **不得**调用 `getShopCategoryInventoryOverview`；失败后禁止改 week 重试。

**解读 / 品类管理报告成文** 不在本 Skill，见 **`sm-shop-ops-category-report`**。

---

## `getShopCategoryOverview` — 品类总览

同条件一次返回：**销售 + 毛利 + 损耗 + 促销**。

```json
{ "apiName": "getShopCategoryOverview", "params": {
  "period": "day", "storeIds": "0001", "ordDates": ["2026-11-23"],
  "categoryLevel": "大类"
}}
```

```json
{ "apiName": "getShopCategoryOverview", "params": {
  "period": "week", "storeIds": "0001", "ordWeeks": "2026年-46周",
  "categoryLevel": "大类"
}}
```

本周 vs 上周（**对**：1 个当期 + `compare`）：

```json
{ "apiName": "getShopCategoryOverview", "params": {
  "period": "week", "storeIds": "0001", "ordWeeks": ["2026年-46周"],
  "compare": "previous",
  "categoryLevel": "大类"
}}
```

**错**（两个当期，Zod 会拒）：`"ordWeeks": ["2026年-46周", "2026年-45周"]` + `categoryLevel`。
要指定两个分类、或多店多周，改用 `categoryIds`（不要用 `categoryLevel`）。

```json
{ "apiName": "getShopCategoryOverview", "params": {
  "period": "week", "storeIds": "6001", "ordWeeks": "2026-W40",
  "parentCategoryId": "1024"
}}
```

```json
{ "apiName": "getShopCategoryOverview", "params": {
  "period": "week",
  "storeIds": ["6001", "6002"],
  "ordWeeks": ["2026-W40", "2026-W39"],
  "categoryIds": ["10", "20"],
  "compare": "previous"
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
**日报 / `period=day` 禁止调用**。

| 字段 | 含义 |
|------|------|
| `invAmtExTax` / `slowMovingInvAmtExTax` / `slowMovingShare` | 库存 / 滞销 / 占比 |
| `stockoutSkuCnt` / `stockoutSkuDenom` / `stockoutRate` | 缺货 |
| `turnoverDays` / `turnoverRate` / `crossRate` | 周转 / 交叉率 |
| `orderAmt` / `receiveAmt` / `orderReceiveGapRatio` | 订货 / 验收 / 缺口率 |
| `returnAmtExTax` / `returnRate` | 退货 |

---

## 主题二扩展（ADS 近似，非订单明细）

入参同总览。数据来自品类总览的销售占比 + 前台毛利率，**按门店分别**计算。

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

### 四象限 / 客流品·问题品明细（防死循环）

用户要「客流品 / 问题品 / 四象限 + 各类指标」时：

1. **一次** `getShopCategoryRoleMatrix`（级别用 `categoryLevel`，全店结构默认 **`大类`**，不要逐 id）
2. 需要损耗/促销等总览字段时，**再一次** `getShopCategoryOverview`，**同一** `categoryLevel`（可加 `compare: "previous"`）
3. 在内存里按 `role` 过滤客流品/问题品，用 Overview 的 `categoryId` 对齐补指标，**立即成文**

**禁止：**

- 对 RoleMatrix 返回的每个 `categoryId` 再打 Overview / RoleMatrix
- 把几十个 id 拆成多次 `categoryIds`（每批最多 5 也不能用来扫完全店）
- 工具返回 `Tool output truncated` / `Original size` 后：用 **内联 preview + 已拿到的 RoleMatrix** 成文；写 TOP（默认最多 10，用户要「全部」也最多表列 15）+「另有 N 个类目未展开」
- truncated 后禁止再 MCP 补拉、禁止同参重试、禁止改成按 id 循环

本意图 MCP **上限 3 次**（日历若尚未确认可另 1 次 `listYearWeeks`）。超限必须停手成文。

---

## 对比与成文分流

- **同比 / 上期**：`categoryLevel` / `parentCategoryId` 只传 **1 个当期** + `compare: "previous"`，不要把两周塞进 `ordWeeks`。
- **成文**（详 router §1.1）：P1～P9 → `sm-shop-ops-category-report`（P2～P4 仅轻量节）；门店促销专项才走 promo。
- **门店级无类目** → `sm-shop-sale`。
