/**
 * EmbedAuthBridge — 外部宿主 iframe 鉴权桥（T07' + 致远 ticket SSO）。
 *
 * <p>协议分支：
 * 1. URL 含 {@code ticket} + {@code hostId} → 同源 ticket-exchange（不依赖 postMessage）
 * 2. 否则走宿主 postMessage：AUTH_READY → AUTH_TOKEN / PAGE_CONTEXT；临期 AUTH_TOKEN_REQUEST
 *
 * <p>安全：postMessage 只接受 VITE_PARENT_ORIGINS；ticket 兑换成功后立即从 URL 移除。
 */

import { useEffect, useRef } from 'react';
import { isAllowedParentOrigin, isEmbeddedFrame } from './embed-env';
import { isValidJwtShape } from './embed-auth';
import { hydrateEmbedUser } from './embed-hydrate-user';
import { resolveHostIdFromLocation, sanitizeHostId } from './embed-session';
import {
  exchangeEmbedTicket,
  stripTicketFromUrl,
  type TicketExchangeError,
} from './embed-ticket-exchange';
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

function readTicketParams(): { hostId: string; ticket: string } | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const ticket = (params.get('ticket') || '').trim();
    // hostId：路径 `/embed/{hostId}/chat` 优先，兼容旧 query `?hostId=`
    const hostId = resolveHostIdFromLocation();
    if (!ticket || !hostId) return null;
    return { hostId, ticket };
  } catch {
    return null;
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

    const scheduleTicketExpiry = (expiresAt: number | null): void => {
      clearRefreshTimers();
      if (expiresAt == null || !Number.isFinite(expiresAt)) return;
      const delay = Math.max(0, expiresAt - Date.now());
      refreshTimerRef.current = window.setTimeout(() => {
        console.warn('[EmbedTicket] JWT expired — ask user to reopen from OA');
        setRejected('会话已过期，请从致远 OA（业务系统）重新打开');
      }, delay);
    };

    const scheduleParentRefresh = (expiresAt: number | null): void => {
      clearRefreshTimers();
      if (expiresAt == null || !Number.isFinite(expiresAt)) return;

      const fireAt = expiresAt - EMBED_TOKEN_REFRESH_LEAD_MS;
      const delay = Math.max(0, fireAt - Date.now());

      refreshTimerRef.current = window.setTimeout(() => {
        const { authState, parentOrigin, authMode } = useEmbedStore.getState();
        if (authState !== 'authenticated' || authMode === 'ticket') return;
        if (!parentOrigin) return;

        setRefreshPending(true);
        requestTokenRefresh(parentOrigin);

        refreshWaitRef.current = window.setTimeout(() => {
          if (useEmbedStore.getState().refreshPending) {
            setRejected('令牌续期超时，请重新登录宿主系统');
          }
        }, EMBED_TOKEN_REFRESH_TIMEOUT_MS);
      }, delay);
    };

    const ticketParams = readTicketParams();
    if (ticketParams) {
      let cancelled = false;
      console.info('[EmbedAuthBridge] ticket mode detected', { hostId: ticketParams.hostId });
      void (async () => {
        try {
          const data = await exchangeEmbedTicket(ticketParams);
          if (cancelled) return;
          if (!isValidJwtShape(data.misJwt)) {
            setRejected('ticket 兑换返回的令牌无效');
            return;
          }
          stripTicketFromUrl();
          setAuthenticated(data.misJwt, window.location.origin, 'ticket');
          setPageContext({
            hostId: ticketParams.hostId,
            embedMode: isEmbeddedFrame() ? 'iframe' : 'standalone',
            permissions: data.permissions,
            mappedUserId: data.mappedUserId,
          });
          // MIS JWT 已落盘后再拉 /auth/me（展示用；失败不阻断对话）
          void hydrateEmbedUser(data.misJwt);
          scheduleTicketExpiry(useEmbedStore.getState().tokenExpiresAt);
        } catch (err) {
          if (cancelled) return;
          const e = err as TicketExchangeError;
          const msg =
            typeof e?.message === 'string' && e.message
              ? e.message
              : 'ticket 登录失败，请从业务系统重新打开';
          console.warn('[EmbedAuthBridge] ticket exchange error', e);
          setRejected(msg);
        }
      })();
      return () => {
        cancelled = true;
        clearRefreshTimers();
      };
    }

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
          refreshToken(data.token);
        } else {
          setAuthenticated(data.token, event.origin, 'postMessage');
        }
        void hydrateEmbedUser(data.token);
        const expiresAt = useEmbedStore.getState().tokenExpiresAt;
        scheduleParentRefresh(expiresAt);
        return;
      }

      if (data.type === 'PAGE_CONTEXT') {
        const ctx = parsePageContext(data.context);
        if (ctx) setPageContext(ctx);
      }
    };

    window.addEventListener('message', handler);
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
