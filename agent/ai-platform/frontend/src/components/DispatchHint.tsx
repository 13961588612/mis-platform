/**
 * DispatchHint — lightweight Coordinator dispatch hint (C4 / FR-FE-3).
 *
 * Renders the `dispatch.trace` entries emitted by the Coordinator as a
 * collapsed one-line strip, expandable to a per-dispatch list.
 *
 * Product constraint (spec §7.2): the hint is **informational only** —
 * it must never expose a Worker selector or let the user re-route a task.
 * Visual language is intentionally identical to `ToolCallTrace` (same
 * shell, status dot palette and typography) so the transcript stays calm.
 */

import { useState } from "react";
import { clsx } from "../utils/format";
import type { DispatchTraceEntry } from "../types/event";

// ===== Status mapping (mirrors ToolCallTrace) =====

/** Normalized dispatch status. */
type DispatchStatus = "running" | "done" | "error";

const STATUS_LABEL: Record<DispatchStatus, string> = {
  running: "调度中",
  done: "完成",
  error: "未完成",
};

const STATUS_DOT: Record<DispatchStatus, string> = {
  running: "bg-amber-400 animate-pulse",
  done: "bg-emerald-500",
  error: "bg-red-500",
};

/** Backend trace statuses that mean "finished successfully". */
const COMPLETED_STATUSES: ReadonlySet<string> = new Set(["completed", "success"]);

/** Backend trace statuses that mean "did not produce a result". */
const FAILED_STATUSES: ReadonlySet<string> = new Set([
  "failed",
  "rejected",
  "timeout",
  "error",
]);

/**
 * Map a backend `status` string onto the three UI states.
 * Unknown / missing status is treated as still running.
 */
function dispatchStatus(entry: DispatchTraceEntry): DispatchStatus {
  const raw = (entry.status ?? "").trim().toLowerCase();
  if (entry.brief_rejected === true) {
    return "error";
  }
  if (COMPLETED_STATUSES.has(raw)) {
    return "done";
  }
  if (FAILED_STATUSES.has(raw)) {
    return "error";
  }
  return "running";
}

// ===== Intent → 中文标签 =====

/** Human-readable Chinese labels for known dispatch intents. */
const INTENT_LABEL: Record<string, string> = {
  rag: "知识库检索",
  kb: "知识库检索",
  crm: "客户查询",
  summary: "内容总结",
  extract: "信息抽取",
  chat: "对话应答",
};

/** Fallback labels derived from the Worker agent ID. */
const WORKER_LABEL: Record<string, string> = {
  "mis-rag": "知识库检索",
  "mis-summary": "内容总结",
  "mis-extract": "信息抽取",
  "crm-assistant": "客户查询",
};

/**
 * Resolve the display label of one dispatch entry.
 *
 * Priority: intent mapping → worker mapping → raw worker id → tool name.
 * Always returns a non-empty string so a row never renders blank.
 */
export function describeDispatchEntry(entry: DispatchTraceEntry): string {
  const intent = (entry.intent ?? "").trim().toLowerCase();
  if (intent && INTENT_LABEL[intent]) {
    return INTENT_LABEL[intent];
  }
  const workerId = (entry.worker_id ?? "").trim();
  if (workerId && WORKER_LABEL[workerId]) {
    return WORKER_LABEL[workerId];
  }
  if (workerId) {
    return workerId;
  }
  const tool = (entry.tool ?? "").trim();
  if (tool) {
    return tool;
  }
  return intent || "智能体协作";
}

/** Format latency for the row hint; returns "" when unavailable. */
function formatLatency(latencyMs: number | undefined): string {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs < 0) {
    return "";
  }
  if (latencyMs < 1000) {
    return `${Math.round(latencyMs)}ms`;
  }
  return `${(latencyMs / 1000).toFixed(1)}s`;
}

// ===== Row =====

/** One dispatch row: status dot + Chinese label + status/latency hint. */
function DispatchItem({ entry }: { entry: DispatchTraceEntry }): JSX.Element {
  const status = dispatchStatus(entry);
  const latency = formatLatency(entry.latency_ms);

  return (
    <div className="flex items-center gap-2 border-b border-surface-light/60 px-2.5 py-1.5 text-xs text-surface-dark/70 last:border-b-0">
      <span
        className={clsx(
          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
          STATUS_DOT[status],
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-medium text-surface-dark/80">
        已为你调度：{describeDispatchEntry(entry)}
      </span>
      <span className="shrink-0 text-surface-dark/40">
        {latency ? `${STATUS_LABEL[status]} · ${latency}` : STATUS_LABEL[status]}
      </span>
    </div>
  );
}

// ===== Component =====

/** Props for the DispatchHint component. */
export interface DispatchHintProps {
  /** Dispatch trace entries of the latest turn (empty → renders nothing). */
  entries: DispatchTraceEntry[];
}

/**
 * Collapsed dispatch hint strip. Closed by default; expanding reveals one
 * row per dispatched Worker. Renders nothing when there is no trace.
 */
export function DispatchHint({ entries }: DispatchHintProps): JSX.Element {
  const [open, setOpen] = useState(false);

  if (!entries || entries.length === 0) {
    return <></>;
  }

  const running = entries.filter((e) => dispatchStatus(e) === "running").length;
  const failed = entries.filter((e) => dispatchStatus(e) === "error").length;
  const done = entries.length - running - failed;

  let summaryStatus: DispatchStatus = "done";
  if (running > 0) {
    summaryStatus = "running";
  } else if (failed > 0) {
    summaryStatus = "error";
  }

  const summaryText =
    entries.length === 1
      ? `已为你调度：${describeDispatchEntry(entries[0])}`
      : `已为你调度 ${entries.length} 项协作`;

  const statusHint =
    summaryStatus === "running"
      ? running === entries.length
        ? "调度中"
        : `${done}/${entries.length} 完成`
      : summaryStatus === "error"
        ? `${failed} 项未完成`
        : "完成";

  return (
    <div className="my-1 max-w-[min(100%,28rem)] overflow-hidden rounded-md border border-surface-light/80 bg-white/80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-surface-dark/70 hover:bg-surface-muted/50"
        aria-expanded={open}
      >
        <span
          className={clsx(
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
            STATUS_DOT[summaryStatus],
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate font-medium text-surface-dark/80">
          {summaryText}
        </span>
        <span className="shrink-0 text-surface-dark/40">{statusHint}</span>
        <span
          className={clsx(
            "shrink-0 text-surface-dark/30 transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        >
          ›
        </span>
      </button>
      {open ? (
        <div className="border-t border-surface-light/60">
          {entries.map((entry, index) => (
            <DispatchItem
              key={entry.task_id ?? `${entry.worker_id ?? "dispatch"}-${index}`}
              entry={entry}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default DispatchHint;
