/**
 * EmbedAuthBridge 鉴权桥组件测试（QA 严过关，T07' 独立验证，jsdom + RTL）。
 *
 * <p>口径：01-architecture.md §5.2/§5.3 —
 * - 挂载发 AUTH_READY；父页回 AUTH_TOKEN / PAGE_CONTEXT（hostId/embedMode/contextRef/sessionHint）
 * - 非白名单 origin → rejected（fail-closed）；空白名单 = 拒绝一切
 * - token 结构/有效期不可验 → rejected（浏览器端防呆，Gateway 权威）
 * - 父页超时无响应 → timeout；PAGE_CONTEXT permissions 同步 auth-store（UX 门控）
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { EmbedAuthBridge, EMBED_AUTH_TIMEOUT_MS } from './EmbedAuthBridge';
import { useEmbedStore } from './embedStore';
import { useAuthStore } from '@/stores/auth-store';

const PARENT_ORIGIN = 'https://parent.example.com';
const EVIL_ORIGIN = 'https://evil.example.com';

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: Record<string, unknown>): string =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.ZmFrZS1zaWduYXR1cmU`;
}

const VALID_TOKEN = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

function post(data: Record<string, unknown>, origin: string): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  });
}

describe('EmbedAuthBridge 鉴权态机', () => {
  let originalPostMessage: typeof window.postMessage;

  beforeEach(() => {
    vi.stubEnv('VITE_PARENT_ORIGINS', PARENT_ORIGIN);
    originalPostMessage = window.postMessage;
    useEmbedStore.getState().reset();
    useAuthStore.getState().clearSession();
  });

  afterEach(() => {
    window.postMessage = originalPostMessage;
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('挂载即发 AUTH_READY（通知父页可推令牌）', () => {
    const spy = vi.fn();
    window.postMessage = spy;
    render(<EmbedAuthBridge />);
    expect(spy).toHaveBeenCalledWith({ type: 'AUTH_READY' }, '*');
  });

  it('合法 AUTH_TOKEN（白名单 origin）→ authenticated + auth-store accessToken 同步', () => {
    render(<EmbedAuthBridge />);
    post({ type: 'AUTH_TOKEN', token: VALID_TOKEN }, PARENT_ORIGIN);
    expect(useEmbedStore.getState().authState).toBe('authenticated');
    expect(useEmbedStore.getState().parentOrigin).toBe(PARENT_ORIGIN);
    expect(useAuthStore.getState().accessToken).toBe(VALID_TOKEN);
  });

  it('非白名单 origin 的 AUTH_TOKEN → rejected（fail-closed）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<EmbedAuthBridge />);
    post({ type: 'AUTH_TOKEN', token: VALID_TOKEN }, EVIL_ORIGIN);
    expect(useEmbedStore.getState().authState).toBe('rejected');
    expect(useEmbedStore.getState().authError).toContain('不在白名单');
    expect(useAuthStore.getState().accessToken).toBeNull();
    warn.mockRestore();
  });

  it('空白名单 = 拒绝一切（连白名单 origin 也拒）', () => {
    vi.unstubAllEnvs(); // VITE_PARENT_ORIGINS 未配置 → 空白名单
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<EmbedAuthBridge />);
    post({ type: 'AUTH_TOKEN', token: VALID_TOKEN }, PARENT_ORIGIN);
    expect(useEmbedStore.getState().authState).toBe('rejected');
  });

  it('AUTH_TOKEN 结构非法（不可验签）→ rejected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<EmbedAuthBridge />);
    post({ type: 'AUTH_TOKEN', token: 'not-a-jwt' }, PARENT_ORIGIN);
    expect(useEmbedStore.getState().authState).toBe('rejected');
    expect(useEmbedStore.getState().authError).toContain('无效或已过期');
    warn.mockRestore();
  });

  it('AUTH_TOKEN 已过期 → rejected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<EmbedAuthBridge />);
    const expired = makeJwt({ exp: Math.floor(Date.now() / 1000) - 100 });
    post({ type: 'AUTH_TOKEN', token: expired }, PARENT_ORIGIN);
    expect(useEmbedStore.getState().authState).toBe('rejected');
    warn.mockRestore();
  });

  it('父页超时无 AUTH_TOKEN → timeout', () => {
    vi.useFakeTimers();
    render(<EmbedAuthBridge />);
    act(() => {
      vi.advanceTimersByTime(EMBED_AUTH_TIMEOUT_MS + 1);
    });
    expect(useEmbedStore.getState().authState).toBe('timeout');
    expect(useEmbedStore.getState().authError).toContain('超时');
  });

  it('PAGE_CONTEXT 解析：hostId/sessionHint/contextRef/permissions（permissions 同步 auth-store）', () => {
    render(<EmbedAuthBridge />);
    post(
      {
        type: 'PAGE_CONTEXT',
        context: {
          hostId: 'crm-web',
          embedMode: 'iframe',
          sessionHint: 'sess-abc-123',
          contextRef: { orgId: '1001', storeId: '88' },
          permissions: ['agent:chat:use'],
          mappedUserId: 'u_10086',
        },
      },
      PARENT_ORIGIN,
    );
    const ctx = useEmbedStore.getState().pageContext;
    expect(ctx?.hostId).toBe('crm-web');
    expect(ctx?.embedMode).toBe('iframe');
    expect(ctx?.sessionHint).toBe('sess-abc-123');
    expect(ctx?.contextRef).toEqual({ orgId: '1001', storeId: '88' });
    expect(ctx?.permissions).toEqual(['agent:chat:use']);
    expect(useAuthStore.getState().permissions).toContain('agent:chat:use');
  });

  it('PAGE_CONTEXT 脏数据清洗：hostId 注入字符被剔除', () => {
    render(<EmbedAuthBridge />);
    post(
      { type: 'PAGE_CONTEXT', context: { hostId: 'crm" onmouseover="x()"', embedMode: 'weird' } },
      PARENT_ORIGIN,
    );
    const ctx = useEmbedStore.getState().pageContext;
    expect(ctx?.hostId).toBe('crmonmouseoverx');
    expect(ctx?.embedMode).toBe('iframe'); // 非 standalone → 回退 iframe
  });
});
