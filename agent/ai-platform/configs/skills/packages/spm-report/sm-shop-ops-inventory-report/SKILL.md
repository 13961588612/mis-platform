---
name: sm-shop-ops-inventory-report
skill_id: sm-shop-ops-inventory-report
description: 门店库存订货主题分析报告（Inventory Theme Report）。基于 getShopInventoryOverview 取数结果成文（仅周/月）。不查数。可被综合报告引用，也可单独做库存分析。
version: "1.2.0"
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

**只做本主题解读**，不做查数。

- 取数：router → `sm-shop-sale` → `getShopInventoryOverview`（**仅 week/month**）
- 品类库存 P7 → **`sm-shop-ops-category-report`**（库存要点）；本 Skill **只**门店 S7 总览
- **禁止**再调 MCP；无数据不编造
- 综合报告中为本主题**第五章**；关系见 router §1.1

---

## 1. 版式

**金额**（库存/滞销库存/订货/验收/退货等）：元÷10000 → **万元**，**保留 2 位小数**，后缀 `万元`。  
率、天数、交叉率按原口径。

```markdown
## {店名} · {时间标签} · 库存订货

### 库存健康度
| 指标 | 本期 | 较上期 | 较同期 |
|------|------|--------|--------|
| 库存金额（去税） | **128.50 万元** | … | … |
| 滞销库存 / 占比 | **15.20 万元** / **11.8%** | … | … |
| 缺货率 | **3.2%** | … | … |
| 周转天数 / 周转率 | **28.5** / … | … | … |
| 订货 / 验收 / 缺口率 | **40.00 万元** / **38.50 万元** / … | … | … |
| 退货率 | **1.2%** | … | … |
| 交叉率 | … | … | … |

### AI 诊断小结
**核心关注：** …
```

字段含义以 `sm-shop-sale` 中 `getShopInventoryOverview` 为准（内部对照，勿对用户说字段名）。

---

## 2. 关注点（草稿）

| 关注 | 说明 |
|------|------|
| 滞销占比升高 | 提示清库/出清联动 |
| 缺货率升高 | 提示订货与验收缺口 |
| 周转变慢 | 结合库存与成本 |
| 订收缺口率 | `(订货-验收)/订货` 异常时提示 |

阈值待业务确认；未确认不喊「异常」。日粒度无本接口 → 转述「库存仅支持周/月」。

---

## 3. 自检

- [ ] 未查数；日粒度未硬编库存  
- [ ] 仅门店库存总览口径  
