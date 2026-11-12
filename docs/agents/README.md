# Agent 团队协作（多窗口 Cursor）

> 定稿全文：[大型项目cursor方案.md](./大型项目cursor方案.md)  
> 工单字段：[TASK-SCHEMA.md](./TASK-SCHEMA.md)

用 **4 个 Cursor Agent 窗口**模拟 PM / DEV / QA / OPS。工作单元是 **任务文件**，不是角色日记。业务权威仍在 `docs/`（PRD/ADR/API），工单只承载执行与回执。

## 目录

```text
docs/agents/
  tasks/inbox|active|blocked|done/YYYY/MM
  defects/open|done/YYYY/MM
```

活跃扫描范围：**仅** `inbox/` + `active/` + `blocked/` + `defects/open/`。不要扫 `done/`。

## 开窗标准话术（每个窗口第一条消息）

复制到对应窗口，并在 Cursor Rules 中**手动启用**同名 `agent-team-*` 规则：

| 窗口建议名 | 启用规则 | 第一条消息 |
|------------|----------|------------|
| `agent-pm` | `agent-team-pm` | `你是 agent-pm。严格遵守 agent-team-pm 与仓库规范。只管理 docs/agents/tasks 与缺陷分流。不改业务代码。` |
| `agent-dev` | `agent-team-dev` | `你是 agent-dev。只领取 assignee 匹配的工单。实现后更新 DEV Log 与 acceptance 自检，再移交 QA（改 assignee=QA，保持在 active）。` |
| `agent-qa` | `agent-team-qa` | `你是 agent-qa。只做验证与缺陷单。通过则归档到 done/YYYY/MM；失败则开 DEF 并回派 DEV。` |
| `agent-ops` | `agent-team-ops` | `你是 agent-ops。仅处理 needs_ops:true 且 assignee=OPS 的单。` |

全局底线规则 `agent-roles-workflow.mdc` / `git-and-review.mdc` **保持 alwaysApply**；四席规则为**额外**约束，默认 `alwaysApply: false`，按窗口启用。

## 端到端流程（摘要）

```text
人 → 只对 PM 下需求
  PM → 写 TASK 到 inbox/
  DEV → inbox→active → 实现 → assignee=QA
  QA → pass → done/YYYY/MM；fail → DEF → DEV → QA 复验
  needs_ops → OPS → QA 复验 → 归档
  需人决策 → blocked/，人确认后 PM 解除
```

## 人每天只做

1. 给 PM 提目标与优先级  
2. 看 `tasks/blocked/` 并决策  
3. 抽查最新 `done/` 的 acceptance 与 git diff  
4. 需要入库时**显式**要求 commit  

## 样板工单

见 [`tasks/done/2026/08/TASK-20260825-001-agent-team-bootstrap.md`](./tasks/done/2026/08/TASK-20260825-001-agent-team-bootstrap.md)（本仓库已跑通的落地样板）。
