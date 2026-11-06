---
name: sm-shop-ops-comprehensive-report
skill_id: sm-shop-ops-comprehensive-report
description: 门店经营数据综合分析报告（Store Ops Comprehensive Analysis Report）。整合经营总览/促销/库存等主题分析章节成文；不查数。分主题请用 sm-shop-ops-overview-report / promo-report / inventory-report。
version: "1.1.0"
category: supermarket
tags:
  - 超市
  - 综合分析
  - 经营诊断
  - sm-shop-ops-comprehensive-report
source: package
status: active
timeout: 45
requires_approval: false
required_permissions:
  - spm:report:read
---

# 门店经营数据综合分析报告（sm-shop-ops-comprehensive-report）

英文名：**Store Ops Comprehensive Analysis Report**  
中文名：门店经营数据综合分析报告

**只做整合成文**，不做查数、不写 apiName。

---

## 0. 与分主题关系

| skill_id | 中文 | 英文 |
|----------|------|------|
| **本 Skill** | 门店经营数据综合分析报告 | Store Ops Comprehensive Analysis Report |
| `sm-shop-ops-overview-report` | 经营总览主题分析 | Overview Theme Report |
| `sm-shop-ops-promo-report` | 促销专项主题分析 | Promo Theme Report |
| `sm-shop-ops-inventory-report` | 库存订货主题分析 | Inventory Theme Report |

编排：

1. 用户要**综合 / 全面诊断 / 经营分析报告** → 本 Skill  
2. 用户只要**总览 / 促销 / 库存**某一主题 → 只加载对应主题 Skill，**不要**走本 Skill  
3. 成文前先 `skill()` 所需主题 Skill，**按各主题版式写对应章节**（规则以主题 Skill 为准，本 Skill 不重复贴长规则）

```
查数完成（至少 S1 有数）
  → skill(sm-shop-ops-comprehensive-report)
  → skill(sm-shop-ops-overview-report)          # 必有 S1 数据
  →（有促销专项数）skill(sm-shop-ops-promo-report)
  →（有库存周月数）skill(sm-shop-ops-inventory-report)
  → 按 §1 拼装一份报告
```

---

## 1. 综合报告骨架

```markdown
## {店名} · {时间标签} · 经营数据综合分析

### 一、经营总览
（内容与标记规则遵循 sm-shop-ops-overview-report）

### 二、促销专项
（有专项取数则按 sm-shop-ops-promo-report；仅有 overview 促销占比则写轻量 3～5 行；都没有则写「本节未取数，可再说促销折扣/出清/分担」）

### 三、库存订货
（有 getShopInventoryOverview 则按 inventory-report；日粒度或未取数则注明「库存仅周/月，本节跳过」）

### 四、综合诊断小结
2～5 句：先总览判断，再跨主题点最多 3 个「核心关注」（阈值未确认勿喊异常/隐患）。
```

版式统一：Markdown；`↑/↓` + ⚠️/🔴 贴数值旁；禁止 HTML；禁止编造目标进度与未取数主题。  
**金额（除客单价）一律万元、保留 2 位小数**（元÷10000）；**客单价用元、2 位小数**——与各主题 Skill §数字单位一致。

---

## 2. 取数范围（由 router 保证，本 Skill 只消费结果）

| 综合深度 | 需要已有的查询结果 |
|----------|-------------------|
| 默认（晨会/综合） | **必须** `getShopSaleOverview`（S1） |
| 含促销深拆 | 另有 S2/S3/S4 之一或全部 |
| 含库存 | 另有 S7（week/month） |

本 Skill **禁止**为补章节自行再调 MCP；缺节只声明「未取数」。若用户明确要「完整综合」且缺促销/库存，由 **router** 在进本 Skill 前补查，而不是在解读阶段查。

---

## 3. 自检

- [ ] 标题含「经营数据综合分析」语义（勿改成单主题标题）  
- [ ] 已 skill 分主题；章节规则与主题 Skill 一致  
- [ ] 未取数章节未编造数字  
- [ ] 未再调销售 MCP  
