/**
 * ChatPanel — Main chat input and conversation interface.
 *
 * Provides:
 * - Message input area with auto-resize textarea
 * - Send button with loading state
 * - Agent selector dropdown
 * - Session management (new session, close session)
 * - WebSocket connection status indicator
 *
 * Uses the useChat hook for WebSocket communication.
 */

import React, { useCallback, useRef, useState, useEffect } from "react";
import { useChatStore } from "../store/chatStore";
import { useAuthStore } from "../store/authStore";
import { useEmbedStore } from "../store/embedStore";
import { useChat } from "../hooks/useChat";
import { MessageList } from "./MessageList";
import { AgentSelector } from "./AgentSelector";
import { loadLastSession, loadLastSessionForAgent } from "../utils/lastSession";
import { apiUploadFile, getAuthedFileUrl } from "../utils/api";
import { clsx } from "../utils/format";
import type { ChatAttachment } from "../types/message";
import type { WsConnectionState } from "../types/event";

// ===== Connection Status Indicator =====

/** WebSocket connection status badge. */
function ConnectionStatus({ state }: { state: WsConnectionState }): JSX.Element {
  const colors: Record<WsConnectionState, string> = {
    connected: "bg-green-500",
    connecting: "bg-yellow-500",
    reconnecting: "bg-yellow-500",
    disconnected: "bg-gray-400",
    error: "bg-red-500",
  };
  const labels: Record<WsConnectionState, string> = {
    connected: "已连接",
    connecting: "连接中",
    reconnecting: "重连中",
    disconnected: "未连接",
    error: "连接错误",
  };
  return (
    <div className="flex items-center gap-2">
      <span
        className={clsx(
          "inline-block h-2 w-2 rounded-full",
          colors[state],
        )}
      />
      <span className="text-xs text-surface-dark/60">{labels[state]}</span>
    </div>
  );
}

// ===== Component =====

/**
 * ChatPanel — the main chat interface component.
 *
 * Renders the message list, input area, agent selector, and
 * connection status. Manages local input state and delegates
 * WebSocket communication to the useChat hook.
 */
