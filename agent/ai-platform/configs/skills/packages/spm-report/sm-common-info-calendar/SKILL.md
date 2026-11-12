---
name: sm-common-info-calendar
skill_id: sm-common-info-calendar
description: ADS 日/周/月清单、按月日列表、最新有数日周月。销售时间键必须来自本 Skill；禁止公历臆造。
version: "1.1.1"
category: supermarket
tags:
  - 超市
  - 日历
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

# 日历清单

工具 **`callCommonInfoApi`**（`mcp-sm-api-suite`）。只传 `apiName` + `params`。禁止 `serviceName` / `identity`。键与销售 ADS 同一套，禁止公历自算。

行字段：`ordDate` / `ordWeek` / `ordMonth` / `startDate` / `endDate`。日行 `ordWeek` 恒 `null`。根 `grain`：`day` | `week` | `month`。

| 意图 | apiName | params |
|------|---------|--------|
| 昨天 / 最新可查日 | `getLatestBusinessDate` | `{}` |
| 某月有哪些天 / **日报对比日** | **`listMonthDates`** | `year` + `month`(1–12) |
| 全年有哪些天 | `listYearDates` | `year`（**日报禁止**） |
| 周次 / 第几周 | `listYearWeeks` | `year` |
| 月度清单 | `listYearMonths` | `year` |
| 最新周 / 最新月 | `getLatestBusinessWeek` / `Month` | `{}` |

```json
{ "apiName": "listMonthDates", "params": { "year": 2026, "month": 11 } }
```

日报上一经营日：本月 `listMonthDates`；跨月再打上月，**禁止**改打 `listYearDates`。销售入参用清单行的键或起止，不要臆造。
