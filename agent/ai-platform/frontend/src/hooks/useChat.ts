/**
 * useChat — WebSocket chat hook.
 *
 * Manages the WebSocket lifecycle for real-time chat communication
 * with the Gateway. Handles:
 * - WebSocket connection / reconnection
 * - Sending inbound messages (chat, approval responses)
 * - Receiving and processing AgentEvent streams
 * - Assembling streaming text deltas into complete messages
 * - Forwarding approval.request events to the approvalStore
 *
 * WebSocket endpoint: /ws/chat (Gateway's H5 WebSocket route)
 * Message format aligns with gateway/src/server.ts and
 * gateway/src/channels/ChannelCapability.ts
 */

import { useCallback, useEffect, useRef } from "react";
import { useChatStore, type PendingApproval } from "../store/chatStore";
import { useApprovalStore } from "../store/approvalStore";
import { useAuthStore } from "../store/authStore";
import { apiGet, apiPost } from "../utils/api";
import { adaptAgentEvent } from "../utils/cardAdapter";
import { getChatWsUrl } from "../utils/api";
import {
  clearLastSession,
  saveLastSession,
} from "../utils/lastSession";
import {
  normalizeCreateSessionResponse,
  normalizeSessionDetail,
  normalizeSessionMessages,
  type RawCreateSessionResponse,
  type RawSessionDetail,
  type RawSessionMessage,
} from "../utils/sessionAdapter";
import type {
  AgentEvent,
  DispatchTraceEntry,
  RawAgentEvent,
} from "../types/event";
import type { ChatMessage, InboundMessage } from "../types/message";

// ===== Configuration =====

/** Maximum reconnection attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Base delay for exponential backoff reconnection (ms). */
const RECONNECT_BASE_DELAY = 1000;

/** Heartbeat ping interval (ms). */
const HEARTBEAT_INTERVAL = 30000;

/** Abort generation if no terminal event within this window (ms). */
const GENERATION_TIMEOUT_MS = 120_000;

// ===== Hook Return Type =====

/** Return type of the useChat hook. */
interface UseChatReturn {
  /** Send a chat message (optional attachments already uploaded). */
  sendMessage: (content: string, attachments?: ChatMessage["attachments"]) => void;
  /** Respond to an approval request. */
  respondToApproval: (
    approvalId: string,
    decision: "approved" | "rejected",
    comment?: string,
  ) => void;
  /** Respond to a FormFill HITL entity-select request. */
  respondToEntitySelect: (data: {
    resumeToken: string;
    selectedCandidate?: Record<string, unknown>;
    action: "confirm" | "manual" | "cancel";
  }) => void;
  /** Create a new session. */
  createSession: (agentId: string) => Promise<void>;
  /** Restore an existing session (+ message history) from the backend. */
  restoreSession: (sessionId: string, preferredAgentId?: string) => Promise<boolean>;
  /** Close the current session. */
  closeSession: () => void;
  /** Manually reconnect the WebSocket. */
  reconnect: () => void;
}

// ===== Hook =====

/**
 * Chat WebSocket hook — manages real-time communication with the Gateway.
 *
 * Connects to the /ws/chat endpoint and processes AgentEvent streams.
 * Must be called within a component that has access to the authStore
 * (user must be authenticated).
 *
 * @param sessionId - The current session ID (null to skip connection).
 */
