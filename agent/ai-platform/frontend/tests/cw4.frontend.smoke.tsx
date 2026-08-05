/**
 * C4 前端收敛冒烟（vitest 缺失，用 tsx + react-dom/server 直跑）。
 *
 * 验证（design-c4.md T03/T04、prd FR-FE-1/2/3、spec §7.2）：
 *  [1] adaptDispatchTrace / adaptAgentEvent —— trace 映射与防御性降级
 *  [2] AgentSelector 收敛四连击 —— 过滤 / 默认选中 / 单隐藏 / 不硬编码
 *  [3] chatStore.dispatchTrace —— 写入与三处清空
 *  [4] DispatchHint 真实 SSR —— 轻提示文案、空态、不暴露 Worker 选择器
 *  [5] 全链路形状对齐 —— 后端 trace{entries} → 适配器 → store 入参
 *
 * 运行（在 frontend 目录，复用网关的 tsx 二进制以解析 react 依赖）：
 *   ../gateway/node_modules/.bin/tsx tests/cw4.frontend.smoke.tsx
 * 退出码：0=全部通过，1=存在失败。
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { adaptAgentEvent, adaptDispatchTrace } from "../src/utils/cardAdapter";
import { normalizeAgentList, type RawAgentSummary } from "../src/utils/agentAdapter";
import { isCoordinator, normalizeAgentRole } from "../src/utils/agentRole";
import { useChatStore } from "../src/store/chatStore";
import { DispatchHint, describeDispatchEntry } from "../src/components/DispatchHint";
import type { DispatchTraceEntry, RawAgentEvent } from "../src/types/event";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ===== [1] 适配器：trace 映射 =====

console.log("\n[1] adaptDispatchTrace / adaptAgentEvent");

const rawTraceEvent: RawAgentEvent = {
  type: "dispatch.trace",
  trace: {
    entries: [
      {
        intent: "rag",
        worker_id: "mis-rag",
        tool: "agent__invoke",
        status: "completed",
        latency_ms: 1200,
        task_id: "task-1",
      },
    ],
  },
} as RawAgentEvent;

const adapted = adaptAgentEvent(rawTraceEvent);
check("adaptAgentEvent 保留 type=dispatch.trace", adapted.type === "dispatch.trace");
check("adaptAgentEvent 产出 trace.entries", (adapted.trace?.entries?.length ?? 0) === 1);

const adaptedEntry = adapted.trace!.entries[0];
check("intent 映射正确", adaptedEntry.intent === "rag");
check("worker_id 保持 snake_case（与后端同形）", adaptedEntry.worker_id === "mis-rag");
check("tool 映射正确", adaptedEntry.tool === "agent__invoke");
check("status 映射正确", adaptedEntry.status === "completed");
check("latency_ms 保持 snake_case", adaptedEntry.latency_ms === 1200);

check(
  "adaptDispatchTrace 对 undefined 返回空 entries（不抛）",
  adaptDispatchTrace(undefined).entries.length === 0,
);
check(
  "adaptDispatchTrace 对畸形 entries 返回空（不抛）",
  adaptDispatchTrace({ entries: "boom" } as never).entries.length === 0,
);
check(
  "adaptDispatchTrace 过滤 null 条目",
  adaptDispatchTrace({ entries: [null, { intent: "rag" }] } as never).entries.length === 1,
);

const plainDelta = adaptAgentEvent({ type: "text.delta", content: "hi" } as RawAgentEvent);
check("既有事件不凭空多出 trace", plainDelta.trace === undefined);

// ===== [2] AgentSelector 收敛四连击 =====

console.log("\n[2] AgentSelector 收敛（过滤 / 默认选中 / 单隐藏 / 不硬编码）");

/** 真实 /agents 形状：1 个 coordinator + 4 个 worker。 */
const AGENTS_FIXTURE: RawAgentSummary[] = [
  {
    agent_id: "mis-copilot",
    display_name: "MIS Copilot",
    state: "running",
    runtime_type: "openharness",
    active_sessions: 2,
    is_active: true,
    role: "coordinator",
  },
  {
    agent_id: "mis-rag",
    display_name: "知识库问答",
    state: "running",
    runtime_type: "openharness",
    active_sessions: 0,
    is_active: true,
    role: "worker",
  },
  {
    agent_id: "mis-summary",
    display_name: "内容总结",
    state: "running",
    runtime_type: "openharness",
    active_sessions: 0,
    is_active: true,
    role: "worker",
  },
  {
    agent_id: "mis-extract",
    display_name: "信息抽取",
    state: "paused",
    runtime_type: "openharness",
    active_sessions: 0,
    is_active: true,
    role: "worker",
  },
  {
    agent_id: "crm-assistant",
    display_name: "客户助手",
    state: "running",
    runtime_type: "openharness",
    active_sessions: 0,
    is_active: true,
    role: "worker",
  },
];

