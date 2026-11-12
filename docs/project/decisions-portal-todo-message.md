# 门户 · 待办事项 · 消息中心 — 产品决策纪要

| 项 | 内容 |
|----|------|
| 状态 | ✅ 已拍板（门户重构 PRD v0.2 + 设计 v1.3；「全部」聚合见增量设计；**消息抽屉 2026-10-14 修订**） |
| 日期 | 2026-10-10 起；本纪要整理 2026-10-14；D-9 修订同日 |
| 权威上游 | [portal-restructure-prd.md](../prd/portal-restructure-prd.md)、[portal-restructure-design.md](../design/portal-restructure-design.md)、[portal-matters-aggregation-design.md](../design/portal-matters-aggregation-design.md) |
| 范围 | 管理台 `/portal`：首页 / **待办事项** / **消息中心**；不含独立子系统左栏改版 |

> 本文是**决策摘要**，便于运维/研发快速对齐；细则、接口与任务分解仍以 PRD / 设计文档为准。变更须同步改本文 + 上游 PRD/设计。

---

## 1. 产品定位

| 决策 | 结论 |
|------|------|
| 门户角色 | 从「入口跳板」升级为「**个人工作聚合台**」：待办 + 消息一处总览 |
| 详情交互 | 列表点击 → **右侧抽屉**看流程详情（表单 + 进度 + 审批信息），**不离开门户壳**（表单/流程引擎决策见 [decisions-form-workflow.md](decisions-form-workflow.md)） |
| 与旧页关系 | `/task/pending`、`/task/inbox`、`/task/my-sent`、`/task/my-processed` **保留共存、不废弃、不重定向**（门户是并行聚合视图） |

---

## 2. 信息架构

### 2.1 门户三 Tab

| Tab | 内容 |
|-----|------|
| **首页** | 沿用原门户区块（欢迎 / 概览 / TaskBoard / MessageBoard / ProcessBoard / AppRail） |
| **待办事项** | 个人待办与流程相关事项聚合（子 Tab，见下） |
| **消息中心** | 个人收件箱按消息类型分子 Tab |

| 决策 ID | 结论 |
|---------|------|
| D-1 | **仅** `/portal` 隐藏左侧 sidebar；其它子系统保留左栏 |
| （实现） | 三 Tab **单页内切换**，**不新增路由**；激活态存前端 store，**不进 URL**（规避 keep-alive） |
| D-8 | 抽屉为**临时态、不入 URL** |

### 2.2 待办事项 · 子 Tab

| 决策 ID | 结论 |
|---------|------|
| D-6 / Q7 | 六类字面独立，**不合并语义**（「待处理」≠「审批中」） |
| D-5 / Q3 | **各子 Tab 内独立搜索**；不做跨 Tab 全局搜索（全局为 P2） |

**六类（基线）**：

| key | 标签 | 数据源 |
|-----|------|--------|
| `pending` | 待处理 | `GET /tasks/my?status=PENDING` |
| `approving` | 审批中 | `GET /tasks/my?status=APPROVING` |
| `approved` | 已通过 | `GET /tasks/my?status=APPROVED` |
| `rejected` | 已驳回 | `GET /tasks/my?status=REJECTED` |
| `mySent` | 我发起的 | `GET /workflow/instances/my` |
| `myHandled` | 我审批的 | `GET /tasks/handled` |

**增量（「全部」）**——见 [portal-matters-aggregation-design.md](../design/portal-matters-aggregation-design.md)：

| 决策 | 结论 |
|------|------|
| 「全部」 | 新增子 Tab；**服务端 UNION 分页**（禁止前端六源本地合并） |
| 语义 | 我相关事项：`assignee=我` 的全部状态任务 ∪ `initiator=我` 的流程实例 |
| 默认选中 | 「全部」可为默认；命令面板进「待办事项」落「全部」 |
| 搜索增强 | 支持关键词 + **发起人 / 参与人**（作用全部子 Tab） |

### 2.3 消息中心 · 子 Tab

| 标签 | `msg_type` | 说明 |
|------|------------|------|
| 审批 | `APPROVAL` | 审批类 |
| 通知 | `NOTIFY` | 结果通知（用户口头「通过」= 此类，**不是**独立 msg_type） |
| 提醒 | `REMIND` | 提醒 |
| 系统告警 | `SYSTEM_ALERT` | 系统 |

