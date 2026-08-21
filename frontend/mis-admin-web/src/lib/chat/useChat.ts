/**
 * useChat — chat-core 对话 hook（T06' 迁入 mis-admin-web）。
 *
 * <p>自研会话管理层：SSE 接收（@microsoft/fetch-event-source）+ WebSocket 发送
 * （Gateway /ws/chat）+ zustand 状态（chat-store）。按最终事件协议处理流式事件：
 * - `stream`（TEXT_MESSAGE_CHUNK）→ 追加到当前 assistant 消息
 * - `a2ui_surface`（ACTIVITY_SNAPSHOT）→ 交给 MessageProcessor 更新 SurfaceStore
 * - `dispatch.trace` → 写入 store 供调度提示渲染
 * - `done` / `error` → run 生命周期收尾
 * - 旧协议（text.delta / tool.call / ui.render / approval.request）兼容归一化
 *
 * <p>认证：MIS RS256 JWT 来自 auth-store；SSE 经 Authorization header，WS 经 query token。
 */

import { useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/stores/chat-store';
import { useSurfaceStore } from '@/lib/a2ui/surface-store';
import { subscribeChatStream, type ChatSseController } from './sse-client';
import { ChatWsClient } from './ws-client';
import { processA2uiMessage } from '@/lib/a2ui/MessageProcessor';
import { generateClientId, type ChatStreamEvent, type InboundMessage, type UseChatReturn } from './types';

/** 会话 id 持久化 key（Copilot 面板最近会话）。 */
const LAST_SESSION_KEY = 'mis.copilot.lastSession';
/** 默认 Agent（留空走 Gateway 自动路由 / agent_router）。 */
const DEFAULT_AGENT_ID = '';

export interface UseChatOptions {
  agentId?: string;
  /** 自动建立连接（默认 true；embed 场景由外部控制）。 */
  autoConnect?: boolean;
}

/**
 * 对话 hook。需在 Router 内且已登录后调用。
 * 返回会话状态 + 动作；消息流与 A2UI Surface 均写入全局 store（chat-store / surface-store）。
 */
export function useChat(options?: UseChatOptions): UseChatReturn {
  const agentIdOption = options?.agentId ?? DEFAULT_AGENT_ID;
  const autoConnect = options?.autoConnect ?? true;

  const token = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const sessionId = useChatStore((s) => s.sessionId);
  const agentId = useChatStore((s) => s.agentId);
  const messages = useChatStore((s) => s.messages);
  const connectionState = useChatStore((s) => s.connectionState);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const error = useChatStore((s) => s.error);

  const sseRef = useRef<ChatSseController | null>(null);
  const wsRef = useRef<ChatWsClient | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const tokenRef = useRef<string | null>(token);
  sessionIdRef.current = sessionId;
  tokenRef.current = token;

  // ------------------------------------------------------------------ 事件处理

  /** 处理单条流式事件（写入 chat-store / surface-store）。 */
  const handleEvent = useCallback((event: ChatStreamEvent): void => {
    const store = useChatStore.getState();
    const sid = sessionIdRef.current ?? '';

    switch (event.type) {
      case 'stream': {
        const delta = event.content ?? '';
        const streamingId = streamingMessageIdRef.current;
        if (streamingId) {
          const existing = store.messages.find((m) => m.id === streamingId);
          if (existing) {
            store.updateMessage(streamingId, {
              content: existing.content + delta,
              status: 'streaming',
            });
          }
        } else {
          // 没有占位消息时补一条（部分 Gateway 实现不先发 done 前的占位）
          const id = generateClientId('msg');
          store.addMessage({
            id,
            sessionId: sid,
            role: 'assistant',
            content: delta,
            status: 'streaming',
            timestamp: new Date().toISOString(),
          });
          streamingMessageIdRef.current = id;
        }
        break;
      }

      case 'a2ui_surface': {
        processA2uiMessage(event);
        break;
      }

      case 'dispatch.trace': {
        const entries = event.trace?.entries ?? [];
        if (entries.length > 0) store.setDispatchTrace(entries);
        break;
      }

      case 'done': {
        const streamingId = streamingMessageIdRef.current;
        if (streamingId) {
          store.updateMessageStatus(streamingId, 'delivered');
          streamingMessageIdRef.current = null;
        }
        if (event.tokenUsage) store.addTokenUsage(event.tokenUsage);
        store.setGenerating(false);
        break;
      }

      case 'error': {
        const streamingId = streamingMessageIdRef.current;
        if (streamingId) {
          store.updateMessageStatus(streamingId, 'error');
          streamingMessageIdRef.current = null;
        }
        store.setError(`错误 [${event.errorCode ?? 'unknown'}]: ${event.message}`);
        store.setGenerating(false);
        break;
      }

      // ---- 旧协议兼容 ----
      case 'text.delta': {
        const delta = event.content ?? '';
        const streamingId = streamingMessageIdRef.current;
        if (streamingId) {
          const existing = store.messages.find((m) => m.id === streamingId);
          if (existing) {
            store.updateMessage(streamingId, {
              content: existing.content + delta,
              status: 'streaming',
            });
          }
        }
        break;
      }

      case 'tool.call': {
        store.addMessage({
          id: generateClientId('msg'),
          sessionId: sid,
          role: 'tool',
          content: `调用工具: ${event.toolName ?? 'unknown'}`,
          status: 'delivered',
          timestamp: new Date().toISOString(),
          toolName: event.toolName,
          toolArgs: event.args ? JSON.stringify(event.args, null, 2) : undefined,
        });
        break;
      }

      case 'tool.result': {
        // 兼容：更新最近一条同名 tool 消息
        const messages = store.messages;
        const lastTool = [...messages].reverse().find((m) => m.role === 'tool' && m.toolName === event.toolName);
        if (lastTool) {
          store.updateMessage(lastTool.id, {
            content: `工具 ${event.toolName ?? 'unknown'} 执行完成`,
            toolArgs: event.result ? JSON.stringify(event.result, null, 2) : lastTool.toolArgs,
          });
        }
        break;
      }

      case 'ui.render': {
        if (event.component != null && event.props != null) {
          store.addMessage({
            id: generateClientId('msg'),
            sessionId: sid,
            role: 'assistant',
            content: '',
            status: 'delivered',
            timestamp: new Date().toISOString(),
            a2ui: { component: event.component, props: event.props },
          });
        }
        break;
      }

      case 'approval.request': {
        // 旧协议 approval.request → 转 approval-card Surface 渲染（新协议由 Gateway 下发）
        const detail = event.detail ?? {};
        const surfaceId = `approval-${generateClientId('sfc')}`;
        const approvalId =
          (detail as { approvalId?: string }).approvalId ??
          (detail as { approval_id?: string }).approval_id ??
          surfaceId;
        processA2uiMessage({
          type: 'a2ui_surface',
          operations: [
            {
              op: 'createSurface',
              surfaceId,
              components: [
                {
                  id: 'approval-card-001',
                  component: 'approval-card',
                  props: {
                    approvalId,
                    title: (detail as { title?: string }).title ?? '操作审批请求',
                    description: (detail as { description?: string }).description ?? '',
                    fields: (detail as { fields?: unknown }).fields,
                  },
                },
              ],
            },
          ],
        });
        store.addMessage({
          id: generateClientId('msg'),
          sessionId: sid,
          role: 'assistant',
          content: (detail as { description?: string }).description ?? '需要审批操作',
          status: 'delivered',
          timestamp: new Date().toISOString(),
          surfaceId,
        });
        break;
      }

      default:
        break;
    }
  }, []);

  // ------------------------------------------------------------------ 会话

  /** 确保存在会话 id（本地生成 + 持久化；Gateway 接受客户端 sessionId）。 */
  const ensureSession = useCallback(async (): Promise<string> => {
    const existing = useChatStore.getState().sessionId;
    if (existing) return existing;

    useChatStore.getState().setSessionState('creating');
    let sid: string | null = null;
    try {
      sid = localStorage.getItem(LAST_SESSION_KEY);
    } catch {
      sid = null;
    }
    if (!sid) {
      sid = generateClientId('web');
    }
    useChatStore.getState().setSessionId(sid);
    useChatStore.getState().setAgentId(agentIdOption || null);
    useChatStore.getState().setSessionState('ready');
    return sid;
  }, [agentIdOption]);

  /** 保存最近会话（供下次打开续接）。 */
  const persistSession = useCallback((sid: string | null): void => {
    try {
      if (sid) localStorage.setItem(LAST_SESSION_KEY, sid);
      else localStorage.removeItem(LAST_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // ------------------------------------------------------------------ 发送

  const sendInbound = useCallback((message: InboundMessage): boolean => {
    const ws = wsRef.current;
    if (!ws || !ws.isOpen()) {
      useChatStore.getState().setError('连接未就绪，无法发送消息');
      return false;
    }
    return ws.send(message);
  }, []);

  const sendMessage = useCallback(
    (content: string): void => {
      const text = content.trim();
      if (!text) return;
      const sid = sessionIdRef.current;
      if (!sid) return;
      const store = useChatStore.getState();

      const userMessageId = generateClientId('msg');
      store.addMessage({
        id: userMessageId,
        sessionId: sid,
        role: 'user',
        content: text,
        status: 'delivered',
        timestamp: new Date().toISOString(),
      });

      const assistantId = generateClientId('msg');
      store.addMessage({
        id: assistantId,
        sessionId: sid,
        role: 'assistant',
        content: '',
        status: 'streaming',
        timestamp: new Date().toISOString(),
        agentId: store.agentId ?? undefined,
      });
      streamingMessageIdRef.current = assistantId;
      store.setGenerating(true);
      store.setDispatchTrace([]);
      store.setError(null);

      const inbound: InboundMessage = {
        type: 'chat',
        sessionId: sid,
        userId: userId ?? undefined,
        agentId: store.agentId ?? undefined,
        content: text,
        messageType: 'text',
        timestamp: new Date().toISOString(),
      };
      if (!sendInbound(inbound)) {
        streamingMessageIdRef.current = null;
        store.updateMessageStatus(assistantId, 'error');
        store.setGenerating(false);
      }
    },
    [sendInbound, userId],
  );

  const respondToApproval = useCallback(
    (approvalId: string, decision: 'approved' | 'rejected', comment?: string): void => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const inbound: InboundMessage = {
        type: 'approval',
        sessionId: sid,
        userId: userId ?? undefined,
        approvalResponse: { approvalId, decision, comment: comment ?? '' },
        timestamp: new Date().toISOString(),
      };
      sendInbound(inbound);
    },
    [sendInbound, userId],
  );

  const respondToEntitySelect = useCallback(
    (data: {
      resumeToken: string;
      selectedCandidate?: Record<string, unknown>;
      action: 'confirm' | 'manual' | 'cancel';
    }): void => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const inbound: InboundMessage = {
        type: 'entity_select',
        sessionId: sid,
        userId: userId ?? undefined,
        entitySelectResponse: data,
        timestamp: new Date().toISOString(),
      };
      sendInbound(inbound);
    },
    [sendInbound, userId],
  );

  const dispatchA2uiAction = useCallback(
    (action: import('@/lib/a2ui/types').A2uiClientAction): void => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const inbound: InboundMessage = {
        type: 'a2ui_action',
        sessionId: sid,
        userId: userId ?? undefined,
        action,
        timestamp: new Date().toISOString(),
      };
      sendInbound(inbound);
    },
    [sendInbound, userId],
  );

  // ------------------------------------------------------------------ 连接生命周期

  useEffect(() => {
    const activeSid = sessionIdRef.current;
    const activeToken = tokenRef.current;
    if (!autoConnect || !activeSid || !activeToken) return undefined;

    // SSE 接收
    const sse = subscribeChatStream({
      sessionId: activeSid,
      token: activeToken,
      onEvent: handleEvent,
      onStateChange: (state) => {
        useChatStore.getState().setConnectionState(state === 'closed' ? 'idle' : state);
      },
    });
    sseRef.current = sse;

    // WS 发送
    const ws = new ChatWsClient({
      sessionId: activeSid,
      token: activeToken,
      onStateChange: (state) => {
        if (state === 'connected' || state === 'reconnecting' || state === 'error') {
          useChatStore.getState().setConnectionState(state);
        }
      },
      onError: (message) => useChatStore.getState().setError(message),
    });
    ws.connect();
    wsRef.current = ws;

    return () => {
      sse.abort();
      ws.close();
      sseRef.current = null;
      wsRef.current = null;
      streamingMessageIdRef.current = null;
    };
  }, [autoConnect, sessionId, token, handleEvent]);

  const closeSession = useCallback((): void => {
    const sid = sessionIdRef.current;
    if (sid) {
      sendInbound({ type: 'session.close', sessionId: sid, timestamp: new Date().toISOString() });
    }
    persistSession(null);
    useChatStore.getState().clearMessages();
    useChatStore.getState().setSessionId(null);
    useChatStore.getState().setSessionState('none');
    useChatStore.getState().setError(null);
    // QA 建议 2：关闭会话时清空 A2UI Surface，避免旧卡片残留
    useSurfaceStore.getState().clear();
    // surface 清理
    useChatStore.getState().setDispatchTrace([]);
  }, [sendInbound, persistSession]);

  const reconnect = useCallback((): void => {
    const sid = sessionIdRef.current;
    const activeToken = tokenRef.current;
    if (!sid || !activeToken) return;
    sseRef.current?.abort();
    wsRef.current?.close();
    // 重新触发 effect：sessionId 不变不会重跑，这里手动重建
    const sse = subscribeChatStream({
      sessionId: sid,
      token: activeToken,
      onEvent: handleEvent,
      onStateChange: (state) => {
        useChatStore.getState().setConnectionState(state === 'closed' ? 'idle' : state);
      },
    });
    sseRef.current = sse;
    const ws = new ChatWsClient({
      sessionId: sid,
      token: activeToken,
      onStateChange: (state) => {
        if (state === 'connected' || state === 'reconnecting' || state === 'error') {
          useChatStore.getState().setConnectionState(state);
        }
      },
      onError: (message) => useChatStore.getState().setError(message),
    });
    ws.connect();
    wsRef.current = ws;
  }, [handleEvent]);

  return {
    sessionId,
    agentId,
    messages,
    connectionState,
    isGenerating,
    error,
    sendMessage,
    respondToApproval,
    respondToEntitySelect,
    dispatchA2uiAction,
    ensureSession,
    closeSession,
    reconnect,
  };
}

export default useChat;
