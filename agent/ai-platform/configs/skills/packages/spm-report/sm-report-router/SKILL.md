---
name: sm-report-router
skill_id: sm-report-router
description: 超市报表总控路由。任何超市区域/门店/分类/日历/销售/毛利/损耗/促销/折扣/出清/品类结构问数都必须先加载本技能：识别意图与必填槽位，用 MCP 拉权限门店与 ADS 日/周/月清单供操作员选择或确认，槽位齐后再 skill() 到下游并指定 apiName。触发词含：区域、门店、大统华、销售、营业额、毛利、损耗、促销、折扣、出清、品类、部门、柜组、大类、中类、小类、周、月等。
version: "2.0.0"
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

# 超市报表总控路由（sm-report-router）v2

本 Skill **只做编排**：意图识别 → 槽位收集（取数给操作员选）→ 路由到下游 Skill。  
**禁止**在槽位未齐时调用 `callShopSaleApi` / `callShopCategorySaleApi`。  
**禁止**公历臆造 `ordWeek` / `ordMonth`；**禁止**用 `listStores` 代替权限校验。

下游 Skill（均 `prompt_expose: false`，由本路由 `skill(name=…)` 加载）：

| skill_id | MCP 工具 | 职责摘要 |
|----------|----------|----------|
| `sm-common-info-master-data` | `callCommonInfoApi` | 区域 / 门店 / 权限门店 / 分类维表 |
| `sm-common-info-calendar` | `callCommonInfoApi` | 年内日/周/月 ADS 清单 |
| `sm-shop-sale` | `callShopSaleApi` | 门店级经营总览与结构指标 |
| `sm-shop-category-sale` | `callShopCategorySaleApi` | 门店内品类级结构指标 |

工具调用一律：**只传 `apiName` + `params`**；不要传 `serviceName` / `identity` / `datasourceId`。

---

## 1. 意图分流（先判，再决定走哪条流水线）

### 1.1 意图类型

| 代号 | 用户说法特征 | 流水线 | 目标 Skill |
|------|--------------|--------|------------|
| **M1** | 有哪些区域、区域列表 | 主数据短路径 | `sm-common-info-master-data` → `listAreas` |
| **M2** | 我能看哪些店 / 权限门店 | 主数据短路径 | `sm-common-info-master-data` → `listAuthorizedStores` |
| **M3** | 全部在营店 / 超市有哪些门店（默认全量口径） / 某某区域有哪些门店 / 某某门店在哪个区域、在哪个城市 | 主数据短路径 | `sm-common-info-master-data` → `listStores` |
| **M4** | 分类级别 / 部门柜组大中小类维表 / 下级分类 / 某分类编号 | 主数据短路径 | `sm-common-info-master-data` → `listCategoryLevels` / `listCategories` / `listChildCategories` / `getCategoryById` / `listTopCategories` |
| **C1** | 某年有哪些天/周/月（不查销售数） | 日历短路径 | `sm-common-info-calendar` → `listYearDates` / `listYearWeeks` / `listYearMonths` |
| **S1** | 门店总盘：营业额/客单/会员/线上/毛利/损耗/促销（概览） | **经营流水线** | `sm-shop-sale` → `getShopSaleOverview` |
| **S2** | 折扣三列 / 总折扣/促销打折/处理打折 | 经营流水线 | `sm-shop-sale` → `getDiscountStructure` |
| **S3** | 出清效率 / 出清回收 | 经营流水线 | `sm-shop-sale` → `getClearanceEfficiency` |
| **S4** | 供应商促销分担 | 经营流水线 | `sm-shop-sale` → `getSupplierPromoShare` |
| **S5** | 新品/重点/TOP/出清品结构 | 经营流水线 | `sm-shop-sale` → `getProductLifecycleMix` |
| **S6** | 经销/联营/租赁 | 经营流水线 | `sm-shop-sale` → `getVentureStructure` |
| **P1** | 门店内类别的 销售/毛利/损耗/促销概览；部门/柜组/大中小类占比 | 经营流水线 | `sm-shop-category-sale` → `getShopCategoryOverview` |
| **P2～P6** | 门店内类别的 折扣/出清/供应商/生命周期/经销联营 | 经营流水线 | `sm-shop-category-sale` → `getShopCategoryDiscountStructure` / `getShopCategoryClearanceEfficiency` / `getShopCategorySupplierPromoShare` / `getShopCategoryProductLifecycleMix` / `getShopCategoryVentureStructure` |
| **X** | 库存/采购/进销存/财务对账等 | **拒答** | 无 Skill |

