/**
 * chat-core WebSocket 发送客户端（T06'）。
 *
 * <p>接收走 SSE（见 sse-client.ts），发送走 Gateway `/ws/chat`（原 H5 协议，
 * 见 gateway/src/server.ts）——SSE 单向推送无法承载上行消息，WS 保留为发送通道。
 * 认证：MIS RS256 JWT 经 query token 注入（Gateway auth 中间件支持 query token）。
 */

import type { InboundMessage } from './types';

/** WebSocket 连接状态。 */
export type WsClientState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed';

export interface WsClientOptions {
  sessionId: string;
  token: string;
  /** 每次建连读取最新 token（避免重连仍带过期 JWT）。 */
  getToken?: () => string | null | undefined;
  /**
   * 自动重连前调用（可 refresh）；返回 false 则停止重连并进入 error。
   * 用于会话中途 token 过期时避免「重连中」空转半分钟。
   */
  onBeforeReconnect?: () => Promise<boolean>;
  onStateChange?: (state: WsClientState) => void;
  onError?: (message: string) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000;

/** 构建 /ws/chat URL（token 经 query，与 旧版独立前端 utils/api.ts 一致）。 */
export function buildChatWsUrl(sessionId: string, token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ sessionId });
  if (token) {
    params.set('token', token);
  }
  return `${protocol}//${window.location.host}/ws/chat?${params.toString()}`;
}

/**
 * 轻量 WS 发送客户端：连接 / 重连 / 心跳 / 发送。
 * 不负责接收事件（接收统一走 SSE，避免双通道事件重复消费）。
 */
export class ChatWsClient {
  private ws: WebSocket | null = null;
  private state: WsClientState = 'idle';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  private readonly sessionId: string;
  private readonly initialToken: string;
  private readonly getToken?: () => string | null | undefined;
  private readonly onBeforeReconnect?: () => Promise<boolean>;
  private readonly onStateChange?: (state: WsClientState) => void;
  private readonly onError?: (message: string) => void;

  constructor(options: WsClientOptions) {
    this.sessionId = options.sessionId;
    this.initialToken = options.token;
    this.getToken = options.getToken;
    this.onBeforeReconnect = options.onBeforeReconnect;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
  }

  getState(): WsClientState {
    return this.state;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  private setState(next: WsClientState): void {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange?.(next);
  }

  private resolveToken(): string {
    const latest = this.getToken?.();
    if (typeof latest === 'string' && latest.length > 0) return latest;
    return this.initialToken;
  }

  private openSocket(): void {
    if (this.intentionalClose) return;
    this.setState('connecting');
    const ws = new WebSocket(buildChatWsUrl(this.sessionId, this.resolveToken()));
    this.ws = ws;

    ws.onopen = () => {
      if (this.intentionalClose || this.ws !== ws) {
        ws.close();
        return;
      }
      this.reconnectAttempts = 0;
      this.setState('connected');
      this.startHeartbeat(ws);
    };

    ws.onerror = () => {
      if (this.intentionalClose || this.ws !== ws) return;
      this.setState('error');
    };

    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      this.stopHeartbeat();
      if (this.intentionalClose) {
        this.setState('closed');
        return;
      }
      this.setState('reconnecting');
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this.setState('error');
        this.onError?.('WebSocket 连接失败，请刷新重试');
        return;
      }
      this.reconnectAttempts += 1;
      const delay = RECONNECT_BASE_DELAY * 2 ** (this.reconnectAttempts - 1);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.openAfterRefresh();
      }, delay);
    };
  }

  private async openAfterRefresh(): Promise<void> {
    if (this.intentionalClose) return;
    if (this.onBeforeReconnect) {
      try {
        const ok = await this.onBeforeReconnect();
        if (!ok) {
          this.setState('error');
          this.onError?.('登录已过期，请重新登录');
          return;
        }
      } catch {
        this.setState('error');
        this.onError?.('登录刷新失败，请重新登录');
        return;
      }
    }
    if (this.intentionalClose) return;
    this.openSocket();
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
      }
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 发送入站消息；未连接时返回 false。 */
  send(message: InboundMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(message));
    return true;
  }

  /** 主动关闭（不重连）。 */
  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }
    this.setState('closed');
  }
}
