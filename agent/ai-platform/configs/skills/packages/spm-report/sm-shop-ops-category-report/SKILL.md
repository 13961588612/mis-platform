---
name: sm-shop-ops-category-report
skill_id: sm-shop-ops-category-report
description: 门店品类管理主题分析报告（Category Theme Report）。基于品类总览/四象限/ABC/生命周期等取数结果成文。不查数；apiName 在 sm-shop-category-sale。可被综合报告引用，也可单独做品类分析。
version: "1.2.0"
category: supermarket
tags:
  - 超市
  - 品类管理
  - 主题分析
  - sm-shop-ops-category-report
source: package
status: active
timeout: 30
requires_approval: false
required_permissions:
  - spm:report:read
---

# 品类管理主题分析（sm-shop-ops-category-report）

**只做本主题解读与成文**，不做查数。

- 取数：router → `skill(sm-shop-category-sale)` → 按意图选 apiName（见下）；门店 S5/S6 有数时可并入生命周期/经营方式节
- **禁止**再调 MCP；**禁止**编造未取到的专项数；**禁止**另写 apiName
- 加载时机：P1 / P5～P9（及「品类管理报告」已取数）成功后；或由 comprehensive **第二章**调用
- 本 Skill **只管品类维度**；门店促销全文 → promo；门店库存全文 → inventory；关系见 router §1.1

### 取数 → 章节对照（只写已有结果的节）

| 已取 apiName | 成文章节 |
|--------------|----------|
| `getShopCategoryOverview` | § 品类结构概览 |
| `getShopCategoryRoleMatrix` | § 类目角色四象限 |
| `getShopCategoryAbc` | § 类目 ABC |
| `getShopCategoryProductLifecycleMix` 或门店 `getProductLifecycleMix` | § 生命周期结构 |
| `getShopCategoryVentureStructure` 或门店 `getVentureStructure` | § 经营方式结构 |
| `getShopCategoryInventoryOverview` | § 品类库存要点（仅周月） |
| P2～P4 折扣/出清/分担 | **轻量节或一句**（默认本 Skill；**勿转 promo**） |

默认级别：**大类**（角色/ABC 尤其如此）；标题写明级别或父类下钻口径。

---

## 1. 数字单位（强制）

| 类型 | 展示 |
|------|------|
| **金额** | 元÷10000 → **万元**，**2 位小数**，后缀 `万元` |
| 占比 / 毛利率 | 百分数，1 位小数 + `%`（0～1 则 ×100） |
| 排名 / 计数 | 整数 |

禁止 HTML；勿对用户说 apiName / 字段名；勿说损耗「吃毛利」。

---

## 2. 版式骨架

```markdown
## {店名} · {时间标签} · 品类管理（{大类|中类|…}）

### 品类结构概览
| 类目 | 营业额 | 店内占比 | 前台毛利率 | 损耗率 | 促销销售占比 |
|------|--------|----------|------------|--------|--------------|
| … | **xx.xx 万元** | **x.x%** | **x.x%** | … | … |

> 按营业额占比降序，**最多 TOP10**；其余「另有 N 个类目未展开」。无 overview 则整省。

### 类目角色四象限
| 角色 | 类目数 | 营业额合计 | 代表类目（≤3） |
|------|--------|------------|----------------|
| 利润品 / 客流品 / 结构品 / 问题品 | … | … | … |

> 划线：本店中位数（`shareMedian` / `marginRateMedian`）。无 RoleMatrix 则整省。

### 类目 ABC
| 分级 | 类目数 | 营业额累计占比 | 代表类目（≤3） |
|------|--------|----------------|----------------|
| A / B / C | … | … | … |

> **必写局限一句**：类目级非单品；动销率/供应商集中度不覆盖。无 Abc 则整省。

### 生命周期 / 经营方式 / 品类库存（有数才写）
各用小表或 3～5 行要点。

### AI 诊断小结
2～4 句；最多 3 个「核心关注」。
```

---

## 3. 内部字段对照（勿对用户说出）

以 **`sm-shop-category-sale`** 为准：

| 章节 | 主要字段 |
|------|----------|
| 结构概览 | `categoryName` / `turnoverAmt` / `turnoverShare` / `frontMarginRate` / `lossRateAbs` / `promoSalesRatio` |
| 四象限 | `role` / `turnoverShare` / `frontMarginRate` / `shareMedian` / `marginRateMedian` / `summary.roleCounts` / `roleTurnoverAmt` |
| ABC | `abcClass` / `rank` / `cumulativeShare` / `summary.classCounts` / `classTurnoverShare` |
| 生命周期 | `newMainSaleAmt` / `newMainShare` / `key*` / `top*` / `clear*` |
| 经营方式 | `venture*` / `joint*` / `rent*` |
| 品类库存 | 同门店库存字段 + `categoryId` / `categoryName` |

---

## 4. 关注点（草稿）

| 关注 | 说明 |
|------|------|
| 客流品毛利率偏低 | 控损耗、盯周转；勿空喊砍品 |
| 问题品双低 | 汰换/移位候选，需业务确认 |
| A 类过度集中 | 供给风险（非单品集中度） |
| 结构品低曝光 | 可试陈列；勿编造未取数细节 |

阈值待业务确认；未确认不喊「异常」。

---

## 5. 自检

- [ ] 未查数；未编造未取到章节  
- [ ] 金额万元 2 位；占比已换算  
- [ ] 标题含店名 · 时间 · 品类管理 · 级别  
- [ ] TOP≤10；ABC 已声明类目级局限  
- [ ] 未说损耗吃毛利  
