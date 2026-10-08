/**
 * embed 宿主协议冒烟（无真实 Gateway）：握手 → TOKEN → PAGE_CONTEXT → A2UI 事件桥回写。
 * 覆盖 docs/integration/embed-copilot.md 与 public/embed-host-demo.html 契约。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { EmbedAuthBridge } from './EmbedAuthBridge';
import { useEmbedStore } from './embedStore';
import { useAuthStore } from '@/stores/auth-store';
import { onA2uiEventResult, postA2uiEvent } from './embed-bridge';

const PARENT_ORIGIN = 'https://parent.example.com';

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: Record<string, unknown>): string =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.ZmFrZS1zaWduYXR1cmU`;
}

function post(data: Record<string, unknown>, origin: string): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

describe('embed 协议冒烟：握手 + 事件桥', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PARENT_ORIGINS', PARENT_ORIGIN);
    useEmbedStore.getState().reset();
    useAuthStore.getState().clearSession();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('宿主完整握手后可透出 A2UI_EVENT 并收回 RESULT', async () => {
    const readySpy = vi.fn();
    window.postMessage = readySpy;

    render(<EmbedAuthBridge />);
    expect(readySpy).toHaveBeenCalledWith({ type: 'AUTH_READY' }, '*');

    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, sub: '1' });
    post({ type: 'AUTH_TOKEN', token }, PARENT_ORIGIN);
    post(
      {
        type: 'PAGE_CONTEXT',
        context: {
          hostId: 'embed-demo',
          embedMode: 'iframe',
          contextRef: { pageId: 'demo-home', moduleCode: 'demo', orgId: '1001' },
          permissions: ['agent:chat:use'],
        },
      },
      PARENT_ORIGIN,
    );

    expect(useEmbedStore.getState().authState).toBe('authenticated');
    expect(useEmbedStore.getState().pageContext?.hostId).toBe('embed-demo');
    expect(useEmbedStore.getState().pageContext?.contextRef).toMatchObject({
      pageId: 'demo-home',
      moduleCode: 'demo',
    });
    expect(useAuthStore.getState().accessToken).toBe(token);

    const eventSpy = vi.fn();
    window.postMessage = eventSpy;
    const unsub = onA2uiEventResult();

    const promise = postA2uiEvent(
      {
        name: 'approve',
        componentName: 'approval-card',
        payload: { approvalId: 'WO-1' },
      },
      { sessionId: 'embed-demo-sess-1', hostId: 'embed-demo' },
    );

    expect(eventSpy).toHaveBeenCalledTimes(1);
    const [sent, targetOrigin] = eventSpy.mock.calls[0] as [
      { type: string; eventId: string; event: { name: string }; meta: { hostId: string } },
      string,
    ];
    expect(targetOrigin).toBe(PARENT_ORIGIN);
    expect(sent.type).toBe('A2UI_EVENT');
    expect(sent.event.name).toBe('approve');
    expect(sent.meta.hostId).toBe('embed-demo');

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'A2UI_EVENT_RESULT',
          eventId: sent.eventId,
          ok: true,
          data: { demo: true },
        },
        origin: PARENT_ORIGIN,
      }),
    );

    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ demo: true });
    }
    unsub();
  });
});
