---
id: TASK-20260825-002
title: copilot-new-session-history-leak
status: done
assignee: QA
priority: P0
scope:
  - frontend/mis-admin-web/src/lib/chat/useChat.ts
  - frontend/mis-admin-web/src/stores/chat-store.ts
  - frontend/mis-admin-web/src/components/chat/CopilotPanel.tsx
needs_ops: false
parent: null
refs:
  - docs/ai-fusion/agent-ops-console/copilot-p0-gaps-prd.md
  - frontend/mis-admin-web/src/lib/chat/useChat.ts
  - frontend/mis-admin-web/src/components/chat/CopilotPanel.tsx
acceptance:
  - id: A1
    text: 点击「新建会话」后对话区为空，不出现上一会话/某次历史消息（含偶发竞态场景）
    done: true
  - id: A2
    text: 新建会话生成新的 sessionId，且不再误复用 localStorage 中的旧 sid；随后发消息落在新会话
    done: true
  - id: A3
    text: 切换到已有会话仍可正确加载该会话历史；刷新/重开抽屉的「续接上次会话」行为不被破坏（与 P0-2 一致）
    done: true
  - id: A4
    text: loadHistory 在 await 返回后校验 sid 仍为当前会话，否则丢弃结果（防串会话）
    done: true
created_at: 2026-08-25T12:45:00+08:00
claimed_at: 2026-08-25T12:50:58+08:00
updated_at: 2026-08-25T13:15:18+08:00
blocked_reason: null
locks: []
---

## 1. Goal

修复 AI-COPILOT「新建会话」偶发仍显示上一次（或某次）会话历史的问题，使「新建」语义为真正的空会话。

## 2. Out of scope

- 不做完整多会话产品（会话列表/归档等属 PRD P1-1，已有侧栏能力则只保证切换正确）
- 不改 RAG / kb-sources 展示（见 TASK-20260825-003）
- 不改后端 session 表结构 / Flyway
- 不改业务 Agent 逻辑

## 3. Constraints

- 对照 `docs/ai-fusion/agent-ops-console/copilot-p0-gaps-prd.md`：**P0-2 历史自动加载保留**；本次修复的是 PRD 已记录的 **P1-2 新建会话语义错位**，并升为 P0 缺陷。
- 嫌疑点（供 DEV 核实，非定论）：
  1. `CopilotPanel.handleNewSession` → `closeSession()` 后 `ensureSession()`；`ensureSession` 无参时会读 `mis.copilot.lastSession` 并 `loadHistory`。
  2. `loadHistory` 在 `fetch` 返回后**未校验** `sessionId` 是否仍为发起时的 sid，旧请求晚到会 `setMessages` 污染新会话（偶发「有时」符合竞态）。
- 若需改 `CopilotPanel.tsx` 的新建入口，可改；但 **locks 仅锁 useChat / chat-store**，与 003 的组件锁错开。CopilotPanel 改动须最小化且不与 003 的 ChatBubble/kb-sources 改动冲突；若冲突则本单先合、003 再领。
- 不发明权限码/表结构。

## 4. Plan

1. 复现：打开 Copilot → 有历史 → 点新建 → 观察是否串历史；重点压测「历史加载未完成时立刻新建」。
2. 修复新建路径：关闭后必须开**新** sid（勿误读旧 localStorage）；消息区保持空直至用户发言。
3. 给 `loadHistory`（及同类异步回填）加 sid 世代/一致性校验。
4. 回归：续接上次会话、切换侧栏会话、新建后再发消息。

## 5. DEV Log

- 2026-08-25：根因确认——① `loadHistory` 无 sid 校验；② `closeSession` 未重置 `historyState`；③ 同 tick `sessionIdRef` 未同步；④ 新建仍可能读 localStorage。
- 修复：`ensureSession(..., { forceNew })`；`loadHistory` await 后 isStale 丢弃；`closeSession` 重置 history + 同步 ref；`handleNewSession` 走 forceNew。
- 未改 chat-store（逻辑均在 useChat）；CopilotPanel 仅改新建入口一行调用。
- 单测：`useChat.test.ts` 9 passed（含竞态丢弃 / forceNew / historyState 重置）。
- 自检 A1–A4 通过 → 移交 QA。

## 6. QA Log

- 2026-08-25T13:15+08:00 **PASS** → 归档 `done/2026/08/`
- 验收：代码审阅 A1–A4（`forceNew` 不拉历史；`persistSession` 落新 sid；无 forceNew 仍续接/拉历史；`loadHistory` 多处 `isStale`）；`handleNewSession` 走 `ensureSession(undefined, { forceNew: true })`
- 单测：`vitest run src/lib/chat/useChat.test.ts` → 9 passed（含竞态丢弃 / forceNew / historyState 重置）
- Reviewer：无权限/Flyway/密钥变更；关键竞态有单测；`needs_ops: false`；关联 DEF 无

## 7. OPS Log


## 8. Decision Log

- 2026-08-25 人报障：新建会话有时带出历史；PM 拆单，优先级按线上体验定为 P0（PRD 原文为 P1-2）。
