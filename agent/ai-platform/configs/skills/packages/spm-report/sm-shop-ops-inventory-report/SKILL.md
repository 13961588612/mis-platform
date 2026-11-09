---
name: sm-shop-ops-inventory-report
skill_id: sm-shop-ops-inventory-report
description: 门店库存订货主题报告。独立服务：仅周/月门店库存总览。不调用其它 ops-report。品类库存 P7 走 category-report。禁止用于日报。
version: "1.3.0"
category: supermarket
tags:
  - 超市
  - 库存
  - 订货
  - 主题分析
  - sm-shop-ops-inventory-report
source: package
status: active
timeout: 30
requires_approval: false
required_permissions:
  - spm:report:read
---

# 库存订货主题分析（sm-shop-ops-inventory-report）

独立主题服务。用户要「库存 / 滞销 / 缺货 / 周转 / 订货」且粒度为周/月时加载。  
**禁止** `skill` 其它 ops-report。P7 品类库存 → category-report。

- 槽位齐后：`skill(sm-shop-sale)` → `getShopInventoryOverview`，对照上一期，并行。
- **日粒度禁止加载、禁止本接口、禁止改查 week。** 成文后禁止再 MCP。

---

## 1. 版式

**金额**（库存/滞销库存/订货/验收/退货等）：元÷10000 → **万元**，**保留 2 位小数**，后缀 `万元`。  
率、天数、交叉率按原口径。

周/月列名「较上一周/月」。对比列规则同 overview：**本期绝对值，对比列只写升降比例**（金额 `%`，比率 `pp`）。

```markdown
## {店名} · {时间标签} · 库存订货

### 库存健康度
| 指标 | 本期 | 较上一周 |
|------|------|----------|
| 库存金额（去税） | **128.50 万元** | 🟢↓ -x.x% |
| 滞销库存 / 占比 | **15.20 万元** / **11.8%** | 金额 `%`；占比 `pp` |
| 缺货 SKU / 缺货率 | **131** / **3.2%** | 缺货率 `pp` |
| 周转天数 / 周转率 | **28.5** / **0.66** | 天数 `%` 或绝对差；周转率相对差 |
| 订货 / 验收 / 缺口率 | **40.00 万元** / **38.50 万元** / **2.7%** | 缺口率 `pp`（订收额有两期则亦可 `%`） |
| **退货额（去税）** | **−2.92 万元** | **金额 `%`（两期都有必须填，禁止 `—`）** |
| 退货率 | **1.2%** | `pp` |
| 交叉率 | **0.09** | 相对差；分母过小可写「上期 0.xx」 |

### AI 诊断小结
**核心关注：** …
```

字段含义以 `sm-shop-sale` 中 `getShopInventoryOverview` 为准（内部对照，勿对用户说字段名）。

### 1.1 对比列（强制）

`getShopInventoryOverview` **无现成环比**。本轮已取本期 + 上期（如 44 周 + 43 周）时，必须用两期 `summary` 自算。

| 展示 | 字段 | 对比 |
|------|------|------|
| 库存金额（去税） | `invAmtExTax` | 金额 `%` |
| 滞销库存 / 占比 | `slowMovingInvAmtExTax` / `slowMovingShare` | 金额 `%` + `pp` |
| 缺货率 | `stockoutRate` | `pp` |
| 周转天数 / 周转率 | `turnoverDays` / `turnoverRate` | 天数相对差或 `%`；周转率相对差 |
| 订货 / 验收 / 缺口率 | `orderAmt` / `receiveAmt` / `orderReceiveGapRatio` | 缺口率 `pp` |
| **退货额（去税）** | `returnAmtExTax` | 金额相对差 `%` |
| 退货率 | `returnRate` | `pp` |
| 交叉率 | `crossRate` | 相对差；上期≈0 写「上期 x.xx」防除零 |

**禁止**：两期都有库存回包时，「退货额（去税）」对比格填 `—`（即使其它行已有环比）。上期退货额为 0 时写 `上期 0.00 万元`，不要空着。  
`—` **仅**当该对比期没有 `getShopInventoryOverview` 回包。

---

## 2. 关注点（草稿）

| 关注 | 说明 |
|------|------|
| 滞销占比升高 | 提示清库/出清联动 |
| 缺货率升高 | 提示订货与验收缺口 |
| 周转变慢 | 结合库存与成本 |
| 订收缺口率 | `(订货-验收)/订货` 异常时提示 |

阈值待业务确认；未确认不喊「异常」。日粒度无本接口 → **不要调 MCP**，转述「库存仅支持周/月」。

---

## 3. 自检

- [ ] 未查数；日粒度未硬编库存、**未改查 week**  
- [ ] 仅门店库存总览口径  
- [ ] 已取上期库存时：退货额（去税）对比列不是 `—`  
