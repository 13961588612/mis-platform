---
name: sm-shop-ops-diary-report
skill_id: sm-shop-ops-diary-report
description: 门店经营日报。period=day 自查数自成文。不调用其它 ops-report。对照只上周同期。不查库存/低毛利/复购。
version: "1.1.2"
category: supermarket
tags:
  - 超市
  - 日报
  - sm-shop-ops-diary-report
source: package
status: active
timeout: 45
requires_approval: false
required_permissions:
  - spm:report:read
aliases:
  - sm-shop-ops-daily-report
---

# 门店经营日报（sm-shop-ops-diary-report）

独立服务。模板 `SPM-STORE-DAY-REPORT` 绑本 `skill_id`。  
**禁止** `skill` 任何其它 `sm-shop-ops-*-report`。周报/月报走 week/month-report。  
MCP 的 `apiName` 用下表**右列**，禁止把 `S1`/`P1` 当接口名传入。槽位齐不问。成文后禁止再 MCP。

## 0. 代号 → apiName（调用只认右列）

S/P 是编排缩写；加载 `sm-shop-sale` / `sm-shop-category-sale` 是为了字段口径，**不是**为了才知道调哪个接口。

| 代号 | 含义 | 工具 | apiName |
|------|------|------|---------|
| S1 | 经营总览 | `callShopSaleApi` | `getShopSaleOverview` |
| S2 | 折扣三列 | 同上 | `getDiscountStructure` |
| S3 | 出清效率 | 同上 | `getClearanceEfficiency` |
| S4 | 供应商促销分担 | 同上 | `getSupplierPromoShare` |
| S8 | 毛利瀑布 | 同上 | `getMarginWaterfall` |
| S9 | 生鲜占比/盈亏 | 同上 | `getFreshOverview` |
| P1 | 品类总览 | `callShopCategorySaleApi` | `getShopCategoryOverview` |
| P8 | 类目四象限 | 同上 | `getShopCategoryRoleMatrix` |
| P9 | 类目 ABC（可选） | 同上 | `getShopCategoryAbc` |

日报**禁止**调用：`getShopInventoryOverview`(S7) / `getLowMarginAlert`(S10) / `getShopCategoryInventoryOverview`(P7) / `getRepurchaseSummary`(S1b) / `listOnlineSales`(S1a)。

## 1. 查数

日历：`listMonthDates`（跨月再打上月）。禁止 `listYearDates`。  
可并行 `skill(sm-shop-sale)` 与 `skill(sm-shop-category-sale)` 取字段说明；**同一轮并行**上表本期 apiName。失败/truncated 禁止同参重试。

| | 规则 |
|--|------|
| 粒度 | 只 `period=day` |
| 本期 | 上表除 P9 外各 1 次；P9 可选 |
| 对照 | **只上周同期**（同星期差 7 天）各 1 次。**不查前一天** |
| 禁止 | S7 / S10 / P7 / S1b / S1a；改查周月；第三天 |

对照日必须来自月清单，禁止公历减 7。

## 2. 数字与对比列（强制）

| 类型 | 展示 |
|------|------|
| 金额（不含客单价） | 元÷10000 → **万元**，2 位，后缀 `万元` |
| 客单价 | **元**，2 位，后缀 `元` |
| 客单数 | 整数 |
| 比率（当日列） | 1 位 `%`（接口 0～1 则 ×100） |

| 列 | 内容 |
|----|------|
| 当日 | **只写绝对值** |
| 较上周同期 | **只写升降比例**；禁止写对照期绝对值；**禁止「较前一天」列** |

金额/客单：`↑ +x.x%` / `↓ -x.x%` / `持平`。率/占比：`↑ +x.xpp` / `↓ -x.xpp`。  
越高越好：升 🟢 / 降 🔴。损耗：升 🔴 / 降 🟢。促销占比中性，不加色（达阈可 ⚠️）。持平不加色。  
未取到对照期才 `—`；两期都有回包禁止该格 `—`。勿说损耗「吃毛利」。禁止 HTML、禁止对用户说字段名。

S2～S4、S9 **无现成环比**，用两期 `summary` 自算。

## 3. 成文（照抄表头；缺节整省并写「未取数」）

