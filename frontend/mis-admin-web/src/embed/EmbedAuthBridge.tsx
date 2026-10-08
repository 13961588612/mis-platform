/**
 * EmbedAuthBridge — 外部宿主 iframe 鉴权桥（T07'，从 旧版独立前端 迁移扩展）。
 *
 * <p>协议（01-architecture.md §5.2，继承 + 扩展）：
 * - iframe 加载后发 `AUTH_READY` 通知父页
 * - 父页回 `AUTH_TOKEN`（外部系统先调 BFF POST /api/v1/embed/identity/exchange 换的 MIS JWT）
 * - 父页回 `PAGE_CONTEXT`（hostId / embedMode / contextRef / sessionHint 扩展）
 * - 临期发 `AUTH_TOKEN_REQUEST`；父页再推 `AUTH_TOKEN` 热替换（session 不变）
 *
 * <p>安全（§5.3）：
 * - 只接受 `VITE_PARENT_ORIGINS` 白名单内 origin（空白名单 = 拒绝一切）
 * - token 结构/有效期不可验 → 明确拒绝 + 告警日志（Gateway 才是验签权威）
 * - 父页超时无响应 → timeout / 续期失败错误态
 */

import { useEffect, useRef } from 'react';
import { isAllowedParentOrigin } from './embed-env';
import { isValidJwtShape } from './embed-auth';
import { sanitizeHostId } from './embed-session';
import { useEmbedStore, type EmbedPageContext } from './embedStore';

/** 等待父页首个 AUTH_TOKEN 的超时阈值（ms）。 */
export const EMBED_AUTH_TIMEOUT_MS = 10_000;

/** 提前多久向父页请求续期（ms）。 */
export const EMBED_TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;

/** 等待父页响应 AUTH_TOKEN_REQUEST 的超时（ms）。 */
export const EMBED_TOKEN_REFRESH_TIMEOUT_MS = 15_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** 解析 PAGE_CONTEXT（白名单已校验；字段逐项校验防脏数据）。 */
function parsePageContext(raw: unknown): EmbedPageContext | null {
  if (!isPlainObject(raw)) return null;
  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter((p): p is string => typeof p === 'string')
    : undefined;
  return {
    hostId: sanitizeHostId(typeof raw.hostId === 'string' ? raw.hostId : ''),
    embedMode: raw.embedMode === 'standalone' ? 'standalone' : 'iframe',
    contextRef: isPlainObject(raw.contextRef) ? raw.contextRef : null,
    sessionHint: typeof raw.sessionHint === 'string' && raw.sessionHint ? raw.sessionHint : null,
    route: typeof raw.route === 'string' ? raw.route : '',
    module: typeof raw.module === 'string' ? raw.module : '',
    title: typeof raw.title === 'string' ? raw.title : undefined,
    permissions,
    mappedUserId: typeof raw.mappedUserId === 'string' ? raw.mappedUserId : undefined,
  };
}

function requestTokenRefresh(parentOrigin: string): void {
  try {
    window.parent?.postMessage(
      { type: 'AUTH_TOKEN_REQUEST', reason: 'expiring' },
      parentOrigin,
    );
  } catch {
    /* cross-origin 受限时忽略 */
  }
}

export function EmbedAuthBridge(): null {
  const setAuthenticated = useEmbedStore((s) => s.setAuthenticated);
  const refreshToken = useEmbedStore((s) => s.refreshToken);
  const setPageContext = useEmbedStore((s) => s.setPageContext);
  const setRejected = useEmbedStore((s) => s.setRejected);
  const setTimedOut = useEmbedStore((s) => s.setTimedOut);
  const setRefreshPending = useEmbedStore((s) => s.setRefreshPending);

  const refreshTimerRef = useRef<number | null>(null);
  const refreshWaitRef = useRef<number | null>(null);

  useEffect(() => {
    const clearRefreshTimers = (): void => {
      if (refreshTimerRef.current != null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (refreshWaitRef.current != null) {
        window.clearTimeout(refreshWaitRef.current);
        refreshWaitRef.current = null;
      }
    };

    const scheduleRefresh = (expiresAt: number | null): void => {
      clearRefreshTimers();
      if (expiresAt == null || !Number.isFinite(expiresAt)) return;

      const fireAt = expiresAt - EMBED_TOKEN_REFRESH_LEAD_MS;
      const delay = Math.max(0, fireAt - Date.now());

      refreshTimerRef.current = window.setTimeout(() => {
        const { authState, parentOrigin } = useEmbedStore.getState();
        if (authState !== 'authenticated' || !parentOrigin) return;

        setRefreshPending(true);
        requestTokenRefresh(parentOrigin);

        refreshWaitRef.current = window.setTimeout(() => {
          if (useEmbedStore.getState().refreshPending) {
            setRejected('令牌续期超时，请重新登录宿主系统');
          }
        }, EMBED_TOKEN_REFRESH_TIMEOUT_MS);
      }, delay);
    };

    const handler = (event: MessageEvent): void => {
      const data = event.data as { type?: unknown; token?: unknown; context?: unknown } | null;
      if (data == null || typeof data.type !== 'string') return;
      if (data.type !== 'AUTH_TOKEN' && data.type !== 'PAGE_CONTEXT') return;

      if (!isAllowedParentOrigin(event.origin)) {
        console.warn('[EmbedAuthBridge] 拒绝非白名单父域消息:', event.origin, data.type);
        if (data.type === 'AUTH_TOKEN') {
          setRejected(`父域 ${event.origin} 不在白名单，AUTH_TOKEN 已拒绝`);
        }
        return;
      }

      if (data.type === 'AUTH_TOKEN') {
        if (typeof data.token !== 'string' || data.token.length === 0) {
          setRejected('父页返回的 AUTH_TOKEN 为空');
          return;
        }
        if (!isValidJwtShape(data.token)) {
          console.warn('[EmbedAuthBridge] AUTH_TOKEN 结构/有效期校验失败（不可验签，拒绝）');
          setRejected('AUTH_TOKEN 无效或已过期');
          return;
        }

        const prev = useEmbedStore.getState();
        if (prev.authState === 'authenticated' && prev.parentOrigin === event.origin) {
          // 续期热替换：保持 session，只换 token
          refreshToken(data.token);
        } else {
          setAuthenticated(data.token, event.origin);
        }
        const expiresAt = useEmbedStore.getState().tokenExpiresAt;
        scheduleRefresh(expiresAt);
        return;
      }

      if (data.type === 'PAGE_CONTEXT') {
        const ctx = parsePageContext(data.context);
        if (ctx) setPageContext(ctx);
      }
    };

    window.addEventListener('message', handler);
    // 非敏感：告知父页已就绪，可推令牌
    try {
      window.parent?.postMessage({ type: 'AUTH_READY' }, '*');
    } catch {
      /* cross-origin 受限时忽略 */
    }

    const timeout = window.setTimeout(() => {
      if (useEmbedStore.getState().authState === 'waiting') {
        setTimedOut();
      }
    }, EMBED_AUTH_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', handler);
      window.clearTimeout(timeout);
      clearRefreshTimers();
    };
    // 依赖均为 zustand 稳定 action，仅挂载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default EmbedAuthBridge;