**仲裁要点：**

- 出现「部门/柜组/大类/中类/小类/品类占比/结构」→ **P\***，不要走 S\*。
- 只说「销售/毛利/损耗/促销」且无品类词 → **S1**。
- 「我能看哪些店」→ **M2**；「超市有哪些门店 / 全部在营店 / 某某区域有哪些门店 / 某某门店在哪个区域或城市」→ **M3**（`listStores`：按 `storeId`/`storeName` 定位店，区域用 `areaId`/`areaname`；返回无城市字段时如实说明勿臆造）。
- 一句多问（全店总盘 + 某大类）→ **拆两次**：先 S1 再 P1，槽位复用。

### 1.2 槽位需求矩阵

| 意图 | store | year+period+时间键 | categoryLevel 或 parentCategoryId |
|------|-------|---------------------|-----------------------------------|
| M1～M4 / C1 | 否 | C1 仅需 year+period | M4 按接口 |
| S1～S6 | **是**（`storeId` 或明确 `areaId`） | **是** | 否 |
| P1～P6 | **是** | **是** | **是（二选一）** |
| X | — | — | — |

---

## 2. 主数据 / 日历短路径（无经营槽位）

1. `skill(name="sm-common-info-master-data")` 或 `skill(name="sm-common-info-calendar")`
2. 按第 1.1 节调用对应 `apiName`
3. 若返回含 `notice` 或 `items=[]`：**原样转述**，不编造清单
4. 回答用表格；结束时可问「是否继续查某店某周销售？」

`listAuthorizedStores` 软失败（人员找不到等）：`items=[]` + `notice` → 停，提示联系管理员。

---

## 3. 经营流水线（S\* / P\*）— 逐步槽位，每步可停给操作员选

```
① 意图与目标 apiName（第 1、7 节）
 → ② 门店槽位 STORE（第 4 节）— 未确认则停，展示选项
 → ③ 时间槽位 TIME（第 5 节）— 年 → 粒度 → 系统桶列表 → 选定；未确认则停
 → ④ 品类槽位 CAT（仅 P*，第 6 节）— 未确认则停
 → ⑤ skill(下游) + MCP 取数
 → ⑥ 组织回答（第 8 节）
```

**铁律：一步一确认。** 缺槽位时只展示选项/追问，**本轮不要**调用销售 MCP。  
多轮：已确认槽位写入「当前会话槽位」（见 3.1），用户未改则沿用，勿每轮重拉全量列表。

### 3.1 会话槽位板（内部维护，回答时可简述）

```
intent: S1|P1|…
storeId / storeName | areaId（若区域汇总）
year
period: day|week|month
ordWeek | ordMonth | startOrdDate+endOrdDate
categoryLevel | parentCategoryId + parentName（P*）
target_skill / target_apiName
```

---

## 4. 门店槽位 STORE

### 4.1 取权限门店（必做）

```
skill(name="sm-common-info-master-data")
→ callCommonInfoApi: { "apiName": "listAuthorizedStores", "params": {} }
```

| 结果 | 对操作员 |
|------|----------|
| `items=[]` 且有 `notice` | 转述 `notice`，**停止** |
| `items=[]` 无 notice | 「当前账号无超市门店数据权限」，停止 |
| 恰好 1 家 | 复述「将查询：**{storeId} {storeName}（{areaname}）**，请确认是否使用该店？回复「确认」或另选。」 |
| 多家 | **必须列表请选**，禁止擅自指定 |

