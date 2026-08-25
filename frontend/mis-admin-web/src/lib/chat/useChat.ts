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
import { generateClientId, type Attachment, type ChatMessage, type ChatStreamEvent, type InboundMessage, type SessionMessage, type UseChatReturn } from './types';

/** 会话 id 持久化 key（Copilot 面板最近会话）。 */
const LAST_SESSION_KEY = 'mis.copilot.lastSession';
/** 默认 Agent（留空走 Gateway 自动路由 / agent_router）。 */
const DEFAULT_AGENT_ID = '';

/**
 * 前端生成安全超时（毫秒）。
 *
 * <p>Agent Core {@code AGENT_MESSAGE_TIMEOUT} 默认 120s；前端略放宽到 140s，
 * 避免收不到 done/error（SSE 丢帧 / 粘滞映射丢失）时 {@code isGenerating}
 * 永久为 true、输入框锁死。超时后强制解锁并提示可重试。
 */
export const GENERATE_SAFETY_TIMEOUT_MS = 140_000;

/**
 * A2UI 对话 opt-in 默认开关。
 *
 * mis-admin-web 是新前端（D13 单前端统一），默认走 A2UI 通道
 * （messageType='a2ui_chat' + metadata.a2ui=true，与 Gateway /ws/chat opt-in
 * 分支 `messageType === 'a2ui_chat' || metadata.a2ui === true` 对齐）；
 * 存量 text 通道（Gateway runChat 不触发、走 MessageRouter 旧协议）通过
 * `a2uiEnabled: false` 保留，用于灰度回退。
 */
export const A2UI_CHAT_OPT_IN_DEFAULT = true;

/** WS 入站消息类型常量（与 Gateway server.ts /ws/chat opt-in 分支一致）。 */
export const MESSAGE_TYPE_A2UI_CHAT = 'a2ui_chat';
/** 旧文本通道消息类型（Gateway 走 MessageRouter 旧协议）。 */
export const MESSAGE_TYPE_TEXT = 'text';

export interface UseChatOptions {
  agentId?: string;
  /** 自动建立连接（默认 true；embed 场景由外部控制）。 */
  autoConnect?: boolean;
  /** 是否启用 A2UI 对话通道（默认取 A2UI_CHAT_OPT_IN_DEFAULT；false 回退旧 text 通道）。 */
  a2uiEnabled?: boolean;
}

/**
 * 对话 hook。需在 Router 内且已登录后调用。
 * 返回会话状态 + 动作；消息流与 A2UI Surface 均写入全局 store（chat-store / surface-store）。
 */