export function useChat(sessionId: string | null): UseChatReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 主动关闭（换会话 / 卸载）时置位，避免 onclose 触发重连风暴。 */
  const intentionalCloseRef = useRef(false);
  /** 始终指向最新 sessionId，供 reconnect 定时器读取，避免闭包旧值。 */
  const sessionIdRef = useRef<string | null>(sessionId);
  const streamingMessageIdRef = useRef<string | null>(null);
  const generationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  sessionIdRef.current = sessionId;

  const {
    agentId,
    setSessionId,
    setAgentId,
    setWsState,
    addMessage,
    updateMessage,
    updateMessageStatus,
    clearMessages,
    setMessages,
    setGenerating,
    addTokenUsage,
    setDispatchTrace,
    setError,
    addPendingApproval,
    removePendingApproval,
    setApprovalSender,
    setEntitySelectSender,
  } = useChatStore();

  const { addApproval } = useApprovalStore();
  const { user } = useAuthStore();

  // ===== Generate unique ID =====
  const generateId = useCallback((): string => {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }, []);

  // ===== Send Inbound Message =====
  const sendInbound = useCallback(
    (message: InboundMessage): boolean => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("WebSocket 未连接，无法发送消息");
        return false;
      }
      ws.send(JSON.stringify(message));
      return true;
    },
    [setError],
  );

  /** 发送失败或异常时解除「生成中」并标记占位消息为错误。 */
  const clearGenerationWatchdog = useCallback((): void => {
    if (generationTimeoutRef.current) {
      clearTimeout(generationTimeoutRef.current);
      generationTimeoutRef.current = null;
    }
  }, []);

  const abortGenerating = useCallback(
    (errorMessage?: string): void => {
      clearGenerationWatchdog();
      const streamingId = streamingMessageIdRef.current;
      if (streamingId) {
        updateMessageStatus(streamingId, "error");
        streamingMessageIdRef.current = null;
      }
      setGenerating(false);
      if (errorMessage) {
        setError(errorMessage);
      }
    },
    [clearGenerationWatchdog, updateMessageStatus, setGenerating, setError],
  );

  const armGenerationWatchdog = useCallback((): void => {
    clearGenerationWatchdog();
    generationTimeoutRef.current = setTimeout(() => {
      if (useChatStore.getState().isGenerating) {
        abortGenerating("请求超时，请稍后重试");
      }
    }, GENERATION_TIMEOUT_MS);
  }, [clearGenerationWatchdog, abortGenerating]);

  // ===== Handle Raw Event =====
  const handleRawEvent = useCallback(
    (rawEvent: RawAgentEvent): void => {
      const event: AgentEvent = adaptAgentEvent(rawEvent);
      if (useChatStore.getState().isGenerating) {
        armGenerationWatchdog();
      }

      switch (event.type) {
        case "text.delta": {
          // Accumulate text delta into the streaming message
          const streamingId = streamingMessageIdRef.current;
          if (streamingId) {
            const messages = useChatStore.getState().messages;
            const existing = messages.find((m) => m.id === streamingId);
            if (existing) {
              updateMessage(streamingId, {
                content: existing.content + (event.content ?? ""),
                status: "streaming",
              });
            }
          }
          break;
        }

        case "tool.call": {
          // Add a tool call message
          const toolMessageId = generateId();
          const toolMessage: ChatMessage = {
            id: toolMessageId,
            sessionId: sessionId ?? "",
            role: "tool",
            content: `调用工具: ${event.toolName ?? "unknown"}`,
            status: "delivered",
            timestamp: new Date().toISOString(),
            toolName: event.toolName,
            toolArgs: event.args ? JSON.stringify(event.args, null, 2) : undefined,
          };
          addMessage(toolMessage);
          break;
        }

        case "tool.result": {
          // Update the last tool message with the result
          const messages = useChatStore.getState().messages;
          const lastToolMessage = [...messages]
            .reverse()
            .find((m) => m.role === "tool" && m.toolName === event.toolName);
          if (lastToolMessage) {
            updateMessage(lastToolMessage.id, {
              toolResult: event.result
                ? JSON.stringify(event.result, null, 2)
                : undefined,
              content: `工具 ${event.toolName ?? "unknown"} 执行完成`,
            });
          }
          break;
        }

        case "ui.render": {
          // A2UI 真实渲染（DEP-8）：组件名 + props 存入 message.a2ui，
          // 由 MessageList 经组件注册表渲染（props 保持原始，A2uiRenderer 内 camelize）。
          if (event.component != null && event.props != null) {
            const uiMessage: ChatMessage = {
              id: generateId(),
              sessionId: sessionId ?? "",
              role: "assistant",
              content: "",
              status: "delivered",
              timestamp: new Date().toISOString(),
              a2ui: {
                component: event.component,
                props: event.props as Record<string, unknown>,
              },
            };
            addMessage(uiMessage);
          }
          break;
        }

        case "approval.request": {
          // Forward to approval store and chat store
          if (event.detail) {
            const approvalId = event.detail.approvalId;
            const messageId = generateId();
            const approvalMessage: ChatMessage = {
              id: messageId,
              sessionId: sessionId ?? "",
              role: "assistant",
              content: event.detail.description || "需要审批操作",
              status: "delivered",
              timestamp: new Date().toISOString(),
              requiresApproval: true,
              approvalId,
            };
            addMessage(approvalMessage);

            const pendingApproval: PendingApproval = {
              approvalId,
              skillId: event.skillId ?? event.detail.skillId,
              detail: event.detail,
              messageId,
              createdAt: Date.now(),
              status: "pending",
            };
            addPendingApproval(pendingApproval);
            addApproval({
              approvalId,
              sessionId: sessionId ?? "",
              agentId: agentId ?? "",
              skillId: event.skillId ?? event.detail.skillId,
              detail: event.detail,
              userId: user?.userId ?? "",
              status: "pending",
              createdAt: new Date().toISOString(),
              resolvedAt: null,
              comment: null,
              timeoutSeconds: 300,
            });
          }
          break;
        }

        case "dispatch.trace": {
          // 通道 C：Coordinator→Worker 调度轨迹，写入 store 供 DispatchHint 渲染。
          // 空 entries 不覆盖既有提示（避免 Worker 无调度时闪烁清空）。
          const entries: DispatchTraceEntry[] = event.trace?.entries ?? [];
          if (entries.length > 0) {
            setDispatchTrace(entries);
          }
          break;
        }

        case "error": {
          setError(
            `错误 [${event.errorCode ?? "unknown"}]: ${event.message ?? "未知错误"}`,
          );
          // Finalize the streaming message with error status
          const streamingId = streamingMessageIdRef.current;
          if (streamingId) {
            updateMessageStatus(streamingId, "error");
            streamingMessageIdRef.current = null;
          }
          clearGenerationWatchdog();
          setGenerating(false);
          break;
        }

        case "done": {
          // Finalize the streaming message
          const streamingId = streamingMessageIdRef.current;
          if (streamingId) {
            updateMessageStatus(streamingId, "delivered");
            streamingMessageIdRef.current = null;
          }
          // Accumulate token usage
          if (event.tokenUsage) {
            addTokenUsage(event.tokenUsage);
          }
          clearGenerationWatchdog();
          setGenerating(false);
          break;
        }

        default: {
          // Unknown event type — ignore
          break;
        }
      }
    },
    [
      sessionId,
      agentId,
      user,
      generateId,
      addMessage,
      updateMessage,
      updateMessageStatus,
      addTokenUsage,
      setDispatchTrace,
      setGenerating,
      setError,
      addPendingApproval,
      addApproval,
      armGenerationWatchdog,
      clearGenerationWatchdog,
    ],
  );

  // ===== WebSocket Message Handler =====
  const handleWsMessage = useCallback(
    (data: string): void => {
      try {
        const parsed = JSON.parse(data) as {
          type?: string;
          data?: unknown;
          event?: RawAgentEvent;
          [key: string]: unknown;
        };

        // Handle different message envelope formats
        if (parsed.type === "event" && parsed.event) {
          handleRawEvent(parsed.event);
        } else if (parsed.type === "agent_event" && parsed.event) {
          handleRawEvent(parsed.event as RawAgentEvent);
        } else if (parsed.type && parsed.type.includes(".")) {
          // Direct event (no envelope)
          handleRawEvent(parsed as unknown as RawAgentEvent);
        } else if (parsed.data && typeof parsed.data === "object") {
          const dataObj = parsed.data as Record<string, unknown>;
          if (dataObj.type && typeof dataObj.type === "string") {
            handleRawEvent(dataObj as unknown as RawAgentEvent);
          }
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    },
    [handleRawEvent],
  );

  const clearReconnectTimer = useCallback((): void => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  /** 主动关闭当前 WS，并取消待执行的重连。 */
  const closeSocketIntentionally = useCallback((): void => {
    intentionalCloseRef.current = true;
    clearReconnectTimer();
    reconnectAttemptsRef.current = 0;
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (wsRef.current) {
      const socket = wsRef.current;
      wsRef.current = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
    }
  }, [clearReconnectTimer]);

  // ===== Connect WebSocket =====
  const connect = useCallback((): void => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId || !user) {
      return;
    }

    // Close existing connection without triggering reconnect
    closeSocketIntentionally();
    intentionalCloseRef.current = false;

    setWsState("connecting");
    const wsUrl = getChatWsUrl(activeSessionId, user.userId);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    const connectedSessionId = activeSessionId;

    ws.onopen = () => {
      // 会话已切换则丢弃这条迟到的连接
      if (sessionIdRef.current !== connectedSessionId) {
        intentionalCloseRef.current = true;
        ws.close();
        return;
      }
      setWsState("connected");
      reconnectAttemptsRef.current = 0;

      // Start heartbeat
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      heartbeatIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping", timestamp: new Date().toISOString() }));
        }
      }, HEARTBEAT_INTERVAL);
    };

    ws.onmessage = (event: MessageEvent) => {
      handleWsMessage(event.data as string);
    };

    ws.onerror = () => {
      if (intentionalCloseRef.current) {
        return;
      }
      setWsState("error");
      setError("WebSocket 连接错误");
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      clearGenerationWatchdog();

      // 主动关闭或会话已切换：不重连
      if (
        intentionalCloseRef.current ||
        sessionIdRef.current !== connectedSessionId
      ) {
        intentionalCloseRef.current = false;
        return;
      }

      setWsState("disconnected");

      // Attempt reconnection only for the still-active session
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        const delay =
          RECONNECT_BASE_DELAY *
          Math.pow(2, reconnectAttemptsRef.current - 1);
        setWsState("reconnecting");
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (sessionIdRef.current === connectedSessionId) {
            connect();
          }
        }, delay);
      }
    };
  }, [
    user,
    setWsState,
    setError,
    handleWsMessage,
    clearGenerationWatchdog,
    closeSocketIntentionally,
    clearReconnectTimer,
  ]);

  // ===== Auto-connect when sessionId changes =====
  useEffect(() => {
    if (sessionId && user) {
      connect();
    } else {
      closeSocketIntentionally();
      setWsState("disconnected");
    }

    return () => {
      closeSocketIntentionally();
      clearGenerationWatchdog();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, user]);

  // ===== Send Chat Message =====
  const sendMessage = useCallback(
    (content: string, attachments?: ChatMessage["attachments"]): void => {
      const text = content.trim();
      const files = attachments?.filter((a) => a.fileId) ?? [];
      if (!text && files.length === 0) {
        return;
      }

      const hasImage = files.some((a) => (a.mimeType || "").startsWith("image/"));
      const messageType =
        files.length === 0 ? "text" : hasImage && !text ? "image" : "file";

      // Add user message to history
      const userMessage: ChatMessage = {
        id: generateId(),
        sessionId: sessionId ?? "",
        role: "user",
        content: text || (files.length > 0 ? "（附件）" : ""),
        status: "delivered",
        timestamp: new Date().toISOString(),
        attachments: files.length > 0 ? files : undefined,
      };
      addMessage(userMessage);

      // Prepare streaming assistant message placeholder
      const assistantMessageId = generateId();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        sessionId: sessionId ?? "",
        role: "assistant",
        content: "",
        status: "streaming",
        timestamp: new Date().toISOString(),
        agentId: agentId ?? undefined,
      };
      addMessage(assistantMessage);
      streamingMessageIdRef.current = assistantMessageId;
      setGenerating(true);
      setDispatchTrace([]);
      armGenerationWatchdog();

      // Send inbound message
      const inbound: InboundMessage = {
        type: "chat",
        sessionId: sessionId ?? "",
        userId: user?.userId ?? "",
        agentId: agentId ?? undefined,
        content: text,
        messageType,
        metadata:
          files.length > 0
            ? {
                attachments: files.map((a) => ({
                  fileId: a.fileId,
                  file_id: a.fileId,
                  name: a.name,
                  mimeType: a.mimeType,
                  mime_type: a.mimeType,
                  size: a.size,
                  url: a.url,
                })),
              }
            : undefined,
        timestamp: new Date().toISOString(),
      };
      if (!sendInbound(inbound)) {
        abortGenerating("WebSocket 未连接，无法发送消息");
        return;
      }
    },
    [
      sessionId,
      agentId,
      user,
      generateId,
      addMessage,
      setGenerating,
      setDispatchTrace,
      sendInbound,
      abortGenerating,
      armGenerationWatchdog,
    ],
  );

  // ===== Respond to Approval =====
  const respondToApproval = useCallback(
    (
      approvalId: string,
      decision: "approved" | "rejected",
      comment?: string,
    ): void => {
      const inbound: InboundMessage = {
        type: "approval",
        sessionId: sessionId ?? "",
        userId: user?.userId ?? "",
        approvalResponse: {
          approvalId,
          decision,
          comment: comment ?? "",
        },
        timestamp: new Date().toISOString(),
      };
      sendInbound(inbound);
      removePendingApproval(approvalId);
    },
    [sessionId, user, sendInbound, removePendingApproval],
  );

  // 将审批发送器注入 chatStore，供 A2UI approval-card 组件调用（DEP-8）。
  // 置于 respondToApproval 定义之后，避免「声明前使用」的 TDZ 类型错误。
  useEffect(() => {
    setApprovalSender((id, decision, comment) => respondToApproval(id, decision, comment));
    return () => setApprovalSender(null);
  }, [respondToApproval, setApprovalSender]);

  // ===== Respond to Entity Select (FormFill HITL) =====
  const respondToEntitySelect = useCallback(
    (data: {
      resumeToken: string;
      selectedCandidate?: Record<string, unknown>;
      action: "confirm" | "manual" | "cancel";
    }): void => {
      const inbound: InboundMessage = {
        type: "entity_select",
        sessionId: sessionId ?? "",
        userId: user?.userId ?? "",
        entitySelectResponse: {
          resumeToken: data.resumeToken,
          selectedCandidate: data.selectedCandidate,
          action: data.action,
        },
        timestamp: new Date().toISOString(),
      };
      sendInbound(inbound);
    },
    [sessionId, user, sendInbound],
  );

  // 将实体选择发送器注入 chatStore，供 A2UI entity-select 组件调用（T03）。
  useEffect(() => {
    setEntitySelectSender((data) => respondToEntitySelect(data));
    return () => setEntitySelectSender(null);
  }, [respondToEntitySelect, setEntitySelectSender]);

  // ===== Create Session =====
  const createSession = useCallback(
    async (newAgentId: string): Promise<void> => {
      if (!user?.userId) {
        setError("用户未登录，无法创建会话");
        return;
      }

      streamingMessageIdRef.current = null;
      clearGenerationWatchdog();
      setGenerating(false);

      try {
        const raw = await apiPost<RawCreateSessionResponse>("/sessions", {
          agent_id: newAgentId,
          user_id: user.userId,
          channel: "web",
        });
        const data = normalizeCreateSessionResponse(raw);

        setAgentId(newAgentId);
        clearMessages();
        setSessionId(data.sessionId);
        setError(null);
        if (user.userId) {
          saveLastSession(user.userId, data.sessionId, newAgentId);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "创建会话失败，请稍后重试";
        setError(message);
      }
    },
    [user, setAgentId, setSessionId, clearMessages, setError, setGenerating, clearGenerationWatchdog],
  );

  // ===== Restore Session =====
  const restoreSession = useCallback(
    async (targetSessionId: string, preferredAgentId?: string): Promise<boolean> => {
      if (!user?.userId || !targetSessionId) {
        return false;
      }

      streamingMessageIdRef.current = null;
      clearGenerationWatchdog();
      setGenerating(false);

      try {
        const rawSession = await apiGet<RawSessionDetail>(`/sessions/${targetSessionId}`);
        const detail = normalizeSessionDetail(rawSession);
        if (detail.userId && detail.userId !== user.userId) {
          clearLastSession(user.userId);
          return false;
        }

        const rawMessages = await apiGet<RawSessionMessage[]>(
          `/sessions/${targetSessionId}/messages`,
        );
        const history = normalizeSessionMessages(detail.sessionId, rawMessages);
        const nextAgentId = detail.agentId || preferredAgentId || "";

        setAgentId(nextAgentId || null);
        setMessages(history);
        setSessionId(detail.sessionId);
        setError(null);
        if (nextAgentId) {
          saveLastSession(user.userId, detail.sessionId, nextAgentId);
        }
        return true;
      } catch {
        clearLastSession(user.userId);
        return false;
      }
    },
    [
      user,
      clearGenerationWatchdog,
      setGenerating,
      setAgentId,
      setMessages,
      setSessionId,
      setError,
    ],
  );

  // ===== Close Session =====
  const closeSession = useCallback((): void => {
    if (sessionId) {
      const inbound: InboundMessage = {
        type: "session.close",
        sessionId,
        userId: user?.userId ?? "",
        timestamp: new Date().toISOString(),
      };
      sendInbound(inbound);
    }

    if (user?.userId) {
      // 仅清除当前智能体的最近会话，其它智能体记录保留
      clearLastSession(user.userId, agentId ?? undefined);
    }

    closeSocketIntentionally();
    clearMessages();
    setSessionId(null);
    clearGenerationWatchdog();
    setGenerating(false);
  }, [
    sessionId,
    agentId,
    user,
    sendInbound,
    closeSocketIntentionally,
    clearMessages,
    setSessionId,
    setGenerating,
    clearGenerationWatchdog,
  ]);

  // ===== Manual Reconnect =====
  const reconnect = useCallback((): void => {
    reconnectAttemptsRef.current = 0;
    intentionalCloseRef.current = false;
    connect();
  }, [connect]);

  return {
    sendMessage,
    respondToApproval,
    respondToEntitySelect,
    createSession,
    restoreSession,
    closeSession,
    reconnect,
  };
}

export default useChat;
