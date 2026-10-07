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
import { useSurfaceStore, scopeSurfaceToMessage } from '@/lib/a2ui/surface-store';
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

/** 历史/流式 content 规约为可渲染字符串（避免对象子节点导致整行崩溃）。 */
function coerceChatContent(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof raw === 'object' && raw !== null && 'text' in raw) {
    const text = (raw as { text?: unknown }).text;
    return typeof text === 'string' ? text : coerceChatContent(text);
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return '';
  }
}

/** 历史 role 归一化（容错大小写 / 空值）。 */
function normalizeChatRole(raw: unknown): ChatMessage['role'] {
  const role = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') {
    return role;
  }
  return 'assistant';
}

/** 助手气泡是否已有可展示内容（正文 / surface / 旧协议卡片）。 */
function hasVisibleAssistantPayload(msg: ChatMessage | undefined): boolean {
  if (!msg) return false;
  if (msg.content.trim().length > 0) return true;
  if (msg.surfaceId) return true;
  if (msg.a2ui) return true;
  return false;
}

/**
 * 将增量挂到「当前流式锚点」或最近一条助手消息，避免 done 后晚到帧再开新气泡。
 * @returns 目标消息 id
 */
function resolveAssistantTargetId(
  store: ReturnType<typeof useChatStore.getState>,
  streamingIdRef: { current: string | null },
  sid: string,
): string {
  const streamingId = streamingIdRef.current;
  if (streamingId && store.messages.some((m) => m.id === streamingId)) {
    return streamingId;
  }
  const lastAssistant = [...store.messages].reverse().find((m) => m.role === 'assistant');
  if (lastAssistant) {
    streamingIdRef.current = lastAssistant.id;
    return lastAssistant.id;
  }
  const id = generateClientId('msg');
  store.addMessage({
    id,
    sessionId: sid,
    role: 'assistant',
    content: '',
    status: 'streaming',
    timestamp: new Date().toISOString(),
  });
  streamingIdRef.current = id;
  return id;
}

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
  /** 同步发送锁：防止 Enter 连击在 isGenerating 置位前重复提交。 */
  const sendLockRef = useRef(false);
  /** 历史拉取世代号：切换会话时递增，丢弃过期响应。 */
  const historyLoadGenRef = useRef(0);
  /** 上一轮已发出的用户原文（用于短时内同文防重）。 */
  const lastSentTextRef = useRef<{ text: string; at: number } | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const tokenRef = useRef<string | null>(token);
  const handleEventRef = useRef<(event: ChatStreamEvent) => void>(() => undefined);
  /** loadHistory 晚于 handleEvent 定义；经 ref 供 done/超时回填。 */
  const loadHistoryRef = useRef<() => Promise<void>>(async () => undefined);
  sessionIdRef.current = sessionId;
  tokenRef.current = token;

  /** 清除生成安全超时计时器。 */
  const clearGenerateTimeout = useCallback((): void => {
    if (generateTimeoutRef.current != null) {
      clearTimeout(generateTimeoutRef.current);
      generateTimeoutRef.current = null;
    }
  }, []);

  /**
   * 收尾「本实例拥有的」未完成生成——仅在本 hook 卸载且自带活跃流锚点时调用。
   *
   * <p>背景：安全超时计时器存在组件 ref 里、随卸载消失；但 {@code isGenerating} 存在
   * 全局 zustand store 里会存活。若承载本轮生成的组件（如 Copilot 面板切页/关闭）在
   * 收到 done 前被卸载，就会残留 {@code isGenerating=true} 且永无计时器 → 发送按钮
   * 永久转圈（2026-10 回归）。
   *
   * <p><b>精确归属</b>：只有「本实例 {@code streamingMessageIdRef} 指向 store 中仍存在的
   * streaming 消息」才算作本实例拥有本轮生成。这样多实例（Copilot 面板 + keep-alive
   * 问数页）共用同一 global store 时，未持有锚点的实例绝不会误清别人的进行中生成。
   *
   * @returns 是否执行了收尾
   */
  const finalizeOwnedGeneratingOnUnmount = useCallback((): boolean => {
    const streamingId = streamingMessageIdRef.current;
    if (!streamingId) return false;
    const store = useChatStore.getState();
    const owned = store.messages.find((m) => m.id === streamingId);
    if (!owned || owned.status !== 'streaming') return false;
    clearGenerateTimeout();
    streamingMessageIdRef.current = null;
    sendLockRef.current = false;
    const hasPayload = Boolean(owned.content.trim() || owned.surfaceId);
    store.updateMessageStatus(owned.id, hasPayload ? 'delivered' : 'error');
    store.setGenerating(false);
    return true;
  }, [clearGenerateTimeout]);

  /**
   * 将仍 streaming 的助手气泡收为 delivered，并钉住 surface（若有）。
   */
  const finalizeStreamingAssistant = useCallback(
    (
      streamingId: string | null,
      streamingMsg: ChatMessage | undefined,
      anchors?: { messageId?: string; sessionId?: string },
    ): void => {
      const store = useChatStore.getState();
      if (!streamingId) return;
      const updates: Partial<ChatMessage> = { status: 'delivered' };
      if (anchors?.messageId) updates.backendMessageId = anchors.messageId;
      if (anchors?.sessionId) updates.backendSessionId = anchors.sessionId;
      if (streamingMsg?.surfaceId) {
        updates.surfaceId = scopeSurfaceToMessage(streamingMsg.surfaceId, streamingId);
        useSurfaceStore.getState().setActive(null);
      }
      store.updateMessage(streamingId, updates);
      for (const m of store.messages) {
        if (m.role === 'assistant' && m.status === 'streaming' && m.id !== streamingId) {
          store.updateMessageStatus(m.id, 'delivered');
        }
      }
    },
    [],
  );

  /**
   * 启动生成安全超时（收不到 done/error 时强制解锁输入）。
   *
   * <p><b>每轮只 arm 一次</b>：delta / surface 事件不再无条件续期，避免慢速或零星帧
   * 把 140s 上限无限顺延、发送按钮永久转圈。若需真正重开计时，先调
   * {@link clearGenerateTimeout}（例如新一轮发送前）。
   */
  const armGenerateTimeout = useCallback((): void => {
    // 已有计时器 → 说明本轮已在计时，保持原有 start 时间，不重置上限。
    if (generateTimeoutRef.current != null) return;
    generateTimeoutRef.current = setTimeout(() => {
      void (async () => {
        generateTimeoutRef.current = null;
        const store = useChatStore.getState();
        if (!store.isGenerating) return;
        const streamingId = streamingMessageIdRef.current;
        const streamingMsg = streamingId
          ? store.messages.find((m) => m.id === streamingId)
          : undefined;

        // 正文/surface 已到但 done 丢失：按成功收尾，避免「有回复却显示失败」。
        if (hasVisibleAssistantPayload(streamingMsg)) {
          finalizeStreamingAssistant(streamingId, streamingMsg);
          streamingMessageIdRef.current = null;
          store.setGenerating(false);
          store.setError(null);
          sendLockRef.current = false;
          return;
        }

        // SSE 可能丢了全文 + done，后端却已落库：先解锁再回拉历史。
        streamingMessageIdRef.current = null;
        store.setGenerating(false);
        sendLockRef.current = false;
        await loadHistoryRef.current();
        const after = useChatStore.getState();
        const lastAssistant = [...after.messages]
          .reverse()
          .find((m) => m.role === 'assistant');
        if (hasVisibleAssistantPayload(lastAssistant)) {
          after.setError(null);
          return;
        }

        if (streamingId && after.messages.some((m) => m.id === streamingId)) {
          after.updateMessageStatus(streamingId, 'error');
        }
        after.setError(
          `等待回复超时（${Math.round(GENERATE_SAFETY_TIMEOUT_MS / 1000)}s）。可重新发送，或检查 Agent 网关 / SSE 连接。`,
        );
      })();
    }, GENERATE_SAFETY_TIMEOUT_MS);
  }, [clearGenerateTimeout, finalizeStreamingAssistant]);

  // 卸载兜底：仅当本实例仍持有活跃流锚点（= 本轮生成由本实例发起）时收尾，
  // 避免「收到 done 前组件被卸载 → isGenerating 永久残留 → 发送按钮一直转圈」。
  // 用 ref 存最新实现，卸载 effect 只跑一次，依赖为空。
  const finalizeOnUnmountRef = useRef<() => boolean>(() => false);
  finalizeOnUnmountRef.current = finalizeOwnedGeneratingOnUnmount;
  useEffect(() => {
    return () => {
      finalizeOnUnmountRef.current();
    };
  }, []);

  // ------------------------------------------------------------------ 事件处理

  /** 处理单条流式事件（写入 chat-store / surface-store）。 */
  const handleEvent = useCallback((event: ChatStreamEvent): void => {
    const store = useChatStore.getState();
    const sid = sessionIdRef.current ?? '';

    switch (event.type) {
      case 'stream': {
        const delta = event.content ?? '';
        if (!delta) break;
        // 文本增量到达：恢复 generating，保证「正在思考/流式」态与气泡联动
        if (!store.isGenerating) store.setGenerating(true);
        armGenerateTimeout();
        const targetId = resolveAssistantTargetId(store, streamingMessageIdRef, sid);
        const existing = store.messages.find((m) => m.id === targetId);
        store.updateMessage(targetId, {
          content: (existing?.content ?? '') + delta,
          status: 'streaming',
        });
        break;
      }

      case 'a2ui_surface': {
        // 写入 SurfaceStore，并把 surfaceId 挂到当前 assistant 气泡。
        // 不在此处解锁输入：正文常在 surface 之后以 stream 继续到达。
        if (!store.isGenerating) store.setGenerating(true);
        armGenerateTimeout();
        const surfaceId = processA2uiMessage(event) ?? event.surfaceId;
        if (surfaceId) {
          const targetId = resolveAssistantTargetId(store, streamingMessageIdRef, sid);
          store.updateMessage(targetId, { surfaceId, status: 'streaming' });
        }
        break;
      }

      case 'dispatch.trace': {
        const entries = event.trace?.entries ?? [];
        if (entries.length > 0) store.setDispatchTrace(entries);
        break;
      }

      case 'done': {
        const streamingId = streamingMessageIdRef.current;
        const streamingMsg = streamingId
          ? store.messages.find((m) => m.id === streamingId)
          : undefined;
        const visible = hasVisibleAssistantPayload(streamingMsg);
        // 空 done 且无落库锚点：多为中间态误发或正文尚未到达，继续等。
        // 若带 messageId，说明 Backend 已落库——常见于 SSE 丢了 text.delta，
        // 不可再忽略，否则会一直等到安全超时并误报「回复失败」。
        if (streamingId && streamingMsg && !visible && !event.messageId) {
          armGenerateTimeout();
          break;
        }
        const needHistoryReconcile = Boolean(
          streamingId && streamingMsg && !visible && event.messageId,
        );
        clearGenerateTimeout();
        finalizeStreamingAssistant(streamingId, streamingMsg, {
          messageId: event.messageId,
          sessionId: event.sessionId,
        });
        streamingMessageIdRef.current = null;
        if (event.tokenUsage) store.addTokenUsage(event.tokenUsage);
        store.setGenerating(false);
        sendLockRef.current = false;
        // 答完后刷新同文防重时钟：避免刚出结果又误触同一句再发一遍
        if (lastSentTextRef.current) {
          lastSentTextRef.current = { ...lastSentTextRef.current, at: Date.now() };
        }
        if (needHistoryReconcile) {
          void loadHistoryRef.current();
        }
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
        sendLockRef.current = false;
        break;
      }

      // ---- 旧协议兼容 ----
      case 'text.delta': {
        const delta = event.content ?? '';
        if (!delta) break;
        if (!store.isGenerating) store.setGenerating(true);
        armGenerateTimeout();
        const targetId = resolveAssistantTargetId(store, streamingMessageIdRef, sid);
        const existing = store.messages.find((m) => m.id === targetId);
        store.updateMessage(targetId, {
          content: (existing?.content ?? '') + delta,
          status: 'streaming',
        });
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
  }, [clearGenerateTimeout, armGenerateTimeout, finalizeStreamingAssistant]);

  handleEventRef.current = handleEvent;

  // 切换会话时重置流锚点与安全超时（连接 effect 不再清这些，避免误重连丢锚）
  useEffect(() => {
    // 会话切换：若本实例仍持有上一会话的「进行中生成」锚点，先收尾再丢锚。
    // 否则 ref 被清空后 isGenerating 将无人负责回收（卸载兜底也认不出归属），
    // 残留为 true → 发送按钮一直转圈。
    finalizeOwnedGeneratingOnUnmount();
    streamingMessageIdRef.current = null;
    clearGenerateTimeout();
  }, [sessionId, clearGenerateTimeout, finalizeOwnedGeneratingOnUnmount]);

  // ------------------------------------------------------------------ 会话

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
    const rawRecord = raw as SessionMessage & {
      sessionId?: string;
      text?: unknown;
      created_at?: string;
    };
    const metadata = raw.metadata ?? {};
    const role = normalizeChatRole(raw.role);
    const id = String(raw.id || generateClientId('hist'));
    const sessionId = String(raw.session_id || rawRecord.sessionId || '');
    const msg: ChatMessage = {
      id,
      sessionId,
      role,
      content: coerceChatContent(raw.content ?? rawRecord.text),
      status: 'delivered',
      timestamp: String(raw.timestamp || rawRecord.created_at || ''),
      // 历史回放：消息主键即后端 UUID，供评价锚点（否则切会话后评价条失效）
      backendMessageId: role === 'assistant' ? id : undefined,
      backendSessionId: sessionId || undefined,
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
    const fb = metadata.feedback;
    if (fb && typeof fb === 'object' && !Array.isArray(fb)) {
      const rating = (fb as { rating?: unknown }).rating;
      if (rating === 'up' || rating === 'down') {
        const comment = (fb as { comment?: unknown }).comment;
        msg.feedback = {
          rating,
          comment: typeof comment === 'string' ? comment : null,
        };
      }
    }
    return msg;
  }, []);

  /**
   * P0-2 拉取历史并渲染（复用 #29 `GET /api/v1/agent-ops/sessions/{id}/messages`）。
   *
   * <p>三态：loading → loaded（setMessages 渲染） / error（404 / 失败降级空会话不阻塞）。
   * await 返回后校验发起时的 sid 仍为当前会话，否则丢弃结果（防新建/切换串会话）。
   */
  const loadHistory = useCallback(async (): Promise<void> => {
    const requestedSid = sessionIdRef.current ?? useChatStore.getState().sessionId;
    if (!requestedSid) return;
    const store = useChatStore.getState();
    // 用世代号打断旧请求：切换会话时不得被「loading 中」挡住新拉取
    const reqGen = (historyLoadGenRef.current += 1);
    store.setHistoryState('loading');
    const isStale = (): boolean =>
      reqGen !== historyLoadGenRef.current ||
      (sessionIdRef.current ?? useChatStore.getState().sessionId) !== requestedSid;
    try {
      const res = await fetch(
        `/api/v1/agent-ops/sessions/${encodeURIComponent(requestedSid)}/messages?page=1&page_size=200`,
        {
          headers: {
            Authorization: tokenRef.current ? `Bearer ${tokenRef.current}` : '',
          },
        },
      );
      if (isStale()) return;
      if (!res.ok) {
        // 404（sid 未落库）或任何失败 → 降级空会话，不抛错阻塞主流程
        store.setHistoryState('error');
        return;
      }
      const payload = (await res.json()) as {
        code: number;
        data?: SessionMessage[] | { items?: SessionMessage[] };
      };
      if (isStale()) return;
      const rawList: SessionMessage[] | undefined = Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.data?.items)
          ? payload.data.items
          : undefined;
      if (payload.code !== 0 || !rawList) {
        store.setHistoryState('error');
        return;
      }
      const history = rawList.map(mapSessionMessage);
      if (isStale()) return;
      // 生成中勿回填：否则会冲掉进行中的空助手气泡并表现为「忽然结束」。
      if (useChatStore.getState().isGenerating || streamingMessageIdRef.current) {
        store.setHistoryState('loaded');
        return;
      }
      store.setMessages(history);
      store.setHistoryState('loaded');
    } catch {
      if (isStale()) return;
      store.setHistoryState('error');
    }
  }, [mapSessionMessage]);

  loadHistoryRef.current = loadHistory;

  /**
   * 确保存在会话 id（本地生成 + 持久化；Gateway 接受客户端 sessionId）。
   *
   * @param preferredSessionId 传入时直接复用该会话（"切换会话"场景）；
   *                           不传则优先复用 localStorage 记忆，否则生成本地新会话。
   * @param options.forceNew 为 true 时忽略已有 session / localStorage，强制生成新 sid（「新建会话」）。
   */
  const ensureSession = useCallback(async (
    preferredSessionId?: string,
    options?: { forceNew?: boolean },
  ): Promise<string> => {
    const forceNew = options?.forceNew === true;
    const existing = useChatStore.getState().sessionId;

    // 已在目标会话：若消息为空则补拉历史（避免「切过去但列表空白」）
    if (!forceNew && existing && (!preferredSessionId || preferredSessionId === existing)) {
      const st = useChatStore.getState();
      if (st.messages.length === 0 && st.historyState !== 'loading') {
        void loadHistory();
      }
      return existing;
    }

    useChatStore.getState().setSessionState('creating');
    let sid: string | null = null;
    if (forceNew) {
      sid = generateClientId('web');
    } else if (preferredSessionId) {
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

    // 切到其它会话时清掉旧消息 / surface，避免串会话残影
    if (existing && sid && existing !== sid) {
      useChatStore.getState().clearMessages();
      useSurfaceStore.getState().clear();
    }

    // 同 tick 内同步 ref，避免尚未 re-render 时 loadHistory / send 仍读到旧 sid
    sessionIdRef.current = sid;
    useChatStore.getState().setSessionId(sid);
    useChatStore.getState().setAgentId(agentIdOption || null);
    useChatStore.getState().setSessionState('ready');
    // 记忆最近会话，便于下次打开续接（切换会话时也及时落盘）
    persistSession(sid);
    if (forceNew) {
      // 新建空会话：不拉历史，保持消息区为空直至用户发言
      useChatStore.getState().setHistoryState('idle');
    } else {
      // P0-2：续接/切换会话时拉取历史（未落库 404 降级空会话不阻塞）
      void loadHistory();
    }
    return sid;
  }, [agentIdOption, loadHistory, persistSession]);

  // ------------------------------------------------------------------ 发送

  const sendInbound = useCallback((message: InboundMessage): boolean => {
    const ws = wsRef.current;
    if (!ws || !ws.isOpen()) {
      useChatStore.getState().setError('连接未就绪，无法发送消息');
      return false;
    }
    return ws.send(message);
  }, []);

  /**
   * 切换到指定会话（会话列表点击）。
   *
   * <p>不经 sessionId=null 中间态（避免 SSE/WS 抖动与历史拉取竞态）；
   * 清消息 / surface 后强制 loadHistory。同 sid 再点也会重拉。
   */
  const switchSession = useCallback(
    async (nextSessionId: string): Promise<void> => {
      const nextSid = nextSessionId.trim();
      if (!nextSid) return;

      const prevSid = sessionIdRef.current;
      if (prevSid && prevSid !== nextSid) {
        // 尽力通知 Gateway 关闭旧会话；失败不阻断切换
        try {
          sendInbound({
            type: 'session.close',
            sessionId: prevSid,
            timestamp: new Date().toISOString(),
          });
        } catch {
          /* ignore */
        }
      }

      clearGenerateTimeout();
      streamingMessageIdRef.current = null;
      sendLockRef.current = false;
      historyLoadGenRef.current += 1;

      useChatStore.getState().clearMessages();
      useSurfaceStore.getState().clear();
      useChatStore.getState().setError(null);
      useChatStore.getState().setDispatchTrace([]);
      useChatStore.getState().setHistoryState('idle');

      sessionIdRef.current = nextSid;
      useChatStore.getState().setSessionId(nextSid);
      useChatStore.getState().setAgentId(agentIdOption || null);
      useChatStore.getState().setSessionState('ready');
      persistSession(nextSid);

      await loadHistory();
    },
    [agentIdOption, clearGenerateTimeout, loadHistory, persistSession, sendInbound],
  );

  const sendMessage = useCallback(
    (content: string, attachments?: Attachment[]): void => {
      const text = content.trim();
      if (!text && (!attachments || attachments.length === 0)) return;
      const sid = sessionIdRef.current;
      if (!sid) return;
      const store = useChatStore.getState();

      // 同步防重：生成中 / 锁未释放 / 短时内同文（含刚答完又误触同题）
      if (store.isGenerating || sendLockRef.current) return;
      const now = Date.now();
      const last = lastSentTextRef.current;
      if (last && last.text === text && now - last.at < 5_000) return;
      sendLockRef.current = true;
      lastSentTextRef.current = { text, at: now };

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
        sendLockRef.current = false;
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

    // SSE 接收（经 ref 转发，避免 handleEvent 身份变化导致重连丢流）
    const sse = subscribeChatStream({
      sessionId: activeSid,
      token: activeToken,
      onEvent: (event) => handleEventRef.current(event),
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
      // 仅拆连接；生成态的清理由「拥有者卸载」effect 精确负责（见下），
      // 绝不在此处按全局 isGenerating 猜测——多实例共用 global store 会误杀他人生成。
      sse.abort();
      ws.close();
      sseRef.current = null;
      wsRef.current = null;
    };
  }, [autoConnect, sessionId, token]);

  const closeSession = useCallback((): void => {
    const sid = sessionIdRef.current;
    if (sid) {
      sendInbound({ type: 'session.close', sessionId: sid, timestamp: new Date().toISOString() });
    }
    clearGenerateTimeout();
    streamingMessageIdRef.current = null;
    historyLoadGenRef.current += 1;
    persistSession(null);
    useChatStore.getState().clearMessages();
    // 同 tick 同步 ref，避免后续 ensureSession/loadHistory 仍读旧 sid
    sessionIdRef.current = null;
    useChatStore.getState().setSessionId(null);
    useChatStore.getState().setSessionState('none');
    // 重置历史态，避免 in-flight loadHistory 的 loading 挡住新会话拉取，或晚到回填污染
    useChatStore.getState().setHistoryState('idle');
    useChatStore.getState().setError(null);
    // QA 建议 2：关闭会话时清空 A2UI Surface，避免旧卡片残留
    useSurfaceStore.getState().clear();
    // surface 清理
    useChatStore.getState().setDispatchTrace([]);
  }, [sendInbound, persistSession, clearGenerateTimeout]);

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
      onEvent: (event) => handleEventRef.current(event),
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
  }, []);

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
    switchSession,
    closeSession,
    reconnect,
  };
}

export default useChat;
