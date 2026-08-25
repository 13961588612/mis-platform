---
id: TASK-20260825-003
title: copilot-rag-kb-sources-ui
status: done
assignee: QA
priority: P0
scope:
  - frontend/mis-admin-web/src/components/common/kb-chat-sources.tsx
  - frontend/mis-admin-web/src/components/chat/CopilotPanel.tsx
  - frontend/mis-admin-web/src/features/agent/ai/ai-chat-panel.tsx
  - frontend/mis-admin-web/src/features/agent/components/agent-message-stream.tsx
needs_ops: false
parent: null
refs:
  - frontend/mis-admin-web/src/components/common/kb-chat-sources.tsx
  - agent/ai-platform/frontend/src/utils/kbSources.ts
  - agent/ai-platform/frontend/src/hooks/useChat.ts
  - agent/ai-platform/backend/src/agent/mis_rag/qa_pipeline.py
  - frontend/mis-admin-web/src/features/agent/ai/qa-page.tsx
acceptance:
  - id: A1
    text: RAG 回复正文为 Markdown 渲染；文末不再把 ```kb-sources JSON 原文（含 score/chunk/\n）直接铺在气泡里
    done: true
  - id: A2
    text: 来源区对齐旧版体验（图1）：折叠条「来源 · N 篇」，可展开；条目可读（文档名等），非原始 JSON 堆砌
    done: true
  - id: A3
    text: 流式过程中未闭合围栏时不闪现乱码 JSON；流结束后能正确剥围栏并展示来源列表（或明确降级文案）
    done: true
  - id: A4
    text: 全局 Copilot 抽屉与页面级对话壳（ai-chat-panel 等）行为一致，均复用 splitKbSources / KbChatSourceList（或等价组件）
    done: true
created_at: 2026-08-25T12:45:00+08:00
claimed_at: 2026-08-25T13:17:41+08:00
updated_at: 2026-08-25T13:23:19+08:00
blocked_reason: null
locks: []
---

## 1. Goal

修复 AI-COPILOT / 业务对话壳中 RAG 返回「正文未妥善处理 + 来源乱糟糟」的问题，恢复旧版前端展示：正文 Markdown + 可折叠「来源 · N 篇」（对比人提供的图1 vs 图2）。

## 2. Out of scope

- 不改检索算法 / 命中质量 / 知识库内容
- 不改新建会话串历史（TASK-20260825-002）
- 不擅自改已确认产品决策；不新造引用来源 API
- 若确认是后端围栏格式破坏性变更，**只开 DEF/回派或 Decision Log 等人/架构确认**，本单前端先做兼容解析，不改表结构

## 3. Constraints

- **权威参考（旧实现，按此对齐 UI/解析）**：
  - 管理台：`frontend/mis-admin-web/src/components/common/kb-chat-sources.tsx`（`splitKbSources` / `KbChatSourceList` / `KbChatSourceFigures`）
  - 独立前端：`agent/ai-platform/frontend/src/utils/kbSources.ts`；流式晚到围栏补丁见同目录 `hooks/useChat.ts`（`delta.includes("kb-sources")` 分支）
  - 后端约定：`format_kb_answer_for_chat` 文末附 ` ```kb-sources\n{json}\n``` `（`qa_pipeline.py`）
- 图1 期望：正文条款结构清晰；底栏「来源 · N 篇 展开」。
- 图2 现状：气泡内直接露出 `kb-sources` + JSON 数组（score/chunk 原文），形似围栏未被剥除即交给 Markdown 渲成 code block。
- `CopilotPanel` 的 `ChatBubble` **已调用** `splitKbSources`；DEV 须先核实失败原因（正则过严、围栏未闭合、历史消息路径未走 ChatBubble、流式拼接丢 fence 等），再最小修复，禁止另起一套来源 UI。
- **locks 不含** `useChat.ts`（由 002 占用）。若必须改流式拼接才能修 A3：在 Decision Log 注明依赖，等 002 归档后再改，或与 002 DEV 协商交接 locks——**禁止双单并行改同一文件**。

## 4. Plan

1. 用真实 RAG 回复（含 `kb-sources` 围栏）在 Copilot 复现图2。
2. 对照 `splitKbSources` / 旧版 `kbSources.ts` 与气泡渲染路径，定位围栏未剥除点。
3. 最小修复：解析健壮性 + 确保 `KbChatSourceList` 折叠展示；流式未闭合时隐藏原始 JSON。
4. 回归：流式中/结束后、历史恢复消息、qa-page / ai-chat-panel 同源路径。

## 5. DEV Log

- 2026-08-25：根因——① `FENCE_RE` 过严（` ``` kb-sources` 空格、闭合前无 `\n` 等 → 整段漏剥进 Markdown）；② done 后晚到围栏缺旧版拼接，可能另起气泡。
- 修复：`splitKbSources` 放宽开/闭围栏匹配；未闭合仍截断隐藏 JSON；`useChat` 补 `appendLateKbSourcesDelta`（002 已 done）。
- CopilotPanel / ai-chat-panel / agent-message-stream **已复用** split+KbChatSourceList，未改 UI 组件壳。
- 单测：`kb-chat-sources.test.ts` 6 + `useChat.test.ts` 9 → 15 passed。
- 自检 A1–A4 → 移交 QA。

## 6. QA Log

- 2026-08-25T13:23+08:00 **PASS** → 归档 `done/2026/08/`
- 验收：A1 `splitKbSources` 放宽开/闭围栏后正文与 JSON 分离；A2 `KbChatSourceList`「来源 · N 篇」折叠；A3 未闭合截断隐藏 + `appendLateKbSourcesDelta`；A4 CopilotPanel / ai-chat-panel / agent-message-stream 均复用同一套组件
- 单测：`kb-chat-sources.test.ts` 6 + `useChat.test.ts` 9 → **15 passed**
- Reviewer：无权限/Flyway/密钥；解析关键路径有单测；`needs_ops: false`；关联 DEF 无

## 7. OPS Log


## 8. Decision Log

- 2026-08-25 人提供图1（旧：折叠来源）与图2（现：JSON 原文）；PM 要求参考以前前端处理方式，拆本单。
- 2026-08-25 DEV：002 已归档至 done，本单为修 A3 流式晚到围栏改动了 `useChat.ts`（原 locks 说明依赖 002）。
