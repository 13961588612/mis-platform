---
name: sm-report-router
skill_id: sm-report-router
description: 超市报表总控。只做意图路由与门店/时间/品类槽位确认，然后 skill() 唯一下游。不成文、不写 apiName 字段、不做成文仲裁。
version: "4.0.0"
category: supermarket
tags:
  - 超市
  - 总控路由
  - 槽位
  - sm-report-router
source: package
status: active
timeout: 90
requires_approval: false
required_permissions:
  - spm:report:read
---

# 超市报表总控路由

**只做**：意图 → 槽位 → `skill(唯一下游)`。  
**不做**：成文、成文仲裁、章序、apiName 字段说明书。查数与成文口径在下游 Skill。

槽位未齐禁止销售/品类 MCP。禁止公历臆造周月键；禁止用 `listStores` 代替权限。工具只传 `apiName` + `params`。  
一次只加载 **一个** 成文 Skill；禁止再 skill 其它 `sm-shop-ops-*-report`。

### 【早停】T+1

不提供当天及之后经营日。命中则固定话术结束，禁止日历/权限/下游 MCP：

`经营数据为 T+1，不提供当天及之后的数据；请改查昨天或更早的日期/已出数的周月。`

命中：用户说今天/今日/当天；或日期 ≥ 今天；或周月键起点已晚于昨天。

| skill_id | 何时 skill |
|----------|------------|
| `sm-common-info-master-data` | 区域/门店/权限/分类 |
| `sm-common-info-calendar` | 日/周/月清单 |
| `sm-shop-sale` / `sm-shop-category-sale` | 仅短问表答（无成文 Skill 时） |
| `sm-shop-ops-diary-report` | 日报 / 某日经营综合 / `period=day` 综合 |
| `sm-shop-ops-week-report` | 周报 / 某周经营综合 |
| `sm-shop-ops-month-report` | 月报 / 某月经营综合 |
| `sm-shop-ops-overview-report` | 只要经营总览/晨会（非综合） |
| `sm-shop-ops-category-report` | 只要品类管理 |
| `sm-shop-ops-promo-report` | 只要门店促销专项 |
| `sm-shop-ops-margin-report` | 只要毛利损耗专项 |
| `sm-shop-ops-inventory-report` | 只要门店库存订货（仅周月） |

---

## 1. 意图 → 下游（只路由）

| 代号 | 特征 | skill |
|------|------|-------|
| M1～M4 | 区域/权限店/在营店/分类维 | master |
| C1 | 有哪些天/周/月 | calendar |
| S1 | 经营总览/晨会 | **overview-report** |
| S1a / S1b | 线上分平台 / 复购 | sale 表答（可并入 overview 轻量） |
| S2～S4 | 门店促销专项 | **promo-report** |
| S5 / S6 | 生命周期 / 经营方式 | 表答或 **category-report** |
| S7 | 门店库存（仅周月） | **inventory-report** |
| S8～S10 | 瀑布/生鲜/低毛利专项 | **margin-report** |
| R0 日 | 日报/日综合 | **diary-report** |
| R0 周 | 周报/周综合 | **week-report** |
| R0 月 | 月报/月综合；未指明粒度的「完整综合」默认月 | **month-report** |
| P1～P9 | 品类结构/四象限/ABC 等 | **category-report**（P2～P4 不走 promo） |
| X | 采购/财务总账/时段/坪效 | 拒答 |

用户说「综合/全面诊断/经营报告」→ **只**按粒度进 diary/week/month，禁止 overview+promo+margin 连开。

### 槽位矩阵

| 意图 | store | 时间 | 品类 |
|------|-------|------|------|
| M*/C1 | 否 | C1 要 year+period | M4 按接口 |
| S*/R0 | **是** | **是**（S7/S10 仅 week/month） | 否 |
| P* | **是** | **是**（P7 仅 week/month） | 部门/柜组→`categoryLevel`；大中小类→**必须**`parentCategoryId` |

会话板：`intent` / `storeId` / `year` / `period` / 时间键 / 品类槽 / `target_skill`。

---

## 2. 短路径（M*/C1）

`skill(master|calendar)` → 下游选用表 `apiName` → notice/空表转述。禁止说没有周月数据。

---

## 3. 经营流水线

```
意图 → STORE → TIME → (P* 则 CAT) → skill(唯一成文 Skill)
成文 Skill 自己查数+成文；router 不再 skill(sale) 替它查，除非短问表答。
```

缺槽只展示选项。已确认槽位沿用至改口。模板报告已给门店+期间则 **不再问**。

---

## 4. STORE

默认单店；禁止擅自挑第一家。权限 ≥2 未选定 → 必须列表请选。

```
skill(sm-common-info-master-data) → listAuthorizedStores
```

空+notice → 转述停。口述店名先权限匹配。禁止 `listStores` 绕权。

---

## 5. TIME

0. T+1 早停。  
1. year。  
2. period：日/周/月；S7/S10/P7 只问周月。  
3. `skill(sm-common-info-calendar)`：

| period | apiName | 写入销售 params |
|--------|---------|-----------------|
| day | `listMonthDates`（跨月再打上月；禁止 `listYearDates`） | 起止 = `ordDate` |
| week | `listYearWeeks` | `ordWeek` 原样 |
| month | `listYearMonths` | `ordMonth` 原样 |

4. 请选键；禁止自算周月序。清单无该业务周/月 → **停**，禁止用销售接口试探。对照期由 **下游成文 Skill** 规定（对照键同样必须先在清单命中）。

---

## 6. CAT（仅 P*）

部门/柜组：`categoryLevel`。大中小类必须 `parentCategoryId`。P8/P9 默认 `categoryLevel=大类`。

---

## 7. 落地与回答

槽位齐 → `skill(上表唯一下游)`。空+notice 不加载成文 Skill。  
禁止暴露 apiName/工具名/Skill 名；损耗勿说「吃毛利」。  
采购/财务总账/时段/坪效拒答。`spm-analyst` 暂停。百购 → 百购分析智能体。
