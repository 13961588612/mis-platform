---
id: TASK-20260825-001
title: agent-team-bootstrap
status: done
assignee: PM
priority: P2
scope:
  - docs/agents
  - .cursor/rules
needs_ops: false
parent: null
refs:
  - docs/agents/大型项目cursor方案.md
  - docs/agents/TASK-SCHEMA.md
acceptance:
  - id: A1
    text: docs/agents 目录树与 README / TASK-SCHEMA / 定稿全文就位
    done: true
  - id: A2
    text: 四个 agent-team-*.mdc 已写入 .cursor/rules（alwaysApply: false）
    done: true
  - id: A3
    text: AGENTS.md 已指向多窗口协作入口
    done: true
created_at: 2026-08-25T08:58:00+08:00
claimed_at: 2026-08-25T08:58:00+08:00
updated_at: 2026-08-25T09:05:00+08:00
blocked_reason: null
locks:
  - docs/agents/**
  - .cursor/rules/agent-team-*.mdc
---

## 1. Goal

在 mis-platform 落地「大型项目 Cursor 方案」：任务目录、工单 schema、四席规则与开窗话术，便于后续多窗口分角色开发。

## 2. Out of scope

- 不自动打开 Cursor 多窗口（需人按 README 话术开窗）
- 不改业务代码 / 部署配置
- 不引入巡检机器人

## 3. Constraints

- 业务权威仍在 `docs/`；工单不替代 PRD/ADR
- 四席规则 `alwaysApply: false`，与全局 `agent-roles-workflow` 并存
- 不擅自 commit（由人显式要求）

## 4. Plan

- [x] 创建 tasks/defects 目录树
- [x] 写入定稿全文、TASK-SCHEMA、README
- [x] 新增 agent-team-{pm,dev,qa,ops}.mdc
- [x] 更新 AGENTS.md 入口
- [x] 本单归档为样板

## 5. DEV Log

- 2026-08-25 | 落地 docs/agents + 四席规则 + AGENTS 入口 | 目录与文件存在性检查 | pass

## 6. QA Log

- 2026-08-25 | 核对落地清单 §11 条目 A1–A3 | pass | 见 acceptance

## 7. OPS Log

（无需）

## 8. Decision Log

- 采用半自动值班；不定制 UI 巡检（与定稿 §9 一致）
