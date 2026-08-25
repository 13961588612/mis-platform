/**
 * ToolCallTrace — Compact tool-call activity in the chat transcript.
 *
 * Default: one-line summary (tool name + status). Expand to inspect
 * args / result logs. Consecutive tool messages are grouped so multi-step
 * agent turns do not dominate the viewport.
 */

import { useState } from "react";
import { clsx } from "../utils/format";
import type { ChatMessage } from "../types/message";

function toolStatus(message: ChatMessage): "running" | "done" | "error" {
  if (message.status === "error" || message.error) {
    return "error";
  }
  if (message.toolResult != null && message.toolResult.length > 0) {
    return "done";
  }
  return "running";
}

const STATUS_LABEL: Record<"running" | "done" | "error", string> = {
  running: "执行中",
  done: "完成",
  error: "失败",
};

const STATUS_DOT: Record<"running" | "done" | "error", string> = {
  running: "bg-amber-400 animate-pulse",
  done: "bg-emerald-500",
  error: "bg-red-500",
};

function truncateJson(text: string | undefined, max = 4000): string {
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字符）`;
}

/** Single tool row: collapsed summary + expandable log. */
function ToolCallItem({ message }: { message: ChatMessage }): JSX.Element {
  const status = toolStatus(message);
  const name = message.toolName ?? "工具";

  return (
    <details className="group border-b border-surface-light/60 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-xs text-surface-dark/70 hover:bg-surface-muted/50 [&::-webkit-details-marker]:hidden">
        <span
          className={clsx("inline-block h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[status])}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate font-medium text-surface-dark/80">
          {name}
        </span>
        <span className="shrink-0 text-surface-dark/40">{STATUS_LABEL[status]}</span>
        <span
          className="shrink-0 text-surface-dark/30 transition-transform group-open:rotate-90"
          aria-hidden
        >
          ›
        </span>
      </summary>
      <div className="space-y-1.5 border-t border-surface-light/40 bg-surface-muted/20 px-2.5 py-2">
        {message.toolArgs ? (
          <div>
            <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-surface-dark/40">
              参数
            </div>
            <pre className="max-h-40 overflow-auto rounded bg-gray-900/95 p-2 text-[11px] leading-relaxed text-gray-100">
              {truncateJson(message.toolArgs)}
            </pre>
          </div>
        ) : null}
        {message.toolResult ? (
          <div>
            <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-surface-dark/40">
              结果
            </div>
            <pre className="max-h-48 overflow-auto rounded bg-gray-900/95 p-2 text-[11px] leading-relaxed text-gray-100">
              {truncateJson(message.toolResult)}
            </pre>
          </div>
        ) : status === "running" ? (
          <p className="text-[11px] text-surface-dark/45">等待工具返回…</p>
        ) : null}
        {message.error ? (
          <p className="text-[11px] text-red-500">{message.error}</p>
        ) : null}
      </div>
    </details>
  );
}

export interface ToolCallTraceProps {
  /** One or more consecutive tool messages. */
  messages: ChatMessage[];
}

/**
 * Renders a compact tool-activity strip. Closed by default for groups;
 * a single call stays as one expandable line.
 */
export function ToolCallTrace({ messages }: ToolCallTraceProps): JSX.Element {
  const [open, setOpen] = useState(false);
  if (messages.length === 0) {
    return <></>;
  }

  const running = messages.filter((m) => toolStatus(m) === "running").length;
  const failed = messages.filter((m) => toolStatus(m) === "error").length;
  const done = messages.length - running - failed;

  let summaryStatus: "running" | "done" | "error" = "done";
  if (running > 0) {
    summaryStatus = "running";
  } else if (failed > 0) {
    summaryStatus = "error";
  }

  const summaryText =
    messages.length === 1
      ? (messages[0].toolName ?? "工具调用")
      : `工具调用 ×${messages.length}`;

  const statusHint =
    summaryStatus === "running"
      ? running === messages.length
        ? "执行中"
        : `${done}/${messages.length} 完成`
      : summaryStatus === "error"
        ? failed === 1 && messages.length === 1
          ? "失败"
          : `${failed} 失败`
        : "完成";

  // Single tool: one details row (no outer shell expand)
  if (messages.length === 1) {
    return (
      <div className="my-1 max-w-[min(100%,28rem)] overflow-hidden rounded-md border border-surface-light/80 bg-white/80">
        <ToolCallItem message={messages[0]} />
      </div>
    );
  }

  return (
    <div className="my-1 max-w-[min(100%,28rem)] overflow-hidden rounded-md border border-surface-light/80 bg-white/80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-surface-dark/70 hover:bg-surface-muted/50"
        aria-expanded={open}
      >
        <span
          className={clsx("inline-block h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[summaryStatus])}
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
          {messages.map((m) => (
            <ToolCallItem key={m.id} message={m} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Group consecutive tool-role messages for compact rendering. */
export type MessageListItem =
  | { kind: "message"; message: ChatMessage }
  | { kind: "tools"; messages: ChatMessage[] };

export function groupMessagesForDisplay(messages: ChatMessage[]): MessageListItem[] {
  const items: MessageListItem[] = [];
  let toolBuf: ChatMessage[] = [];

  const flushTools = () => {
    if (toolBuf.length > 0) {
      items.push({ kind: "tools", messages: toolBuf });
      toolBuf = [];
    }
  };

  for (const message of messages) {
    if (message.role === "tool") {
      toolBuf.push(message);
    } else {
      flushTools();
      items.push({ kind: "message", message });
    }
  }
  flushTools();
  return items;
}
