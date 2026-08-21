/**
 * embed-bridge A2UI 事件桥测试（QA 严过关，T07' 独立验证，jsdom 环境）。
 *
 * <p>口径：01-architecture.md §5.2 — A2UI_EVENT（iframe→父页）/ A2UI_EVENT_RESULT（父页→iframe）；
 * 回包 origin 必须通过白名单且等于已鉴权父页；权限错误码 40301/40303/40304/40305/4004
 * → permissionDenied（PermissionErrorBanner 消费）。
 *
 * <p>说明：jsdom 对 `parent.postMessage(msg, targetOrigin)` 做 origin 校验（self 文档 origin
 * ≠ targetOrigin 时不投递），因此用 `window.postMessage = vi.fn()` 捕获出站 A2UI_EVENT，
 * 手动 dispatch A2UI_EVENT_RESULT 模拟父页回包。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  postA2uiEvent,
  onA2uiEventResult,
  createEmbedBffAdapter,
  EMBED_EVENT_TIMEOUT_MS,
  type A2uiEventResultMessage,
} from './embed-bridge';
import { useEmbedStore } from './embedStore';

const PARENT_ORIGIN = 'https://parent.example.com';
const OTHER_WHITELISTED = 'https://other.example.com';
const EVIL_ORIGIN = 'https://evil.example.com';

function dispatchResult(msg: A2uiEventResultMessage, origin: string): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: msg as unknown as Record<string, unknown>, origin }),
  );
}

function capturePostMessage(): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  window.postMessage = spy;
  return spy;
}

describe('embed-bridge postA2uiEvent', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PARENT_ORIGINS', `${PARENT_ORIGIN},${OTHER_WHITELISTED}`);
    useEmbedStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('父页未就绪（未鉴权）→ 立即结构化失败', async () => {
    const result = await postA2uiEvent(
      { name: 'approve', componentName: 'approval-card', payload: { approvalId: 'WO-1' } },
      { sessionId: 'sess-1', hostId: 'crm' },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('父页未就绪');
    expect(result.error?.permissionDenied).toBe(false);
  });

  it('全链路：A2UI_EVENT 透出（字段对齐 §5.2）→ 合法回包 resolve ok', async () => {
    const postMessageSpy = capturePostMessage();
    useEmbedStore.getState().setAuthenticated('t.m.e', PARENT_ORIGIN);
    const unsubscribe = onA2uiEventResult();

    const promise = postA2uiEvent(
      { name: 'approve', componentName: 'approval-card', payload: { approvalId: 'WO-1234', decision: 'approved' } },
      { sessionId: 'sess-abc123', hostId: 'crm-web' },
    );

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const [sent, targetOrigin] = postMessageSpy.mock.calls[0];
    // 出站目标 = 已鉴权父页 origin（不向任意窗口广播）
    expect(targetOrigin).toBe(PARENT_ORIGIN);
    expect(sent.type).toBe('A2UI_EVENT');
    expect(typeof sent.eventId).toBe('string');
    expect(sent.event.name).toBe('approve');
    expect(sent.event.componentName).toBe('approval-card');
    expect(sent.event.payload.approvalId).toBe('WO-1234');
    expect(sent.meta.sessionId).toBe('sess-abc123');
    expect(sent.meta.hostId).toBe('crm-web');

    // 父页回包（同 origin + 匹配 eventId）→ 成功
    dispatchResult(
      { type: 'A2UI_EVENT_RESULT', eventId: sent.eventId, ok: true, data: { result: 'approved' } },
      PARENT_ORIGIN,
    );
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ result: 'approved' });

    unsubscribe();
  });

  it('权限错误码 40301 → permissionDenied=true（PermissionErrorBanner 消费）', async () => {
    const postMessageSpy = capturePostMessage();
    useEmbedStore.getState().setAuthenticated('t.m.e', PARENT_ORIGIN);
    const unsubscribe = onA2uiEventResult();

    const promise = postA2uiEvent(
      { name: 'approve', componentName: 'approval-card', payload: {} },
      { sessionId: 's', hostId: 'h' },
    );
    const sent = postMessageSpy.mock.calls[0][0];
    dispatchResult(
      {
        type: 'A2UI_EVENT_RESULT',
        eventId: sent.eventId,
        ok: false,
        error: { code: 40301, message: '权限不足', missingPermissions: ['approval:decide'] },
      },
      PARENT_ORIGIN,
    );
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(40301);
    expect(result.error?.permissionDenied).toBe(true);
    expect(result.error?.missingPermissions).toEqual(['approval:decide']);

    unsubscribe();
  });

  it('非白名单 origin 的 A2UI_EVENT_RESULT → 拒绝（pending 不 resolve，超时才兜底）', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const postMessageSpy = capturePostMessage();
    useEmbedStore.getState().setAuthenticated('t.m.e', PARENT_ORIGIN);
    const unsubscribe = onA2uiEventResult();

    const promise = postA2uiEvent(
      { name: 'approve', componentName: 'approval-card', payload: {} },
      { sessionId: 's', hostId: 'h' },
    );
    const sent = postMessageSpy.mock.calls[0][0];
    // 恶意回包：非白名单 origin
    dispatchResult({ type: 'A2UI_EVENT_RESULT', eventId: sent.eventId, ok: true, data: {} }, EVIL_ORIGIN);

    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);

    // 超时兜底收尾
    await vi.advanceTimersByTimeAsync(EMBED_EVENT_TIMEOUT_MS + 1);
    expect(settled).toBe(true);

    unsubscribe();
  });

  it('白名单内但与已鉴权父页 origin 不一致 → 忽略回包', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const postMessageSpy = capturePostMessage();
    useEmbedStore.getState().setAuthenticated('t.m.e', PARENT_ORIGIN);
    const unsubscribe = onA2uiEventResult();

    const promise = postA2uiEvent(
      { name: 'approve', componentName: 'approval-card', payload: {} },
      { sessionId: 's', hostId: 'h' },
    );
    const sent = postMessageSpy.mock.calls[0][0];
    // OTHER_WHITELISTED 在白名单，但 ≠ 已鉴权父页
    dispatchResult({ type: 'A2UI_EVENT_RESULT', eventId: sent.eventId, ok: true, data: {} }, OTHER_WHITELISTED);

    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(EMBED_EVENT_TIMEOUT_MS + 1);
    expect(settled).toBe(true);

    unsubscribe();
  });

  it('父页超时无回包 → 结构化超时错误', async () => {
    vi.useFakeTimers();
    capturePostMessage();
    useEmbedStore.getState().setAuthenticated('t.m.e', PARENT_ORIGIN);

    const promise = postA2uiEvent(
      { name: 'approve', componentName: 'approval-card', payload: {} },
      { sessionId: 's', hostId: 'h' },
    );
    let result: Awaited<ReturnType<typeof postA2uiEvent>> | undefined;
    const done = promise.then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(EMBED_EVENT_TIMEOUT_MS + 1);
    await done;
    expect(result?.ok).toBe(false);
    expect(result?.error?.message).toContain('超时');
  });
});

describe('embed-bridge createEmbedBffAdapter', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PARENT_ORIGINS', PARENT_ORIGIN);
    useEmbedStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bridge 模式：未鉴权时返回结构化失败（不进 postMessage）', async () => {
    const adapter = createEmbedBffAdapter('bridge');
    const result = await adapter('approval-card', 'approve', { approvalId: 'WO-1' });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('父页未就绪');
  });

  it('direct 模式：未映射操作 → POLICY_UNMAPPED(4004) permissionDenied=true', async () => {
    const adapter = createEmbedBffAdapter('direct');
    const result = await adapter('approval-card', 'unknown-action', {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(4004);
    expect(result.error?.permissionDenied).toBe(true);
  });

  it('direct 模式：已知操作绑定解析（approval-card.approve → /api/v1/push/approvals/{id}/respond）', async () => {
    const binding = (await import('@/components/a2ui/registry')).getActionBinding('approval-card', 'approve');
    expect(binding?.method).toBe('POST');
    expect(binding?.path).toBe('/api/v1/push/approvals/{id}/respond');
    expect(binding?.permissionCode).toBe('approval:decide');
    // bff-actions 为动态 import（不静态进 embed chunk）——由构建产物核对
    const adapter = createEmbedBffAdapter('direct');
    expect(typeof adapter).toBe('function');
  });
});
