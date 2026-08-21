/**
 * chat-core SSE 客户端（T06'）。
 *
 * <p>底层复用 `@microsoft/fetch-event-source`（POST/GET + Last-Event-ID + 自动重连 + 自定义 headers），
 * 订阅 Gateway H5 SSE 端点 `/api/events/stream?sessionId={sid}`（见 gateway/src/server.ts），
 * 事件载荷为 `data: { type: 'agent_event', event, timestamp }` envelope 或直接流式事件。
 *
 * <p>认证：MIS RS256 JWT 经 `Authorization: Bearer` 注入（Gateway auth 中间件同时接受
 * header 与 query token 两种形态）。
 */

import { fetchEventSource, type EventSourceMessage } from '@microsoft/fetch-event-source';
import { parseStreamLine } from './event-adapter';
import type { ChatStreamEvent, RawStreamLine } from './types';

/** SSE 订阅控制器。 */
export interface ChatSseController {
  /** 主动断开（不触发自动重连）。 */
  abort: () => void;
}

export interface ChatSseOptions {
  sessionId: string;
  token: string;
  /** 事件回调（已归一化为 ChatStreamEvent）。 */
  onEvent: (event: ChatStreamEvent) => void;
  /** 连接状态回调（可选）。 */
  onStateChange?: (state: 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed') => void;
  /** 打开即重连（后台 Tab 不挂起），默认 true。 */
  openWhenHidden?: boolean;
}

/** 构建 SSE 订阅 URL（相对路径，走 vite proxy → mis-gateway:8080）。 */
export function buildChatStreamUrl(sessionId: string): string {
  const params = new URLSearchParams({ sessionId });
  return `/api/events/stream?${params.toString()}`;
}

/**
 * 订阅指定会话的事件流。
 *
 * <p>重连策略：fetch-event-source 在 `onerror` 抛出错误后自动按指数退避重连；
 * 调用方通过返回的 controller.abort() 终止。会话已切换（sessionId 变化）时由
 * useChat 负责 abort 旧流并订阅新流。
 */
export function subscribeChatStream(options: ChatSseOptions): ChatSseController {
  const controller = new AbortController();
  let state: 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed' = 'connecting';
  let active = true;

  const setState = (next: typeof state): void => {
    if (!active || state === next) return;
    state = next;
    options.onStateChange?.(next);
  };

  const url = buildChatStreamUrl(options.sessionId);

  void fetchEventSource(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'text/event-stream',
    },
    signal: controller.signal,
    openWhenHidden: options.openWhenHidden ?? true,
    async onopen(_response) {
      if (!active) return;
      if (_response.ok) {
        setState('connected');
      } else if (_response.status === 401) {
        // 认证失败不重试，交回调用方处理
        controller.abort();
      } else {
        // 其它 HTTP 错误：抛错触发 fetch-event-source 自动重连
        throw new Error(`SSE open failed: ${_response.status}`);
      }
    },
    onmessage(message: EventSourceMessage) {
      if (!active) return;
      if (message.event === 'connected' || message.event === 'comment') return;
      const line = parseRawLine(message.data);
      if (line == null) return;
      options.onEvent(line);
    },
    onclose() {
      if (!active) return;
      setState('closed');
    },
    onerror(_error) {
      // 连接中断：置 reconnecting，返回 retry 延迟（ms）让 fetch-event-source 自动重连；
      // 主动 abort 时不再重连。
      if (!active || controller.signal.aborted) {
        return undefined;
      }
      setState('reconnecting');
      return 2000;
    },
  });

  return {
    abort: () => {
      active = false;
      controller.abort();
      setState('closed');
    },
  };
}

/** 解析一条 SSE `data:` 载荷为 ChatStreamEvent（含 envelope 兼容）。 */
function parseRawLine(data: string): ChatStreamEvent | null {
  if (!data || data.trim().length === 0) return null;
  let parsed: RawStreamLine;
  try {
    parsed = JSON.parse(data) as RawStreamLine;
  } catch {
    return null;
  }
  return parseStreamLine(parsed);
}
