/**
 * 助手回答后的点赞 / 吐槽。
 *
 * Copilot H5 没有 lucide / sonner：按钮用内联 SVG，提示用轻量文案。
 * 点赞一键提交；吐槽展开说明框，必填后提交。
 */

import { useState } from "react";
import { apiPost } from "../utils/api";
import { useChatStore } from "../store/chatStore";
import type { ChatMessage, MessageFeedbackRating } from "../types/message";

interface SubmitFeedbackResult {
  message_id?: string;
  rating?: MessageFeedbackRating;
  comment?: string | null;
}

export function MessageFeedbackBar({ message }: { message: ChatMessage }): JSX.Element | null {
  const sessionId = useChatStore((s) => s.sessionId);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  if (message.role !== "assistant" || message.status === "streaming") {
    return null;
  }

  const rating = message.feedback?.rating ?? null;

  async function submit(next: MessageFeedbackRating, text: string): Promise<void> {
    if (!sessionId || busy) return;
    setBusy(true);
    setHint(null);
    try {
      await apiPost<SubmitFeedbackResult>(`/sessions/${sessionId}/feedback`, {
        rating: next,
        comment: text,
        content: message.content,
      });
      updateMessage(message.id, {
        feedback: { rating: next, comment: text || null },
      });
      setOpen(false);
      setHint(next === "up" ? "已点赞，感谢反馈" : "已收到吐槽");
    } catch (e) {
      setHint(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 border-t border-surface-dark/10 pt-2">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={busy || !sessionId || rating === "up"}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
            rating === "up"
              ? "text-primary-700"
              : "text-surface-dark/55 hover:bg-white hover:text-surface-dark"
          } disabled:opacity-50`}
          onClick={() => void submit("up", "")}
        >
          <ThumbIcon up filled={rating === "up"} />
          {rating === "up" ? "已点赞" : "点赞"}
        </button>
        <button
          type="button"
          disabled={busy || !sessionId}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
            rating === "down"
              ? "text-red-500"
              : "text-surface-dark/55 hover:bg-white hover:text-surface-dark"
          } disabled:opacity-50`}
          onClick={() => setOpen((v) => !v)}
        >
          <ThumbIcon up={false} filled={rating === "down"} />
          {rating === "down" ? "已吐槽" : "吐槽"}
        </button>
      </div>
      {open ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="哪里不对、期望怎样才对"
            className="w-full resize-none rounded-md border border-surface-light bg-white px-2 py-1.5 text-xs text-surface-dark outline-none focus:border-primary-400"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs text-surface-dark/55 hover:bg-white"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || !comment.trim()}
              className="rounded-md bg-primary-600 px-2 py-1 text-xs text-white disabled:opacity-50"
              onClick={() => void submit("down", comment.trim())}
            >
              提交吐槽
            </button>
          </div>
        </div>
      ) : null}
      {hint ? <p className="mt-1 text-[11px] text-surface-dark/45">{hint}</p> : null}
    </div>
  );
}

function ThumbIcon({ up, filled }: { up: boolean; filled: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 ${up ? "" : "rotate-180"}`}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 10v11m11.3-9.17a2 2 0 0 0-.63-1.41l-5.3-5.3a1.5 1.5 0 0 0-2.55 1.06V8H6.2A2.2 2.2 0 0 0 4 10.2v.4c0 .10.0.1.3 1.54l1.3 6.5A2.2 2.2 0 0 0 7.76 21H16a3 3 0 0 0 2.95-2.46l.7-4.2a3 3 0 0 0-.35-2.01Z"
      />
    </svg>
  );
}
