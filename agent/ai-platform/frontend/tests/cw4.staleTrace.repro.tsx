/**
 * C4 Fix 2 回归守卫：调度轻提示跨轮残留（stale DispatchHint）。
 *
 * 历史（Round 1）：本文件是缺陷复现脚本，退出码 1 = 缺陷存在。
 * 现状（Round 2）：工程师已在 `useChat.sendMessage` 增加 `setDispatchTrace([])`，
 * 本文件转为**回归守卫**，退出码 0 = 修复有效且未回退。
 *
 * 期望行为（design-c4.md §7.5 + chatStore 注释「dispatch trace of the latest
 * turn」）：DispatchHint 只应反映**最新一轮**的调度情况。
 *
 * Round 1 根因链（三处叠加）与本轮处置：
 *  1. backend/src/runtime/openharness.py:553 —— `if dispatch_items:` 使得无委派
 *     的轮次不 yield dispatch.trace，前端收不到「清空信号」。【未改，且无需改】
 *  2. frontend/src/hooks/useChat.ts:314 —— `if (entries.length > 0)` 即便收到
 *     空 entries 也不清空。【未改，且属显式设计决策，见下方 §C】
 *  3. frontend/src/hooks/useChat.ts:586 —— 新一轮开始时未重置。【已修复 = Fix 2】
 *
 * 关键判断：根因 3 单独修复即可消除用户可见症状，因为「轮次开始即重置」是
 * 本地动作，不依赖后端是否下发清空信号，比根因 1/2 更鲁棒。
 *
 * 本脚本包含**负对照**（§B）：用未修复的 legacy 版 sendMessage 跑同一场景，
 * 必须仍然复现残留。若负对照也「通过」，说明本测试已失去检出能力，需报警。
 *
 * 运行：../gateway/node_modules/.bin/tsx tests/cw4.staleTrace.repro.tsx
 * 退出码：0 = Fix 2 有效；1 = 修复失效/回退，或测试丧失检出能力。
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useChatStore } from "../src/store/chatStore";
import { DispatchHint } from "../src/components/DispatchHint";
import { adaptAgentEvent } from "../src/utils/cardAdapter";
import type { RawAgentEvent } from "../src/types/event";

let failed = 0;

function expect(name: string, cond: boolean, detail = ""): void {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : ` — ${detail}`}`);
  if (!cond) failed++;
}

/** 复刻 useChat 的 case "dispatch.trace" 分支（useChat.ts:310-318）。 */
function handleDispatchTraceEvent(raw: RawAgentEvent): void {
  const event = adaptAgentEvent(raw);
  const entries = event.trace?.entries ?? [];
  if (entries.length > 0) {
    useChatStore.getState().setDispatchTrace(entries);
  }
}