export function useChat(options?: UseChatOptions): UseChatReturn {
  const agentIdOption = options?.agentId ?? DEFAULT_AGENT_ID;
  const autoConnect = options?.autoConnect ?? true;
  const a2uiEnabled = options?.a2uiEnabled ?? A2UI_CHAT_OPT_IN_DEFAULT;

  const token = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const sessionId = useChatStore((s) => s.sessionId);
  const agentId = useChatStore((s) => s.agentId);
  const messages = useChatStore((s) => s.messages);
  const connectionState = useChatStore((s) => s.connectionState);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const error = useChatStore((s) => s.error);
  const historyState = useChatStore((s) => s.historyState);

  const sseRef = useRef<ChatSseController | null>(null);
  const wsRef = useRef<ChatWsClient | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const generateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const tokenRef = useRef<string | null>(token);
  sessionIdRef.current = sessionId;
  tokenRef.current = token;

  /** 清除生成安全超时计时器。 */
  const clearGenerateTimeout = useCallback((): void => {
    if (generateTimeoutRef.current != null) {
      clearTimeout(generateTimeoutRef.current);
      generateTimeoutRef.current = null;
    }
  }, []);

  /** 启动/重置生成安全超时（收不到 done/error 时强制解锁输入）。 */
  const armGenerateTimeout = useCallback((): void => {
    clearGenerateTimeout();
    generateTimeoutRef.current = setTimeout(() => {
      generateTimeoutRef.current = null;
      const store = useChatStore.getState();
      if (!store.isGenerating) return;
      const streamingId = streamingMessageIdRef.current;
      if (streamingId) {
        store.updateMessageStatus(streamingId, 'error');
        streamingMessageIdRef.current = null;
      }
      store.setGenerating(false);
      store.setError(
        `等待回复超时（${Math.round(GENERATE_SAFETY_TIMEOUT_MS / 1000)}s）。可重新发送，或检查 Agent 网关 / SSE 连接。`,
      );
    }, GENERATE_SAFETY_TIMEOUT_MS);
  }, [clearGenerateTimeout]);

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
        // 写入 SurfaceStore，并把 surfaceId 挂到当前 assistant 气泡，否则
        // ChatBubble 不会渲染 SurfaceRenderer（表面「有回包、界面空白」）。
        const surfaceId = processA2uiMessage(event) ?? event.surfaceId;
        if (surfaceId) {
          const streamingId = streamingMessageIdRef.current;
          if (streamingId) {
            store.updateMessage(streamingId, { surfaceId });
          } else {
            const id = generateClientId('msg');
            store.addMessage({
              id,
              sessionId: sid,
              role: 'assistant',
              content: '',
              status: 'streaming',
              timestamp: new Date().toISOString(),
              surfaceId,
            });
            streamingMessageIdRef.current = id;
          }
        }
        break;
      }

      case 'dispatch.trace': {
        const entries = event.trace?.entries ?? [];
        if (entries.length > 0) store.setDispatchTrace(entries);
        break;
      }

      case 'done': {
        clearGenerateTimeout();
        const streamingId = streamingMessageIdRef.current;
        if (streamingId) {
          const updates: Partial<ChatMessage> = { status: 'delivered' };
          // 评价锚点（feedback-enhance §2.2 方案 C）：done 帧携带的后端消息 UUID / 平台会话
          // UUID 写入当前 assistant 消息；缺失时保持 undefined（评价按钮降级禁用，不报错）。
          if (event.messageId) updates.backendMessageId = event.messageId;
          if (event.sessionId) updates.backendSessionId = event.sessionId;
          store.updateMessage(streamingId, updates);
          streamingMessageIdRef.current = null;
        }
        if (event.tokenUsage) store.addTokenUsage(event.tokenUsage);
        store.setGenerating(false);
        break;
      }

      case 'error': {
        clearGenerateTimeout();
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
  }, [clearGenerateTimeout]);

  // ------------------------------------------------------------------ 会话

  /**
   * 确保存在会话 id（本地生成 + 持久化；Gateway 接受客户端 sessionId）。
   *
   * @param preferredSessionId 传入时直接复用该会话（"切换会话"场景）；
   *                           不传则优先复用 localStorage 记忆，否则生成本地新会话。
   */
  const ensureSession = useCallback(async (preferredSessionId?: string): Promise<string> => {
    const existing = useChatStore.getState().sessionId;
    if (existing) return existing;

    useChatStore.getState().setSessionState('creating');
    let sid: string | null = null;
    if (preferredSessionId) {
      sid = preferredSessionId;
    } else {
      try {
        sid = localStorage.getItem(LAST_SESSION_KEY);
      } catch {
        sid = null;
      }
      if (!sid) {
        sid = generateClientId('web');
      }
    }
    useChatStore.getState().setSessionId(sid);
    useChatStore.getState().setAgentId(agentIdOption || null);
    useChatStore.getState().setSessionState('ready');
    // 记忆最近会话，便于下次打开续接（切换会话时也及时落盘）
    persistSession(sid);
    // P0-2：会话建立即拉取历史（先发过消息才落库，未落库 404 降级空会话不阻塞）
    void loadHistory();
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

  /**
   * 历史恢复：单条 {@link SessionMessage} → {@link ChatMessage}。
   *
   * <p>含附件（metadata.attachments → attachments）+ A2UI 还原（按现有渲染层约定：
   * 旧协议 ui.render 在 metadata，新协议 A2UI surface 在历史中暂无 surfaceId，
   * 仅还原可见文本/旧协议卡片；A2UI surface 历史恢复为 P1 评估，见架构文档 §9-3）。
   *
   * @param raw 历史原始消息（#29 端点返回）
   * @return 可直入 chat-store 的 ChatMessage
   */
  const mapSessionMessage = useCallback((raw: SessionMessage): ChatMessage => {
    const metadata = raw.metadata ?? {};
    const msg: ChatMessage = {
      id: raw.id,
      sessionId: raw.session_id,
      role: raw.role,
      content: raw.content ?? '',
      status: 'delivered',
      timestamp: raw.timestamp,
    };
    const attachments = metadata.attachments;
    if (Array.isArray(attachments) && attachments.length > 0) {
      msg.attachments = attachments.map((a) => ({
        fileId: a.fileId,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
        url: a.url,
        status: 'done' as const,
      }));
    }
    return msg;
  }, []);

  /**
   * P0-2 拉取历史并渲染（复用 #29 `GET /api/v1/agent-ops/sessions/{id}/messages`）。
   *
   * <p>三态：loading → loaded（setMessages 渲染） / error（404 / 失败降级空会话不阻塞）。
   * 仅当本地尚无消息（首进会话）时填充，避免重复进入覆盖在聊消息。
   */
  const loadHistory = useCallback(async (): Promise<void> => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const store = useChatStore.getState();
    if (store.historyState === 'loading') return;
    store.setHistoryState('loading');
    try {
      const res = await fetch(`/api/v1/agent-ops/sessions/${encodeURIComponent(sid)}/messages?page=1&page_size=200`, {
        headers: {
          Authorization: tokenRef.current ? `Bearer ${tokenRef.current}` : '',
        },
      });
      if (!res.ok) {
        // 404（sid 未落库）或任何失败 → 降级空会话，不抛错阻塞主流程
        store.setHistoryState('error');
        return;
      }
      const payload = (await res.json()) as { code: number; data?: SessionMessage[] };
      if (payload.code !== 0 || !Array.isArray(payload.data)) {
        store.setHistoryState('error');
        return;
      }
      const history = payload.data.map(mapSessionMessage);
      if (history.length > 0) {
        store.setMessages(history);
      }
      store.setHistoryState('loaded');
    } catch {
      store.setHistoryState('error');
    }
  }, [mapSessionMessage]);

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
    (content: string, attachments?: Attachment[]): void => {
      const text = content.trim();
      if (!text && (!attachments || attachments.length === 0)) return;
      const sid = sessionIdRef.current;
      if (!sid) return;
      const store = useChatStore.getState();

      // 附件已在 UI 层「先传后引」完成（uploadAttachment 拿回 fileId/url），
      // 此处仅做本地渲染 + 随文本放入 metadata.attachments 上行。
      const uploaded: Attachment[] = attachments
        ? attachments.map((a) => ({ ...a, status: 'done' as const }))
        : [];

      const userMessageId = generateClientId('msg');
      store.addMessage({
        id: userMessageId,
        sessionId: sid,
        role: 'user',
        content: text,
        status: 'delivered',
        timestamp: new Date().toISOString(),
        attachments: uploaded.length > 0 ? uploaded : undefined,
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
      armGenerateTimeout();
      store.setDispatchTrace([]);
      store.setError(null);

      // 构造 metadata（含附件引用）；旧 text 通道不携附件，灰度回退不受影响
      const metadata: InboundMessage['metadata'] = a2uiEnabled ? { a2ui: true } : {};
      if (uploaded.length > 0) {
        metadata.attachments = uploaded.map((a) => ({
          fileId: a.fileId,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          url: a.url,
        }));
      }

      const inbound: InboundMessage = {
        type: 'chat',
        sessionId: sid,
        userId: userId ?? undefined,
        agentId: store.agentId ?? undefined,
        content: text,
        // A2UI opt-in：新前端默认发 a2ui_chat + metadata.a2ui=true，
        // 触发 Gateway runChat（A2UI 中间件注入 render_a2ui 工具）；
        // 旧 text 通道经 a2uiEnabled=false 灰度回退。
        messageType: a2uiEnabled ? MESSAGE_TYPE_A2UI_CHAT : MESSAGE_TYPE_TEXT,
        metadata: a2uiEnabled || uploaded.length > 0 ? metadata : undefined,
        timestamp: new Date().toISOString(),
      };
      if (!sendInbound(inbound)) {
        streamingMessageIdRef.current = null;
        store.updateMessageStatus(assistantId, 'error');
        clearGenerateTimeout();
        store.setGenerating(false);
      }
    },
    [sendInbound, userId, a2uiEnabled, armGenerateTimeout, clearGenerateTimeout],
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
      clearGenerateTimeout();
      sse.abort();
      ws.close();
      sseRef.current = null;
      wsRef.current = null;
      streamingMessageIdRef.current = null;
    };
  }, [autoConnect, sessionId, token, handleEvent, clearGenerateTimeout]);

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
    historyState,
    sendMessage,
    respondToApproval,
    respondToEntitySelect,
    dispatchA2uiAction,
    ensureSession,
    loadHistory,
    closeSession,
    reconnect,
  };
}

export default useChat;