| 决策 ID | 结论 |
|---------|------|
| D-5 | 消息搜索为**当前子 Tab 作用域**（后端 `/messages/search` 须带 `msgType`；空=兼容跨类型） |
| D-2 / PR-08 | **消息 ↔ 流程实例**须可关联（如 `instance_id`）；发通知时写入线索；缺省时可由 `reference_task_id → wf_task` 反查 |
| D-9 / PR-18 | 见下方 **§2.4**（2026-10-14 修订：关闭独立回复，意见走审批栏） |

### 2.4 消息抽屉 · 流程形态（2026-10-14 拍板）

| 决策 ID | 结论 |
|---------|------|
| D-9（修订） | **关闭**消息抽屉内的独立「回复」输入框；`canReply` 恒为 `false`（字段保留契约） |
| （形态） | `instanceId != null` → 嵌入 **`ProcessShell(embedded)`**，与待办抽屉同构：表单 + 进度 + 审批信息；`instanceId == null` → 仅展示消息正文/元信息 |
| （可批） | 当前用户对该实例有 **PENDING** 任务 → 可立即同意/驳回/转办；**审批意见 = 审批栏 comment**（非独立回复） |
| （只读） | 非当前审批人（或流程已结束）→ 只读浏览；底部提示「当前节点由他人处理」/「流程已结束」；**不可回复** |
| （线索） | 发任务/通知时写入 `instance_id`；旧数据缺省时可由 `reference_task_id → wf_task` 反查 |

> **相对 PRD v0.2 D-9 / PR-18 的变更说明**：原「抽屉内自由回复 → `wf_history(COMMENT)`」产品诉求，收敛为「能批则在 ProcessShell 批，意见即审批意见」。历史 `POST /messages/{id}/reply` 可保留兼容，门户 UI 不再调用。

---

## 3. 抽屉与审批动作

| 决策 ID | 结论 |
|---------|------|
| D-4 / Q2 | 待办抽屉内可直接：**同意 / 驳回 / 转办**（P0） |
| D-9（消息） | 关联流程的消息抽屉与待办抽屉同构：嵌入 `ProcessShell(embedded)`；是否可批由引擎判定「当前用户是否有 PENDING 任务」 |
| D-7 / Q1 | 抽屉保留「进入完整详情页」入口（P1） |
| D-10 | **「回退 / 退回发起人」本轮不做** |

**动作语义（引擎现状，产品须如实对外）**：

| 动作 | 含义 |
|------|------|
| 同意 `APPROVE` | 推进流程 |
| 驳回 `REJECT` | **终止整个实例**并通知发起人（**不是**退回重填） |
| 转办 `transfer` | 改处理人，任务回 `PENDING`，给新处理人补发提醒 |

---

## 4. 仍待拍板

| # | 问题 | 状态 |
|---|------|------|
| Q4 | 六类 / 四类子 Tab 是否显示计数徽标 | ⏳ 待定（建议 P1） |
| Q5 | 消息未读红点 / 角标规则（门户 Tab、子 Tab、列表项） | ⏳ 待定（建议 P2） |

---

## 5. 明确不做（边界）

| ID | 边界 |
|----|------|
| B-1 | 旧四页不废弃、不重定向 |
| B-2 | 仅门户隐藏左栏 |
| B-8 / D-10 | 不做「回退发起人」 |
| B-9（修订） | **不做**消息抽屉独立「回复 / 站内私信」；意见仅经审批栏（当前审批人） |
| （聚合） | 不做前端合并多接口伪造「全部」分页 |
| （搜索） | 本轮不做跨待办+消息的全局搜索 |

---

## 6. 文档与代码入口

| 类型 | 路径 |
|------|------|
| PRD | `docs/prd/portal-restructure-prd.md` |
| 系统设计 | `docs/design/portal-restructure-design.md` |
| 「全部」增量设计 | `docs/design/portal-matters-aggregation-design.md` |
| 前端 | `frontend/mis-admin-web/src/features/portal/` |
| 全局决策索引 | [decisions.md](decisions.md) §门户工作台 |
