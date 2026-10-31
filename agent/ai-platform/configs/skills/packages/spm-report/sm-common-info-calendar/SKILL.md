---
name: sm-common-info-calendar
skill_id: sm-common-info-calendar
description: 指定年份的日历清单（日清单、周清单、月度清单）。当用户或后续销售查询需要知道某年有哪些日期/周/月、某周起止日、某月起止日，或要把自然语言时间落到 startDate/endDate 时触发。
version: "1.0.0"
category: supermarket
tags:
  - 超市
  - 日历
  - 周键
  - 月键
  - sm-common-info-calendar
source: package
status: active
timeout: 30
requires_approval: false
required_permissions:
  - spm:report:read
handler: mcp:mcp-sm-api-suite:callCommonInfoApi
mcp_server: mcp-sm-api-suite
---

# 日历清单（sm-common-info-calendar）

通过 MCP 工具 **`callCommonInfoApi`** 查询指定年份在 **销售 ADS 中已出现的** 日 / 周 / 月清单，用于对齐销售查询的时间参数（键与起止日与销售表一致）。

---

## MCP 与调用前提

- MCP 服务名：**`mcp-sm-api-suite`**
- 工具：**`callCommonInfoApi`**（不是 `callShopSaleApi`；平台工具名形如 `mcp__mcp-sm-api-suite__callCommonInfoApi`）
- 只传 **`apiName`** + **`params`**
- **不要传 `serviceName`**
- **不要传、不要构造 `identity`**（由 MCP 调用链自动注入；本能力无权限）

---

## 口径（必读）

| 接口 | 数据来源（DISTINCT 日历键） |
|------|---------------------------|
| `listYearDates` | `ads_spm_trd_cpi_category_day_df` |
| `listYearWeeks` | `ads_spm_trd_cpi_category_week_df` |
| `listYearMonths` | `ads_spm_trd_cpi_category_month_df` |

- `ordDate` / `ordWeek` / `ordMonth` / `startDate` / `endDate` **与销售查询使用同一套 ADS 字段**，不要自行按公历推算周起止。
- 清单是「有落库桶」的集合，**不一定**等于完整公历 365 天 / 52 周 / 12 月；缺行表示该日/周/月在 ADS 中尚无对应键。
- 周几开头、周键字符串格式以表内 `ord_week`、`dlweekstart`/`dlweekend` 为准，模型原样使用即可。
- **日表无 `ord_week`**：`listYearDates` 返回的 `ordWeek` 恒为 `null`；`ordMonth` 由日期前缀 `YYYY-MM` 推导。
- **周表无 `ord_month`**：`listYearWeeks` 的 `ordMonth` 由 `dlweekstart` 前缀推导（便于展示，跨月周取起始月）。
- 过滤口径：`data_type = '门店'`（与销售查询一致）。

---

## 1 统一行字段（三个接口相同）

每一行都是同一套字段，用哪些有值区分「日 / 周 / 月」：

| 字段 | 类型 | 含义 | 示例 |
|------|------|------|------|
| `ordDate` | `string \| null` | 日期键（= ADS `ord_date`） | `"2026-10-07"`；非日清单为 `null` |
| `ordWeek` | `string \| null` | 周键（= ADS `ord_week` 原样） | `"2026-W40"` |
| `ordMonth` | `string \| null` | 月键（= ADS `ord_month`） | `"2026-10"` |
| `startDate` | `string` | 该行覆盖起点（含） | `"2026-09-29"` |
| `endDate` | `string` | 该行覆盖终点（含） | `"2026-10-05"` |

**如何看出这一行是日还是周还是月：**

| 判断 | 条件 |
|------|------|
| 日行 | `ordDate != null` |
| 周行 | `ordDate == null` 且 `ordWeek != null` |
| 月行 | `ordDate == null` 且 `ordWeek == null` 且 `ordMonth != null` |

也可看返回根上的 **`grain`**：`"day"` / `"week"` / `"month"`。

**统一返回外壳：**

```json
{
  "year": 2026,
  "grain": "week",
  "items": [
    {
      "ordDate": null,
      "ordWeek": "2026-W40",
      "ordMonth": "2026-09",
      "startDate": "2026-09-29",
      "endDate": "2026-10-05"
    }
  ]
}
```

---

## 2 能力清单

### 2.1 查询指定年份的日期清单

| 项目 | 说明 |
|------|------|
| `apiName` | `listYearDates` |
| `params` | `year`（四位年份，必填，如 `2026`） |
| 数据 | `ads_spm_trd_cpi_category_day_df` DISTINCT |
| 返回 | `grain: "day"`；行数=该年 ADS 出现过的天数；每天 `ordDate=startDate=endDate`；`ordWeek=null`；`ordMonth=YYYY-MM` |

```json
{ "apiName": "listYearDates", "params": { "year": 2026 } }
```

---

### 2.2 查询指定年份的周清单

| 项目 | 说明 |
|------|------|
| `apiName` | `listYearWeeks` |
| `params` | `year`（必填） |
| 数据 | `ads_spm_trd_cpi_category_week_df` DISTINCT |
| 返回 | `grain: "week"`；行数=该年 ADS 出现过的周数；`ordDate` 为 `null`；`startDate`~`endDate` = `dlweekstart`~`dlweekend` |

```json
{ "apiName": "listYearWeeks", "params": { "year": 2026 } }
```

> 跨年周：以 `ordWeek` 的年份归属为准；`startDate`/`endDate` 可落在相邻公历年。

---

### 2.3 查询指定年份的月度清单

| 项目 | 说明 |
|------|------|
| `apiName` | `listYearMonths` |
| `params` | `year`（必填） |
| 数据 | `ads_spm_trd_cpi_category_month_df` DISTINCT |
| 返回 | `grain: "month"`；行数=该年 ADS 出现过的月数（通常 12）；`ordDate`/`ordWeek` 为 `null`；`startDate`~`endDate` = `dlmonbegin`~`dlmonend` |

```json
{ "apiName": "listYearMonths", "params": { "year": 2026 } }
```

---

## 3 选用指引（给大模型）

| 用户说法 / 意图 | 调用 |
|-----------------|------|
| 2026 年有哪些天 / 某天对应哪周 | `listYearDates` |
| 2026 年第几周、这周从几号到几号 | `listYearWeeks` |
| 2026 年各月起止、查某月 | `listYearMonths` |
| 要把「上周 / 上月 / 10 月第 2 周」落到销售查询的时间参数 | 先本 Skill 取清单，再把选中行的键/`startDate`/`endDate` 传给销售接口 |

**与销售查询配合：**

1. 销售接口要 `period` + 对应时间键（及门店/区域）
2. 用本 Skill 的 `items[]` 填 `ordWeek` / `ordMonth` 或日区间，**不要臆造日期**
3. 若销售按周/月表查，优先用 `listYearWeeks` / `listYearMonths` 选桶，保证区间与桶对齐