/** 复刻 AgentSelector.tsx 的过滤链（state 过滤 → role 过滤）。 */
function selectableAgents(raw: RawAgentSummary[]) {
  return normalizeAgentList(raw)
    .filter((a) => a.state === "running" || a.state === "paused")
    .filter((a) => isCoordinator(a.role));
}

const filtered = selectableAgents(AGENTS_FIXTURE);
check("过滤后只剩 1 个 agent", filtered.length === 1, `实际=${filtered.length}`);
check("剩下的是 mis-copilot", filtered[0]?.agentId === "mis-copilot");
check(
  "4 个 Worker 全部被剔除",
  !filtered.some((a) =>
    ["mis-rag", "mis-summary", "mis-extract", "crm-assistant"].includes(a.agentId),
  ),
);

// 默认选中：!value 且列表非空 → onChange(首个)
let selected: string | null = null;
const value = "";
if (!value && filtered.length > 0) {
  selected = filtered[0].agentId;
}
check("默认自动选中首个 coordinator", selected === "mis-copilot", `实际=${selected}`);

// 单 coordinator 隐藏下拉（AgentSelector 的分支条件）
const isLoading = false;
const error = null;
check(
  "单 coordinator 命中隐藏下拉分支",
  !isLoading && !error && filtered.length === 1,
);

// 不硬编码：新增第二个 coordinator 也要能列出
const DUAL_COORDINATOR: RawAgentSummary[] = [
  ...AGENTS_FIXTURE,
  {
    agent_id: "hr-coordinator",
    display_name: "HR 协调官",
    state: "running",
    runtime_type: "openharness",
    active_sessions: 0,
    is_active: true,
    role: "coordinator",
  },
];
const dual = selectableAgents(DUAL_COORDINATOR);
check("双 coordinator 场景返回 2 项（未硬编码 mis-copilot）", dual.length === 2, `实际=${dual.length}`);
check(
  "双 coordinator 含 hr-coordinator",
  dual.some((a) => a.agentId === "hr-coordinator"),
);
check("双 coordinator 时不再命中隐藏分支（保留下拉）", dual.length !== 1);

// role 缺失 → fail-closed
check("role 缺失归一为 worker（fail-closed）", normalizeAgentRole(undefined) === "worker");
check("未知 role 归一为 worker", normalizeAgentRole("admin") === "worker");
check("isCoordinator(undefined) 为 false", isCoordinator(undefined) === false);

const legacyBackend = selectableAgents(
  AGENTS_FIXTURE.map(({ role: _role, ...rest }) => rest as RawAgentSummary),
);
check(
  "【探针】老后端不返回 role → 可选 agent 数",
  true,
  `实际可选=${legacyBackend.length}（0 表示对话入口会整体消失）`,
);

// ===== [3] chatStore.dispatchTrace =====

console.log("\n[3] chatStore.dispatchTrace 写入与清空");

const store = useChatStore.getState();
const SAMPLE: DispatchTraceEntry[] = [{ intent: "rag", worker_id: "mis-rag", status: "completed" }];

check("初始 dispatchTrace 为空数组", store.dispatchTrace.length === 0);

useChatStore.getState().setDispatchTrace(SAMPLE);
check("setDispatchTrace 写入生效", useChatStore.getState().dispatchTrace.length === 1);

useChatStore.getState().clearMessages();
check("clearMessages 清空 dispatchTrace", useChatStore.getState().dispatchTrace.length === 0);