export function ChatPanel(): JSX.Element {
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<ChatAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  /** 完成最近会话恢复前，暂缓 Agent 自动建会话 */
  const [sessionReady, setSessionReady] = useState(false);
  const bootstrappedUserRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { user } = useAuthStore();
  const pageContext = useEmbedStore((s) => s.pageContext);
  const {
    sessionId,
    agentId,
    messages,
    wsState,
    isGenerating,
    tokenUsage,
    error,
    setError,
  } = useChatStore();

  const { sendMessage, createSession, restoreSession, closeSession } = useChat(sessionId);

  // 打开聊天：恢复该用户最近活跃智能体的会话；已有内存会话则直接就绪
  useEffect(() => {
    if (!user?.userId) {
      return;
    }
    if (sessionId) {
      setSessionReady(true);
      bootstrappedUserRef.current = user.userId;
      return;
    }
    if (bootstrappedUserRef.current === user.userId) {
      // 已尝试过恢复且仍无 session（失败或关闭后），允许 AgentSelector 建新会话
      setSessionReady(true);
      return;
    }

    bootstrappedUserRef.current = user.userId;
    const last = loadLastSession(user.userId);
    if (!last) {
      setSessionReady(true);
      return;
    }

    void restoreSession(last.sessionId, last.agentId).finally(() => {
      setSessionReady(true);
    });
  }, [user?.userId, sessionId, restoreSession]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  /** 上传文件列表（选文件 / 粘贴截图 / 粘贴文件共用） */
  const uploadFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) {
        return;
      }
      setIsUploading(true);
      setError(null);
      try {
        const uploaded: ChatAttachment[] = [];
        for (const file of files) {
          const res = await apiUploadFile(file);
          uploaded.push({
            fileId: res.fileId,
            name: res.name,
            mimeType: res.mimeType,
            size: res.size,
            url: res.url,
          });
        }
        setPendingFiles((prev) => [...prev, ...uploaded]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "附件上传失败");
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [setError],
  );

  const handlePickFiles = useCallback(
    (fileList: FileList | null): void => {
      void uploadFiles(fileList ? Array.from(fileList) : []);
    },
    [uploadFiles],
  );

  /** 粘贴截图 / 剪贴板文件 → 走附件上传（只绑在 textarea，避免冒泡重复） */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
      if (!agentId || isGenerating || isUploading) {
        return;
      }
      const dt = e.clipboardData;
      if (!dt) {
        return;
      }

      // 优先用 items；部分浏览器 items/files 会各报同一张截图
      const files: File[] = [];
      const seen = new Set<string>();

      const pushFile = (file: File | null) => {
        if (!file || file.size <= 0) {
          return;
        }
        // 截图用 size+type 去重（name/lastModified 不可靠）
        const key = `${file.type}:${file.size}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        const blankName =
          !file.name ||
          file.name === "image.png" ||
          file.name === "blob" ||
          file.name === "image.jpg";
        if (blankName && file.type.startsWith("image/")) {
          const ext = file.type.split("/")[1]?.split("+")[0] || "png";
          files.push(
            new File([file], `screenshot-${Date.now()}.${ext}`, { type: file.type }),
          );
        } else {
          files.push(file);
        }
      };

      const items = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
      if (items.length > 0) {
        for (const item of items) {
          pushFile(item.getAsFile());
        }
      } else {
        for (const file of Array.from(dt.files ?? [])) {
          pushFile(file);
        }
      }

      if (files.length === 0) {
        return; // 纯文本粘贴交给 textarea 默认行为
      }
      e.preventDefault();
      e.stopPropagation();
      void uploadFiles(files);
    },
    [agentId, isGenerating, isUploading, uploadFiles],
  );

  // Handle send
  const handleSend = useCallback((): void => {
    if (isGenerating || isUploading) {
      return;
    }
    if (!input.trim() && pendingFiles.length === 0) {
      return;
    }
    sendMessage(input, pendingFiles);
    setInput("");
    setPendingFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, pendingFiles, isGenerating, isUploading, sendMessage]);

  // Handle Enter key (Shift+Enter for newline)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Handle new session
  const handleNewSession = useCallback(async (): Promise<void> => {
    if (!agentId) {
      return;
    }
    setIsCreatingSession(true);
    try {
      await createSession(agentId);
    } finally {
      setIsCreatingSession(false);
    }
  }, [agentId, createSession]);

  // 切换智能体：清空当前画面，优先恢复该智能体最近会话，否则新建
  const handleAgentChange = useCallback(
    (newAgentId: string): void => {
      if (newAgentId === agentId && sessionId) {
        return;
      }
      if (!user?.userId) {
        void createSession(newAgentId);
        return;
      }
      const lastForAgent = loadLastSessionForAgent(user.userId, newAgentId);
      void (async () => {
        setIsCreatingSession(true);
        try {
          if (lastForAgent) {
            const ok = await restoreSession(lastForAgent.sessionId, newAgentId);
            if (ok) {
              return;
            }
          }
          await createSession(newAgentId);
        } finally {
          setIsCreatingSession(false);
        }
      })();
    },
    [agentId, sessionId, user?.userId, createSession, restoreSession],
  );

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header：窄宽（管理台 Sheet iframe）下换行，避免 Agent 徽标与按钮重叠 */}
      <div className="flex flex-col gap-2 border-b border-surface-light/50 px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 max-w-full flex-1 basis-[12rem]">
            {sessionReady ? (
              <AgentSelector value={agentId} onChange={handleAgentChange} />
            ) : (
              <span className="text-sm text-surface-dark/45">正在恢复会话…</span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void handleNewSession();
              }}
              className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
              disabled={!agentId || isCreatingSession}
            >
              {isCreatingSession ? "创建中..." : "新建对话"}
            </button>
            {sessionId && (
              <button
                type="button"
                onClick={closeSession}
                className="rounded-md border border-surface-light px-3 py-1.5 text-sm font-medium text-surface-dark/70 hover:bg-surface-muted transition-colors"
              >
                关闭对话
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ConnectionStatus state={wsState} />
          {pageContext?.route ? (
            <span
              className="truncate text-xs text-surface-dark/45"
              title={pageContext.route}
            >
              页面 {pageContext.route}
            </span>
          ) : null}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            className="ml-4 shrink-0 text-xs underline"
            onClick={() => setError(null)}
          >
            关闭
          </button>
        </div>
      )}

      {/* Message List */}
      <div className="flex-1 overflow-hidden">
        <MessageList messages={messages} currentUserId={user?.userId ?? ""} />
      </div>

      {/* Token Usage Footer */}
      {tokenUsage.total > 0 && (
        <div className="border-t border-surface-light/50 px-6 py-1.5 text-xs text-surface-dark/40">
          Token: {tokenUsage.prompt} + {tokenUsage.completion} ={" "}
          {tokenUsage.total}
        </div>
      )}

      {/* Input Area：支持选文件、粘贴截图/剪贴板文件 */}
      <div className="border-t border-surface-light/50 p-4">
        {pendingFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingFiles.map((f) => (
              <div
                key={f.fileId}
                className="relative max-w-[9rem] overflow-hidden rounded-md border border-surface-light bg-surface-muted/40"
              >
                {(f.mimeType || "").startsWith("image/") ? (
                  <img
                    src={getAuthedFileUrl(f.url || f.fileId)}
                    alt={f.name}
                    className="h-16 w-full object-cover"
                  />
                ) : (
                  <div className="truncate px-2 py-2 text-[11px] text-surface-dark/70">
                    {f.name}
                  </div>
                )}
                <button
                  type="button"
                  className="absolute right-0.5 top-0.5 rounded bg-black/50 px-1 text-[10px] text-white"
                  onClick={() =>
                    setPendingFiles((prev) => prev.filter((x) => x.fileId !== f.fileId))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept="image/*,.pdf,.txt,.csv,.json,.doc,.docx,.xls,.xlsx"
            onChange={(e) => {
              handlePickFiles(e.target.files);
            }}
          />
          <button
            type="button"
            title="添加图片或附件（也可 Ctrl+V 粘贴截图）"
            disabled={!agentId || isGenerating || isUploading}
            onClick={() => fileInputRef.current?.click()}
            className={clsx(
              "shrink-0 rounded-lg border border-surface-light px-3 py-3 text-sm text-surface-dark/70",
              "hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isUploading ? "…" : "附件"}
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              agentId
                ? "输入消息，可粘贴截图/文件，按 Enter 发送..."
                : "请先选择一个 Agent"
            }
            disabled={!agentId || isGenerating}
            rows={1}
            className={clsx(
              "flex-1 resize-none rounded-lg border border-surface-light bg-surface-muted/50 px-4 py-3 text-sm",
              "placeholder:text-surface-dark/30 focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            style={{ maxHeight: "200px" }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={
              (!input.trim() && pendingFiles.length === 0) ||
              isGenerating ||
              isUploading ||
              !agentId
            }
            className={clsx(
              "rounded-lg px-6 py-3 text-sm font-medium text-white transition-colors",
              "bg-primary-600 hover:bg-primary-700",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isGenerating ? "生成中..." : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;
