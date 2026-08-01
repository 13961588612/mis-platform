/**
 * MessageList — Renders the chat message history.
 *
 * Displays messages from the chatStore, handling different message roles:
 * - user: Right-aligned blue bubbles
 * - assistant: Left-aligned white bubbles with markdown rendering
 * - tool: Compact ToolCallTrace (collapsed by default; expand for logs)
 * - system: Centered gray notification
 *
 * Auto-scrolls to bottom on new messages. Includes the ApprovalCard
 * component for messages that require approval.
 */

import { useEffect, useRef, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApprovalCard } from "./ApprovalCard";
import { markdownComponents } from "./markdownComponents";
import { useChatStore } from "../store/chatStore";
import { A2uiRenderer } from "./a2ui/A2uiRenderer";
import { AssistantAvatar } from "./AssistantAvatar";
import { ToolCallTrace, groupMessagesForDisplay } from "./ToolCallTrace";
import { getAuthedFileUrl } from "../utils/api";
import { formatTime } from "../utils/format";
import { normalizeMarkdownTables } from "../utils/markdownNormalize";
import type { ChatAttachment, ChatMessage } from "../types/message";

function MessageAttachments({
  attachments,
  tone,
}: {
  attachments: ChatAttachment[];
  tone: "user" | "assistant";
}): JSX.Element {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {attachments.map((att) => {
        const href = getAuthedFileUrl(att.url || att.fileId);
        const isImage = (att.mimeType || "").startsWith("image/");
        if (isImage) {
          return (
            <a
              key={att.fileId}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-lg"
            >
              <img
                src={href}
                alt={att.name}
                className="max-h-48 max-w-full object-contain"
              />
            </a>
          );
        }
        return (
          <a
            key={att.fileId}
            href={href}
            target="_blank"
            rel="noreferrer"
            className={
              tone === "user"
                ? "truncate rounded border border-white/25 bg-white/10 px-2 py-1 text-xs text-white/90 hover:bg-white/20"
                : "truncate rounded border border-surface-light bg-white px-2 py-1 text-xs text-primary-700 hover:bg-surface-muted"
            }
          >
            {att.name}
            {att.size > 0 ? ` · ${Math.max(1, Math.round(att.size / 1024))}KB` : ""}
          </a>
        );
      })}
    </div>
  );
}

/** Shown while waiting for the first text delta from the agent. */
function ThinkingIndicator(): JSX.Element {
  return (
    <div className="flex items-center gap-1 text-sm text-surface-dark/55">
      <span>正在思考</span>
      <span className="inline-flex w-4 animate-pulse">…</span>
    </div>
  );
}

// ===== Message Bubble =====

/** Props for the MessageBubble component. */
interface MessageBubbleProps {
  message: ChatMessage;
  currentUserId: string;
}

/** Render a single message bubble based on its role (non-tool). */
function MessageBubble({ message, currentUserId: _currentUserId }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const assistantContent = useMemo(
    () => normalizeMarkdownTables(message.content ?? ""),
    [message.content],
  );
  const isThinking =
    !isUser &&
    message.status === "streaming" &&
    assistantContent.trim().length === 0;

  // System messages — centered notification
  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-surface-muted px-4 py-1 text-xs text-surface-dark/50">
          {message.content}
        </span>
      </div>
    );
  }

  // User / Assistant messages
  if (isUser) {
    const showText =
      message.content &&
      message.content !== "（附件）" &&
      !(message.attachments?.length && message.content.startsWith("（用户发送了附件）"));
    return (
      <div className="flex justify-end py-2">
        <div className="max-w-[75%] rounded-2xl bg-primary-600 px-4 py-2.5 text-sm text-white">
          {showText ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : null}
          {message.attachments && message.attachments.length > 0 ? (
            <MessageAttachments attachments={message.attachments} tone="user" />
          ) : null}
          <div className="mt-1 text-xs text-white/60">
            {formatTime(message.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 py-2">
      <AssistantAvatar />
      <div className="max-w-[75%] rounded-2xl bg-surface-muted px-4 py-2.5 text-sm text-surface-dark">
        {isThinking ? (
          <ThinkingIndicator />
        ) : (
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-pre:my-2">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {assistantContent}
            </ReactMarkdown>
          </div>
        )}

        {/* A2UI 生成式 UI 渲染（DEP-8） */}
        {message.a2ui && (
          <div className="mt-2">
            <A2uiRenderer render={message.a2ui} />
          </div>
        )}

        {/* Timestamp */}
        {!isThinking && (
          <div className="mt-1 text-xs text-surface-dark/40">
            {formatTime(message.timestamp)}
          </div>
        )}

        {/* Error indicator */}
        {message.status === "error" && message.error && (
          <div className="mt-1 text-xs text-red-400">
            错误: {message.error}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Component =====

/** Props for the MessageList component. */
interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string;
}

/**
 * MessageList — renders the full chat message history with auto-scroll.
 */
export function MessageList({ messages, currentUserId }: MessageListProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingApprovals = useChatStore((state) => state.pendingApprovals);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [messages]);

  // Build a map of approval IDs to pending approval status
  const pendingApprovalIds = useMemo(
    () => new Set(pendingApprovals.map((a) => a.approvalId)),
    [pendingApprovals],
  );

  const displayItems = useMemo(
    () => groupMessagesForDisplay(messages),
    [messages],
  );

  // Empty state
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center text-center">
          <AssistantAvatar className="mb-4 h-16 w-16" />
          <h3 className="text-lg font-medium text-surface-dark/70">
            AI 智能助手
          </h3>
          <p className="mt-2 text-sm text-surface-dark/40">
            选择一个 Agent，开始对话吧
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-4 py-3 sm:px-6 sm:py-4"
    >
      {displayItems.map((item) => {
        if (item.kind === "tools") {
          return (
            <ToolCallTrace
              key={`tools-${item.messages[0]?.id ?? "empty"}`}
              messages={item.messages}
            />
          );
        }
        const message = item.message;
        return (
          <div key={message.id}>
            <MessageBubble message={message} currentUserId={currentUserId} />
            {message.requiresApproval && message.approvalId && (
              <ApprovalCard
                approvalId={message.approvalId}
                title={message.content}
                description="此操作需要您的审批"
                isPending={pendingApprovalIds.has(message.approvalId)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default MessageList;