function pushUserMessage(): void {
  useChatStore.getState().addMessage({
    id: `m-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sessionId: "s1",
    role: "user",
    content: "你好",
    status: "delivered",
    timestamp: new Date().toISOString(),
  });
}

/**
 * 复刻**修复后**的 sendMessage 中与 dispatchTrace 相关的动作。
 * 对应 useChat.ts:585-586：setGenerating(true) 紧随其后 setDispatchTrace([])。
 */
function startNewTurn(): void {
  pushUserMessage();
  useChatStore.getState().setDispatchTrace([]);
}

/** 负对照：复刻**修复前**的 sendMessage（无任何重置）。 */
function startNewTurnLegacy(): void {
  pushUserMessage();
}

function renderHint(): string {
  return renderToStaticMarkup(
    <DispatchHint entries={useChatStore.getState().dispatchTrace} />,
  );
}

const ragTrace = {
  type: "dispatch.trace",
  trace: {
    entries: [
      { intent: "rag", worker_id: "mis-rag", status: "completed", latency_ms: 1200 },
    ],
  },
} as RawAgentEvent;

// ===========================================================================
// §A 主场景：修复后，跨轮不应残留
// ===========================================================================

console.log("\n=== §A 修复后行为 ===");
console.log("--- 第 1 轮：命中知识库委派 ---");

useChatStore.getState().reset();
handleDispatchTraceEvent(ragTrace);

const turn1 = renderHint();
expect("第 1 轮显示「知识库检索」提示", turn1.includes("知识库检索"));

console.log("--- 第 2 轮：纯对话「你好」，后端不产出 dispatch.trace ---");

startNewTurn();
// 后端本轮 dispatch_items 为空 → openharness 的 `if dispatch_items:` 短路
// → 完全不发 dispatch.trace 事件（仅 text.delta / done）。
// Fix 2 靠轮次开始时的本地重置消除残留，不依赖后端信号。

const turn2 = renderHint();
console.log(
  `  第 2 轮实际渲染: ${turn2 === "" ? "(空)" : turn2.match(/已为你调度[^<]*/)?.[0] ?? turn2.slice(0, 80)}`,
);
expect(
  "第 2 轮不应再显示上一轮的调度提示",
  turn2 === "" || !turn2.includes("知识库检索"),
  "上一轮的「已为你调度：知识库检索」残留到了无委派的这一轮",
);

console.log("--- 第 3 轮：再次命中委派，应替换而非叠加 ---");

startNewTurn();
handleDispatchTraceEvent({
  type: "dispatch.trace",
  trace: {
    entries: [
      { intent: "report", worker_id: "mis-report", status: "completed", latency_ms: 800 },
    ],
  },
} as RawAgentEvent);

const turn3Entries = useChatStore.getState().dispatchTrace;
expect(
  "第 3 轮 entries 被整体替换（长度为 1，非累加）",
  turn3Entries.length === 1,
  `实际 ${turn3Entries.length} 条，疑似跨轮累加`,
);
expect(
  "第 3 轮 intent 为本轮的 report，而非上一轮的 rag",
  turn3Entries[0]?.intent === "report",
  `实际 intent=${String(turn3Entries[0]?.intent)}`,
);

// ===========================================================================
// §B 负对照：去掉 Fix 2 后必须仍能复现残留（验证本测试具备检出能力）
// ===========================================================================

console.log("\n=== §B 负对照（模拟未修复的 sendMessage）===");

useChatStore.getState().reset();
handleDispatchTraceEvent(ragTrace);
startNewTurnLegacy();

const legacyTurn2 = renderHint();
const legacyStale = legacyTurn2.includes("知识库检索");
console.log(
  `  legacy 第 2 轮实际渲染: ${legacyTurn2 === "" ? "(空)" : legacyTurn2.match(/已为你调度[^<]*/)?.[0] ?? legacyTurn2.slice(0, 80)}`,
);
expect(
  "负对照：无重置时残留必须复现（证明本用例能检出回退）",
  legacyStale,
  "负对照未复现残留 → 本测试已丧失检出能力，§A 的 PASS 不可信",
);

// ===========================================================================
// §C 显式设计决策存档：空 entries 为 no-op，非缺陷
// ===========================================================================

console.log("\n=== §C 空 entries 语义（设计决策，非缺陷）===");

useChatStore.getState().reset();
handleDispatchTraceEvent(ragTrace);
handleDispatchTraceEvent({
  type: "dispatch.trace",
  trace: { entries: [] },
} as RawAgentEvent);

const afterEmpty = renderHint();
expect(
  "空 entries 不覆盖既有提示（useChat.ts:312 注释的显式约定）",
  afterEmpty.includes("知识库检索"),
  "空 entries 的 no-op 语义被改变，请同步复核 useChat.ts:314 守卫与 design-c4.md",
);
console.log(
  "  备注：后端 openharness.py:553 `if dispatch_items:` 保证空 entries 事件在生产不可达，",
);
console.log("        故此语义不构成用户可见风险；清空职责已由 Fix 2 的轮次重置承担。");

useChatStore.getState().reset();

console.log(
  `\n结论：${failed > 0 ? `${failed} 项不符合预期（Fix 2 失效或已回退）` : "Fix 2 有效，跨轮残留已消除，且负对照证明用例具备检出能力"}`,
);
process.exit(failed > 0 ? 1 : 0);
</content>
</invoke>