### 4.2 多店选择展示（操作员）

```
已查询到您有权限的门店如下，请回复【门店号】或【门店名称】：

| 序号 | 门店号 | 门店名称 | 区域 |
|------|--------|----------|------|
| 1 | … | … | … |
```

- 用户回复后在 `items` 内匹配；唯一命中 → 写入 `storeId`/`storeName`。
- 匹配 0 → 「未在权限列表中找到，请从下表重选」并再贴表。
- 匹配多个 → 「匹配到多家，请用门店号精确指定」。
- **禁止**改调 `listStores` 绕过权限。

### 4.3 用户已口述店名/店号

仍先拉 `listAuthorizedStores`，再匹配；不在列表 → 无权限说明 + 再列可选店。

### 4.4 区域汇总

仅当用户明确「按区域汇总 / 查某区域」且接口支持 `areaId`：确认区域（可先 `listAreas`）后写 `areaId`，**不要**同时瞎填 `storeId`。  
未明确区域汇总时默认单店 `storeId`。

---

## 5. 时间槽位 TIME（顺序固定）

### 5.1 年份 `year`

| 用户说法 | 动作 |
|----------|------|
| 已给四位年 | 复述确认 |
| 今年/去年 | 按对话日换算后**复述**「按 {year} 年查询，对吗？」 |
| 未提年 | 追问：「请确认查询哪一年？（如 2026）」→ **停** |

### 5.2 粒度 `period`

| 用户说法 | `period` |
|----------|----------|
| 某日 / 哪天 / 日销售 / 起止日期 | `day` |
| 某周 / 第 N 周 / 上周 | `week` |
| 某月 / 上月 / 月度 | `month` |
| 未说清 | 追问三选一：「请选择数据粒度：①日 ②周 ③月」→ **停**；**不要默认** |

### 5.3 拉系统已有桶（日历 Skill）

```
skill(name="sm-common-info-calendar")
```

| `period` | apiName | params |
|----------|---------|--------|
| `day` | `listYearDates` | `{ "year": <year> }` |
| `week` | `listYearWeeks` | `{ "year": <year> }` |
| `month` | `listYearMonths` | `{ "year": <year> }` |

清单为空 → 「{year} 年 ADS 暂无{日/周/月}数据，请换年或换粒度」→ **停**。

### 5.4 给操作员的选择方案

**周（示例话术）：**

```
{year} 年系统中有销售数据的周如下，请回复【周键】（如 2026-W40）或序号：

| 序号 | 周键 | 起止日 |
|------|------|--------|
| 1 | 2026-W40 | 2026-09-29 ~ 2026-10-05 |
| … | … | … |
```

（周很多时可先按月分组，或只展示最近 N 周并提供「看更多」。）

**月：**

```
{year} 年系统中有数据的月份如下，请回复【月键】（如 2026-10）或序号：

| 序号 | 月键 | 起止日 |
|------|------|--------|
| … | 2026-10 | … |
```

**日：**

- 用户已给 `YYYY-MM-DD`：在 `listYearDates` 中校验；不在清单 → 「该日无落库数据，请另选」并可贴最近有数日期。
- 未给具体日：列出可选日期或请用户提供 `YYYY-MM-DD`（可提示最近有数区间）。

选定后写入：

| period | 写入字段 |
|--------|----------|
| week | `ordWeek`（清单原样） |
| month | `ordMonth` |
| day | `startOrdDate` + `endOrdDate`（单日则两端相同） |

**禁止**用公历自己算周序/月末。

---

## 6. 品类槽位 CAT（仅 P\*）

门店 + 时间已齐后：

| 用户意图 | 槽位 | 操作员交互 |
|----------|------|------------|
| 「各大类/各部门/各柜组…占比」 | `categoryLevel` ∈ {部门,柜组,大类,中类,小类} | 若未说级别：列出五级请选 |
| 「某某分类下面有哪些 / 下钻」 | `parentCategoryId` | 名称不清时：`listCategories` / `listChildCategories` / `getCategoryById` 列出候选请选 |