```markdown
## {店名} · {日期}（{周几}）· 经营数据综合分析（日报）

**结论：** 1～2 句（主营销售 + 较上周同期；再点促销或毛利一句）。

### 一、经营总览

#### 销售概览
| 指标 | 当日 | 较上周同期 |
|------|------|------------|
| 主营销售 | **210.00 万元** | 🟢↑ +1.5% |
| 去券销售 | **228.10 万元** | 🟢↑ +2.0% |
| 客单数 | **2,701** | 🟢↑ +4.1% |
| 客单价 | **86.10 元** | 持平 |
| 会员销售占比 | **67.0%** | 🟢↑ +1.0pp |
| 线上销售占比 | **7.9%** | — |
| 促销销售占比 | **54.7%** | ↓ -0.8pp |

禁止再写「营业额」「主营」两行。字段：`mainSaleAmt` / `netSalesAmt` / `ticketCount` / `ticketPrice` / `memberTurnoverRatio` / `onlineSalesRatio` / `promoSalesRatio`

#### 毛利与损耗
| 指标 | 当日 | 较上周同期 |
|------|------|------------|
| 前台毛利去税 | **28.50 万元** | 🟢↑ +1.0% |
| 前台毛利率（去税） | **12.3%** | 🔴↓ -0.2pp |
| 综合毛利 | **71.20 万元** | 🟢↑ +0.8% |
| 综合毛利率 | **24.6%** | 🔴↓ -0.4pp |
| 损耗额 | **4.90 万元** | 🔴↑ +3.0% |
| 损耗率 | **2.1%** | 🔴↑ +0.2pp |

字段：`frontMarginAmtExTax` / `frontMarginRateExTax` / `comprehensiveMarginAmt` / `comprehensiveMarginRate` / `lossAmtAbs` / `lossRateAbs`  
禁止省略本表或只写当日不写比例。禁止再用含税 `frontMarginAmt` / `frontMarginRate` 当本表主指标。

### 二、品类管理
默认大类。结构按**主营销售**占比降序 **最多 TOP10**，其余写「另有 N 个类目未展开」。金额用 `mainSaleAmt`；店内占比用该类主营 / 全店主营（无现成 share 则自算）；利率用 `frontMarginRateExTax`。本表不加前台毛利额列。

| 类目 | 主营销售 | 店内占比 | 前台毛利率（去税） | 损耗率 | 促销销售占比 |
|------|----------|----------|--------------------|--------|--------------|
| … | **xx.xx 万元** | **x.x%** | **x.x%** | … | … |

#### 类目角色四象限
| 角色 | 类目数 | 主营销售合计 | 代表类目（≤3） |
|------|--------|--------------|----------------|
| 利润品 / 客流品 / 结构品 / 问题品 | … | … | … |

划线用本店中位数。无 P1/P8 →「本节未取数」。

### 三、促销专项
无 S2～S4 → 用总览促销占比写 3～5 行，勿编造三列。

| 指标 | 当日 | 较上周同期 |
|------|------|------------|
| 总折扣 | **12.35 万元** | ↑ +x.x% |
| 促销打折 | **8.20 万元** | ↑ +x.x% |
| 处理打折 | **1.05 万元** | ↑ +x.x% |
| 总折扣率 | **36.3%** | ↑ +x.xpp |
| 出清销售占比 | **12.3%** | ↓ -x.xpp |
| 出清回收比 | **0.85** | 可写 0.85 vs 0.64 |
| 供应商分担金额 | **11.04 万元** | ↑ +x.x% |
| 供应商分担率 | **36.2%** | ↑ +x.xpp |

字段：`totalDiscAmt` / `promoDiscAmt` / `clearanceDiscAmt` / `totalDiscRate` / `clearSalesRatio` / `clearanceRecoveryRatio` / `supplierShareAmt` / `supplierShareRate`  
两期都有数时，促销打折、处理打折、供应商分担**金额**禁止 `—`。折扣额升高偏中性，可不标红绿。

### 四、毛利与损耗专项

#### 毛利瀑布
禁止只写「并列调整」。每行写清金额、对毛利增/减、增减多少。

| 环节 | 当日金额 | 对毛利 | 影响额 |
|------|----------|--------|--------|
| 主营销售 | **210.00 万元** | — | — |
| 销售成本 | **204.06 万元** | 🔴减 | **−204.06 万元** |
| 前台毛利去税 | **28.50 万元** | — | — |
| 后台费用 | **3.20 万元** | 🔴减 | **−3.20 万元** |
| 供应商分担 | **5.10 万元** | 🟢增 | **+5.10 万元** |
| 配送加价 | **1.20 万元** | 🟢增 | **+1.20 万元** |
| 物流分摊 | **0.80 万元** | 🔴减 | **−0.80 万元** |
| 股权调整 | **0.40 万元** | 🟢增 | **+0.40 万元** |
| 综合毛利 | **31.20 万元** | — | — |

瀑布默认**去税**：起点 `mainSaleAmt`（总览 S1；瀑布无此字段则用 S1），成本 `cogsAmtExTax`，节点 `frontMarginAmtExTax`，调整项与终点用 `*ExTax` / `comprehensiveMarginAmtExTax`。股权调整跟接口符号。表下固定：**前台→综合差额** = 综合 − 前台毛利去税，并点名影响额最大的 1～2 项。无 S8 则整省。

#### 生鲜占比与盈亏
| 指标 | 当日 | 较上周同期 |
|------|------|------------|
| 生鲜主营销售 / 占门店主营 | **xx.xx 万元** / **x.x%** | **金额 `%` + 占比 `pp`，禁止只填金额或 `—`** |
| 生鲜前台毛利去税 | **xx.xx 万元** | `%` |
| 生鲜盈亏（含税） | **±x.xx 万元** | 上期非 0 用 `%`；≈0 写上期绝对值 |
| 常规盈亏（含税） | **±x.xx 万元** | 同上 |

禁止再写「生鲜营业额」行（与主营销售重复）。字段：`freshMainSaleAmt` / `freshMainShare` / `freshFrontMarginAmtExTax` / `freshPnLAmtTax` / `regularPnLAmtTax`  
两期都有 Fresh 时，「生鲜主营 / 占门店主营」禁止 `—`。无低毛利预警表（仅周月）。

### 五、库存订货
库存仅支持周/月，本节跳过。

### 六、综合诊断小结
2～5 句，最多 3 个核心关注。阈值未确认勿喊异常。
```

数字示例仅示意版式，成文必须用本轮 MCP 真数。
