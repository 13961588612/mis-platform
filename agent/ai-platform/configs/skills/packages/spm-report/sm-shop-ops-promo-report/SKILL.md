---
name: sm-shop-ops-promo-report
skill_id: sm-shop-ops-promo-report
description: 门店促销专项主题分析报告（Promo Theme Report）。基于折扣三列/出清/供应商分担等取数结果成文。不查数；apiName 在 sm-shop-sale。可被综合报告引用，也可单独做促销分析。
version: "1.1.0"
category: supermarket
tags:
  - 超市
  - 促销
  - 主题分析
  - sm-shop-ops-promo-report
source: package
status: active
timeout: 30
requires_approval: false
required_permissions:
  - spm:report:read
---

# 促销专项主题分析（sm-shop-ops-promo-report）

**只做本主题解读**，不做查数。

- 取数：router → `sm-shop-sale` → `getDiscountStructure` / `getClearanceEfficiency` / `getSupplierPromoShare`（按问法选；可多接口）
- 弱问仅促销占比时，可用 `getShopSaleOverview` 中促销字段做轻量节
- **禁止**再调 MCP；**禁止**编造未取到的专项数
- 综合整合：`sm-shop-ops-comprehensive-report`

---

## 1. 版式

**金额**（总折扣/促销打折/处理打折/出清额/分担额等）：元÷10000 → **万元**，**保留 2 位小数**，后缀 `万元`。  
比率/回收比按原口径；无客单价则不适用「元」例外。

```markdown
## {店名} · {时间标签} · 促销专项

### 促销结构
| 指标 | 本期 | 较上期 | 较同期 |
|------|------|--------|--------|
| 总折扣 | **12.35 万元** | … | … |
| 促销打折 | **8.20 万元** | … | … |
| 处理打折 | **1.05 万元** | … | … |
| 出清销售占比 | **12.3%** | … | … |
| 出清回收比 | **0.85** | … | … |
| 供应商分担率 | **36.2%** | … | … |

### AI 诊断小结
**核心关注：** …
```

仅输出**本轮已取到**的指标行；缺接口则整行省略并在小结说明「未查折扣/出清/分担专项」。

---

## 2. 关注点（草稿）

| 关注 | 说明 |
|------|------|
| 折扣结构 | 总折扣 vs 促销打折 vs 处理打折勿混用字段 |
| 出清 | 回收比远离 1 时提示 |
| 供应商分担 | 分担率偏低时提示 |
| 与总览促销占比 | 有 overview 促销占比时可一句对照 |

阈值待业务确认；未确认不喊「异常」。

---

## 3. 自检

- [ ] 未查数；未编造未取数字段  
- [ ] 三列折扣口径未混淆  