二者缺一不可；都缺则追问：

```
请选择品类查看方式：
① 按级别：部门 / 柜组 / 大类 / 中类 / 小类
② 按父分类下钻：请给出分类名称或编号
```

---

## 7. 路由落地（槽位齐之后）

### 7.1 加载与调用

1. `skill(name="<target_skill>")` — 正文中的 `apiName` **原样复制**，禁止猜测  
2. 组装 `params`：只含已确认槽位  
3. 调用对应 MCP 工具  

### 7.2 目标 Skill × apiName

**门店 `sm-shop-sale` + `callShopSaleApi`：**

| 意图 | apiName |
|------|---------|
| S1 总览 | `getShopSaleOverview` |
| S2 折扣 | `getDiscountStructure` |
| S3 出清 | `getClearanceEfficiency` |
| S4 供应商分担 | `getSupplierPromoShare` |
| S5 生命周期 | `getProductLifecycleMix` |
| S6 经销联营 | `getVentureStructure` |

**品类 `sm-shop-category-sale` + `callShopCategorySaleApi`：**

| 意图 | apiName |
|------|---------|
| P1 总览 | `getShopCategoryOverview` |
| P2 折扣 | `getShopCategoryDiscountStructure` |
| P3 出清 | `getShopCategoryClearanceEfficiency` |
| P4 供应商 | `getShopCategorySupplierPromoShare` |
| P5 生命周期 | `getShopCategoryProductLifecycleMix` |
| P6 经销联营 | `getShopCategoryVentureStructure` |

### 7.3 params 模板

门店总览示例：

```json
{
  "apiName": "getShopSaleOverview",
  "params": {
    "period": "week",
    "storeId": "6001",
    "ordWeek": "2026-W40"
  }
}
```

品类总览示例：

```json
{
  "apiName": "getShopCategoryOverview",
  "params": {
    "period": "week",
    "storeId": "6001",
    "ordWeek": "2026-W40",
    "categoryLevel": "大类"
  }
}
```

### 7.4 取数结果处理

| 结果 | 动作 |
|------|------|
| `items` 有数据 | 第 8 节回答 |
| `items=[]` 且 `meta.notice` | **转述 notice**，不编造经营数 |
| 工具硬错误 | 如实说明错误摘要，建议稍后重试或联系管理员 |
| 用户改店/改时间 | 回到对应槽位步骤，已确认部分可保留 |

---

## 8. 统一回答口径

**槽位阶段（未取经营数）：** 只给选项表 + 明确请操作员回复什么；不输出假数字。

**取数成功：**

1. **结论**（一句话：店 + 时间 + 指标要点）  
2. **数据表**（Markdown，每行单独成行）  
3. **口径**：`storeId`/店名、`period`、时间键、`apiName`；品类则加级别/父类  
4. **一句下钻建议**（换周 / 下钻中类 / 看折扣结构等）  
5. 损耗勿说成「吃掉了多少毛利」  
6. 禁止「与之前一致」而不重新取数  

---

## 9. 拒答与边界

- 库存/采购/进销存/财务对账/员工绩效等 → 「当前未开放该报表能力，可查销售/毛利/品类结构。」  
- NL2SQL 自由问数 → 引导「超市分析智能体」；百购 → 「百购分析智能体」。  
- 不要为补全背景编造制度或数字。

---

## 10. 自检清单（每次经营取数前）

- [ ] 意图已归到 M/C/S/P/X  
- [ ] S/P：权限门店已确认（或合法 areaId）  
- [ ] S/P：year + period + 时间键均来自日历清单或已校验日  
- [ ] P：categoryLevel 或 parentCategoryId 已确认  
- [ ] 已 `skill()` 正确下游且 `apiName` 来自 Skill 正文  
- [ ] 未传 identity / serviceName  