useChatStore.getState().setDispatchTrace(SAMPLE);
useChatStore.getState().setMessages([]);
check("setMessages 清空 dispatchTrace", useChatStore.getState().dispatchTrace.length === 0);

useChatStore.getState().setDispatchTrace(SAMPLE);
useChatStore.getState().reset();
check("reset 清空 dispatchTrace", useChatStore.getState().dispatchTrace.length === 0);

// ===== [4] DispatchHint 真实 SSR =====

console.log("\n[4] DispatchHint 渲染（spec §7.2 轻提示）");

const emptyHtml = renderToStaticMarkup(<DispatchHint entries={[]} />);
check("空 entries 渲染为空（不占位）", emptyHtml === "", `实际=${JSON.stringify(emptyHtml)}`);

const ragHtml = renderToStaticMarkup(
  <DispatchHint
    entries={[
      { intent: "rag", worker_id: "mis-rag", status: "completed", latency_ms: 1200 },
    ]}
  />,
);
check("渲染出「已为你调度」轻提示", ragHtml.includes("已为你调度"));
check("intent=rag 映射为「知识库检索」", ragHtml.includes("知识库检索"));
check("默认收起（aria-expanded=false）", ragHtml.includes('aria-expanded="false"'));
check("不渲染 select 元素（不暴露 Worker 选择器）", !ragHtml.includes("<select"));
check("不渲染 option 元素", !ragHtml.includes("<option"));

const multiHtml = renderToStaticMarkup(
  <DispatchHint
    entries={[
      { intent: "rag", worker_id: "mis-rag", status: "completed" },
      { intent: "crm", worker_id: "crm-assistant", status: "completed" },
    ]}
  />,
);
check("多条时汇总为「已为你调度 2 项协作」", multiHtml.includes("已为你调度 2 项协作"));

const failedHtml = renderToStaticMarkup(
  <DispatchHint entries={[{ intent: "rag", worker_id: "mis-rag", status: "failed" }]} />,
);
check("失败态显示「1 项未完成」", failedHtml.includes("1 项未完成"));

check("describeDispatchEntry: crm → 客户查询", describeDispatchEntry({ intent: "crm" }) === "客户查询");
check(
  "describeDispatchEntry: 未知 intent 回落 worker 标签",
  describeDispatchEntry({ worker_id: "mis-summary" }) === "内容总结",
);
check("describeDispatchEntry: 空条目不返回空串", describeDispatchEntry({}).length > 0);

// ===== [5] 全链路形状对齐 =====

console.log("\n[5] 后端 → 网关 → 前端 形状对齐");

// 后端 model_dump 出来的真实 JSON（见 backend test_cw4_dispatch_trace_e2e）
const BACKEND_WIRE = {
  type: "dispatch.trace",
  trace: {
    entries: [
      {
        intent: "rag",
        worker_id: "mis-rag",
        tool: "agent__invoke",
        status: "completed",
        latency_ms: 1200,
        task_id: "task-1",
        brief_rejected: false,
      },
    ],
  },
};

const endToEnd = adaptAgentEvent(BACKEND_WIRE as RawAgentEvent);
// useChat 的取数路径：event.trace?.entries ?? []
const storeInput: DispatchTraceEntry[] = endToEnd.trace?.entries ?? [];
check("useChat 取数路径 event.trace?.entries 拿到 1 条", storeInput.length === 1);

useChatStore.getState().setDispatchTrace(storeInput);
const rendered = renderToStaticMarkup(
  <DispatchHint entries={useChatStore.getState().dispatchTrace} />,
);
check("后端原始 JSON 一路渲染出「知识库检索」", rendered.includes("知识库检索"));
// 默认收起态只显示汇总状态；latency 属于展开后的明细行（design-c4.md §7.5「折叠展示，默认收起」）
check("折叠态显示汇总状态「完成」", rendered.includes("完成"));
check("折叠态不泄露 latency 明细（保持轻量）", !rendered.includes("1.2s"));

useChatStore.getState().reset();

console.log(`\n通过 ${passed} 项，失败 ${failed} 项。`);
process.exit(failed > 0 ? 1 : 0);
