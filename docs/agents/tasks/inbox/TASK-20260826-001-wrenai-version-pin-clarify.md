---
id: TASK-20260826-001
title: wrenai-version-pin-clarify
status: inbox
assignee: none
priority: P1
scope:
  - docs/ai-fusion/wrenai/deploy-iqd.md
  - docs/ai-fusion/wrenai/README.md
  - docs/ai-fusion/wrenai/architecture.md
  - docs/ai-fusion/wrenai/tasks.md
  - docs/ai-fusion/wrenai/baseline-execution.md
needs_ops: false
parent: null
refs:
  - docs/ai-fusion/wrenai/deploy-iqd.md
  - https://pypi.org/project/wrenai/0.13.3/
  - https://github.com/Canner/WrenAI/releases/tag/wren%3A%20v0.13.3
  - https://github.com/Canner/WrenAI/releases/tag/0.29.2
acceptance:
  - id: A1
    text: 文档唯一运行时钉位为 PyPI/CLI「wrenai / wren: v0.13.3」（pip install + wren serve mcp）；不再把 GitHub「0.29.2」写成可与之同装/同钉的配套版本
    done: false
  - id: A2
    text: 对「0.29.2」单独标注为经典 launcher / GenBI Classic（wren-ui + wren-ai-service）发布线，与 MCP 新线不兼容、勿混用
    done: false
  - id: A3
    text: architecture / README / tasks / baseline 中「wren: v0.13.3 · 项目 0.29.2」并列表述已改正或加醒目不兼容说明
    done: false
created_at: 2026-08-26T09:04:00+08:00
claimed_at: null
updated_at: 2026-08-26T09:04:00+08:00
blocked_reason: null
locks:
  - docs/ai-fusion/wrenai/**
---

## 1. Goal

纠正 WrenAI 版本钉位表述：人核实 **`wren: v0.13.3` 与 GitHub 项目标签 `0.29.2` 不兼容（不可当作同一产品线配套）**；文档停止「两粒度同一钉位」写法，避免运维/开发混装。

## 2. Out of scope

- 不改 `mis-iqd` 业务代码、MCP client、Flyway
- 不升级/降级实际运行中的 Wren 安装（仅文档；若环境已混装，另开 OPS/DEV 环境修复单）
- 不重新选型对接形态（仍维持架构已定：**MCP-first 新线**）

## 3. Constraints

- **事实（人核实 + 公开发布页）**：
  - `wren: v0.13.3` = PyPI `wrenai` / CLI + `wren serve mcp`（新线，本仓库对接主路径）
  - GitHub `0.29.2` = **wren-launcher** 资产 + changelog 指向 `wren-ui` / `wren-ai-service`（经典 Docker GenBI 栈），与 MCP 新线**不是**可互换/可同装的配套版本
- 既有架构决策不变：对接主路径仍是 `pip install wrenai` + `wren serve mcp`（见 architecture Q1）；本单只纠「版本标签误绑」
- 纯文档；改完可直接归档 `done/YYYY/MM/`（assignee 可为 PM 或 DEV-docs）
- 不发明权限码/表结构

## 4. Plan

1. 以 `deploy-iqd.md` §0 为权威钉位表：只保留 `wrenai==0.13.3` / `wren: v0.13.3`；`0.29.2` 移入「勿混用 / 经典线」说明。
2. 全文检索 `0.29.2` 与「同一钉位」类表述，按 A1–A3 统一改正。
3. 可选：在 Decision Log 引用人结论「两者不兼容」。

## 5. DEV Log


## 6. QA Log


## 7. OPS Log


## 8. Decision Log

- 2026-08-26 人反馈：查下来 `wren: v0.13.3` 与项目标签 `0.29.2` **不兼容**。PM 认同：二者属不同发布线（MCP CLI vs classic launcher），原「两粒度无冲突」表述有误，开本单纠偏。
