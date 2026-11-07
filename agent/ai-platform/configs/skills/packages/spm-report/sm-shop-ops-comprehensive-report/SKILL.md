---
name: sm-shop-ops-comprehensive-report
skill_id: sm-shop-ops-comprehensive-report
description: 门店经营数据综合分析报告（Store Ops Comprehensive Analysis Report）。按 01 主题序拼装总览/品类/促销/毛利/库存成文；不查数。分主题请用对应 sm-shop-ops-*-report。
version: "1.5.0"
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

**只做整合成文**，不做查数、不写 apiName。关系总表以 **`sm-report-router` §1.1** 为准；查数预算以 **§1.3** 为准（本 Skill **禁止**暗示按周扫促销/毛利/库存/品类）。

---

## 0. 与分主题关系

| 章序 | skill_id | 01 主题 | 何时 skill |
|------|----------|---------|------------|
| 一 | `sm-shop-ops-overview-report` | 经营总览 | **必须**（至少有 S1） |
| 二 | `sm-shop-ops-category-report` | 品类管理 | 有 P1/P8/P9 等 |
| 三 | `sm-shop-ops-promo-report` | 促销与价格 | 有**门店** S2/S3/S4；仅有 overview 促销占比则本章写轻量 3～5 行 |
| 四 | `sm-shop-ops-margin-report` | 毛利与损耗 | 有 S8/S9/S10；仅有 overview 毛利损耗则轻量对照或注明「专项未取」 |
| 五 | `sm-shop-ops-inventory-report` | 库存与订货 | 有门店 S7（周月）；日粒度注明跳过 |
| 六 | （本 Skill） | — | 综合诊断小结 |

编排：

1. 用户要**综合 / 全面诊断 / 经营分析报告** → 本 Skill  
2. 用户只要**某一主题** → **只**加载对应主题 Skill，**禁止**走本 Skill  
3. 成文前按章序 `skill()` 分主题，**版式以各主题 Skill 为准**（本 Skill 不重复贴长规则）

```
查数完成（至少 S1 有数）
  → skill(sm-shop-ops-comprehensive-report)
  → skill(overview-report)                         # 必有
  →（有品类数）skill(category-report)
  →（有门店促销专项数，或仅 overview 促销占比）skill(promo-report) 或轻量节
  →（有 S8/S9/S10 或仅 overview 毛利损耗）skill(margin-report) 或轻量节
  →（有门店 S7）skill(inventory-report)
  → §1 拼装 + 综合诊断小结
```

---

## 1. 综合报告骨架（章序 = 01 主题序）

```markdown
## {店名} · {时间标签} · 经营数据综合分析

### 一、经营总览
（遵循 sm-shop-ops-overview-report）  
（若有「按周对比」：仅用各周 **S1** 结果加一小节「分周走势」；勿要求其它主题按周展开）

### 二、品类管理
（有 P* 则按 category-report；未取数 →「本节未取数，可再说品类结构/四象限/ABC」）

### 三、促销专项
（有门店 S2～S4 则按 promo-report；仅有 overview 促销占比则轻量 3～5 行；都没有 →「可再说促销折扣/出清/分担」）

### 四、毛利与损耗专项
（有 S8/S9/S10 则按 margin-report；仅有 overview 毛利损耗则轻量对照或注明「专项未取瀑布/生鲜/低毛利」）

### 五、库存订货
（有 getShopInventoryOverview 则按 inventory-report；日粒度/未取数 →「库存仅周/月，本节跳过」）

### 六、综合诊断小结
2～5 句：先总览判断，再跨主题点最多 3 个「核心关注」（阈值未确认勿喊异常/隐患）。
```

版式统一：Markdown；`↑/↓` + ⚠️/🔴；禁止 HTML；禁止编造未取数主题。  
**金额（除客单价）万元 2 位**；**客单价元 2 位**——与各主题 Skill 一致。

---

## 2. 取数范围（由 router §1.3 保证，本 Skill 只消费结果）

| 综合深度 | 需要已有的查询结果 |
|----------|-------------------|
| 默认晨会级 | **必须** 本期 S1 |
| **完整综合（默认）** | **本期月** S1+S2～S4+S7+S8～S10+P1[+P8/P9]；**对照上月**同批 apiName 各 1 次 |
| 按周对比 | **仅**各周 S1；分周走势只写在第一章 |
| 含品类/促销/毛利/库存 | 见上「完整」；**禁止**为综合再按周扫这些接口 |

本 Skill **禁止**为补章节自行再调 MCP；缺节只声明「未取数」。缺数由 **router** 按 §1.3 补查，**禁止**按周循环深拆。

---

## 3. 自检

- [ ] 标题含「经营数据综合分析」语义  
- [ ] 章序：总览 → 品类 → 促销 → 毛利 → 库存 → 小结  
- [ ] 分周走势（若有）**仅**基于 S1  
- [ ] 已 skill 分主题；未取数章节未编造  
- [ ] 未再调销售/品类 MCP  
