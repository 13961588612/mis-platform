// @vitest-environment jsdom
/**
 * P0-2 历史自动加载三态 + P0-1 sendMessage 附件落地（QA 验收）。
 *
 * 覆盖 useChat：
 * - loadHistory 三态：loading → loaded（setMessages 渲染）/ error（404 / 失败降级空会话）
 * - loadHistory 404 / 网络异常 → historyState='error'（不抛、不阻塞）
 * - sendMessage(content, attachments) 把附件塞入本地 user 消息（ChatMessage.attachments），
 *   证明附件随消息上行链路在本地侧闭合
 * - 空 done + messageId：SSE 丢正文时回拉历史，避免误报超时失败
 *
 * 说明：useChat 依赖 chat-store（zustand 全局）与 fetch；本测试 mock fetch，并通过
 * 直接读 store 状态验证行为，不依赖真实 WS/SSE。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChat, GENERATE_SAFETY_TIMEOUT_MS } from './useChat';
import { useChatStore } from '@/stores/chat-store';
import { useAuthStore } from '@/stores/auth-store';

const sseHarness = vi.hoisted(() => {
  let onEvent: ((event: { type: string; [k: string]: unknown }) => void) | null = null;
  return {
    getOnEvent: () => onEvent,
    subscribeChatStream: vi.fn(
      (opts: { onEvent: (event: { type: string; [k: string]: unknown }) => void }) => {
        onEvent = opts.onEvent;
        return { abort: vi.fn() };
      },
    ),
  };
});

vi.mock('./sse-client', () => ({
  subscribeChatStream: sseHarness.subscribeChatStream,
  buildChatStreamUrl: (sessionId: string) => `/api/events/stream?sessionId=${sessionId}`,
}));

const wsHarness = vi.hoisted(() => {
  const sent: unknown[] = [];
  return {
    sent,
    clear: () => {
      sent.length = 0;
    },
    ChatWsClient: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      close: vi.fn(),
      isOpen: () => true,
      send: (msg: unknown) => {
        sent.push(msg);
        return true;
      },
    })),
  };
});

vi.mock('./ws-client', () => ({
  ChatWsClient: wsHarness.ChatWsClient,
  buildChatWsUrl: () => '/ws/chat',
}));

const SID = 'web-test-session-1';

function setSession(sid: string) {
  useChatStore.getState().setSessionId(sid);
  useChatStore.getState().setHistoryState('idle');
  useChatStore.getState().clearMessages();
  useChatStore.getState().setGenerating(false);
  useChatStore.getState().setError(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  wsHarness.clear();
  setSession(SID);
  useAuthStore.setState({
    accessToken: 'test-token',
    expiresAt: Date.now() + 3_600_000,
    user: { id: 'u-1', username: 'tester', displayName: 'Tester' } as never,
  });
});

describe('loadHistory 三态（P0-2）', () => {
  it('loaded：成功拉取历史并 setMessages', async () => {
    const payload = {
      code: 0,
      data: [
        {
          id: 'm1',
          session_id: SID,
          role: 'user',
          content: '历史问题',
          timestamp: '2026-01-01T00:00:00Z',
          metadata: {},
        },
        {
          id: 'm2',
          session_id: SID,
          role: 'assistant',
          content: '历史回答',
          timestamp: '2026-01-01T00:00:01Z',
          metadata: {},
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => payload }) as never),
    );

    const { result } = renderHook(() => useChat());
    // ensureSession 会触发 loadHistory；这里直接调用以可控
    await act(async () => {
      await result.current.loadHistory();
    });

    await waitFor(() => {
      expect(useChatStore.getState().historyState).toBe('loaded');
      expect(useChatStore.getState().messages).toHaveLength(2);
      expect(useChatStore.getState().messages[0].content).toBe('历史问题');
    });
  });

  it('error：404 降级空会话（historyState=error，不抛）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as never),
    );
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.loadHistory();
    });
    await waitFor(() => {
      expect(useChatStore.getState().historyState).toBe('error');
      // 降级：不填充、不阻塞
      expect(useChatStore.getState().messages).toHaveLength(0);
    });
  });

  it('error：fetch 抛异常同样降级（historyState=error）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.loadHistory();
    });
    await waitFor(() => {
      expect(useChatStore.getState().historyState).toBe('error');
    });
  });

  it('请求 URL 严格复用 #29（无 chat 段）', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.loadHistory();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calledUrl = (fetchMock as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls[0][0];
    expect(calledUrl).toContain('/api/v1/agent-ops/sessions/' + SID + '/messages');
    expect(calledUrl).not.toContain('/chat/');
  });
});

describe('sendMessage 附件落地（P0-1）', () => {
  it('把 attachments 塞入本地 user 消息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as never));
    const { result } = renderHook(() => useChat());

    const atts = [
      {
        fileId: 'f-1',
        name: 'a.png',
        mimeType: 'image/png',
        size: 1024,
        url: '/api/v1/agent-ops/files/f-1',
        status: 'done' as const,
      },
    ];
    act(() => {
      result.current.sendMessage('看这张图', atts);
    });

    const msgs = useChatStore.getState().messages;
    const userMsg = msgs.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg?.attachments).toHaveLength(1);
    expect(userMsg?.attachments?.[0].fileId).toBe('f-1');
  });

  it('无内容且无附件时不发（不新增消息）', () => {
    const { result } = renderHook(() => useChat());
    const before = useChatStore.getState().messages.length;
    act(() => {
      result.current.sendMessage('   ', []);
    });
    expect(useChatStore.getState().messages.length).toBe(before);
  });
});

describe('新建会话防串历史（P0 / TASK-002）', () => {
  it('loadHistory await 后 sid 已变则丢弃结果（不 setMessages）', async () => {
    let resolveFetch: ((v: unknown) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const { result } = renderHook(() => useChat());
    let loadPromise: Promise<void>;
    act(() => {
      loadPromise = result.current.loadHistory();
    });
    expect(useChatStore.getState().historyState).toBe('loading');

    // 模拟新建：关闭旧会话并 forceNew
    act(() => {
      result.current.closeSession();
    });
    let newSid: string;
    await act(async () => {
      newSid = await result.current.ensureSession(undefined, { forceNew: true });
    });
    expect(newSid!).not.toBe(SID);
    expect(useChatStore.getState().messages).toHaveLength(0);

    // 旧请求晚到
    await act(async () => {
      resolveFetch?.({
        ok: true,
        json: async () => ({
          code: 0,
          data: [
            {
              id: 'stale-1',
              session_id: SID,
              role: 'user',
              content: '旧会话历史不应出现',
              timestamp: '2026-01-01T00:00:00Z',
              metadata: {},
            },
          ],
        }),
      });
      await loadPromise!;
    });

    expect(useChatStore.getState().sessionId).toBe(newSid!);
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().messages.some((m) => m.content.includes('旧会话'))).toBe(false);
  });

  it('forceNew 忽略 localStorage 旧 sid，生成新会话且不拉历史', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never);
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('mis.copilot.lastSession', 'web-old-from-storage');

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.closeSession();
    });
    let newSid: string;
    await act(async () => {
      newSid = await result.current.ensureSession(undefined, { forceNew: true });
    });

    expect(newSid!).not.toBe('web-old-from-storage');
    expect(newSid!).not.toBe(SID);
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(localStorage.getItem('mis.copilot.lastSession')).toBe(newSid!);
    // forceNew 不触发 loadHistory
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closeSession 重置 historyState 为 idle', () => {
    useChatStore.getState().setHistoryState('loading');
    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.closeSession();
    });
    expect(useChatStore.getState().historyState).toBe('idle');
    expect(useChatStore.getState().sessionId).toBeNull();
  });
});

describe('空 done + messageId / 安全超时回填', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('空 done 带 messageId：解锁并回拉历史正文（不误报失败）', async () => {
    const historyPayload = {
      code: 0,
      data: [
        {
          id: 'u1',
          session_id: SID,
          role: 'user',
          content: '银联PAD怎么设置',
          timestamp: '2026-01-01T00:00:00Z',
          metadata: {},
        },
        {
          id: 'a1',
          session_id: SID,
          role: 'assistant',
          content: '后端已落库的完整回复',
          timestamp: '2026-01-01T00:00:01Z',
          metadata: {},
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => historyPayload }) as never),
    );

    const { result } = renderHook(() => useChat({ autoConnect: true }));
    await waitFor(() => expect(sseHarness.getOnEvent()).toBeTruthy());

    act(() => {
      result.current.sendMessage('银联PAD怎么设置');
    });
    expect(useChatStore.getState().isGenerating).toBe(true);
    const assistant = useChatStore.getState().messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('');

    await act(async () => {
      sseHarness.getOnEvent()?.({
        type: 'done',
        messageId: 'a1',
        sessionId: SID,
      });
    });

    await waitFor(() => {
      expect(useChatStore.getState().isGenerating).toBe(false);
      expect(useChatStore.getState().messages.some((m) => m.content.includes('后端已落库'))).toBe(
        true,
      );
      expect(useChatStore.getState().error).toBeNull();
    });
  });

  it('安全超时：本地已有正文时标 delivered，不报「回复失败」', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never),
    );

    const { result } = renderHook(() => useChat({ autoConnect: true }));
    // 刷 effect，挂上 SSE onEvent（假时钟下不用 waitFor）
    await act(async () => {
      await Promise.resolve();
    });
    expect(sseHarness.getOnEvent()).toBeTruthy();

    act(() => {
      result.current.sendMessage('测试');
    });
    act(() => {
      sseHarness.getOnEvent()?.({ type: 'stream', content: '已流出的正文' });
    });
    expect(useChatStore.getState().isGenerating).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GENERATE_SAFETY_TIMEOUT_MS + 50);
    });

    const assistant = useChatStore.getState().messages.find((m) => m.role === 'assistant');
    expect(assistant?.status).toBe('delivered');
    expect(assistant?.content).toContain('已流出的正文');
    expect(useChatStore.getState().isGenerating).toBe(false);
    expect(useChatStore.getState().error).toBeNull();
  });
});

describe('陈旧生成态恢复（切页/重挂载转圈回归）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('拥有者在收到 done 前卸载 → 收尾本轮生成（按钮不再转圈）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never),
    );

    const first = renderHook(() => useChat({ autoConnect: true }));
    await waitFor(() => expect(sseHarness.getOnEvent()).toBeTruthy());
    act(() => {
      first.result.current.sendMessage('问题');
    });
    act(() => {
      sseHarness.getOnEvent()?.({ type: 'stream', content: '已流出正文' });
    });
    expect(useChatStore.getState().isGenerating).toBe(true);

    // 承载本轮生成的组件被卸载（切页/关闭面板）→ 收尾，按钮解锁。
    first.unmount();
    expect(useChatStore.getState().isGenerating).toBe(false);
    const assistant = useChatStore.getState().messages.find((m) => m.role === 'assistant');
    expect(assistant?.status).toBe('delivered');
  });

  it('关闭 Copilot 时尚无正文 → 移除占位气泡，不报「回复失败」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never),
    );

    const first = renderHook(() => useChat({ autoConnect: true }));
    await waitFor(() => expect(sseHarness.getOnEvent()).toBeTruthy());
    act(() => {
      first.result.current.sendMessage('问数中切走');
    });
    expect(useChatStore.getState().isGenerating).toBe(true);
    expect(useChatStore.getState().messages.some((m) => m.role === 'assistant')).toBe(true);

    first.unmount();
    expect(useChatStore.getState().isGenerating).toBe(false);
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().messages.some((m) => m.role === 'assistant')).toBe(false);
    expect(useChatStore.getState().messages.some((m) => m.status === 'error')).toBe(false);
  });

  it('无锚点的旁观实例卸载，不会误清他人在进行的生成', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never),
    );

    // owner：真正发起并持有流锚点的实例
    const owner = renderHook(() => useChat({ autoConnect: true }));
    await waitFor(() => expect(sseHarness.getOnEvent()).toBeTruthy());
    act(() => {
      owner.result.current.sendMessage('问题');
    });
    act(() => {
      sseHarness.getOnEvent()?.({ type: 'stream', content: '流式正文' });
    });
    expect(useChatStore.getState().isGenerating).toBe(true);

    // bystander：另一个 useChat 实例（无锚点）挂载后卸载，不得清除 owner 的生成态。
    const bystander = renderHook(() => useChat({ autoConnect: true }));
    await act(async () => {
      await Promise.resolve();
    });
    bystander.unmount();
    expect(useChatStore.getState().isGenerating).toBe(true);

    owner.unmount();
  });

  it('挂载时若 isGenerating=true 且无 streaming 气泡 → 立即解锁（进 Copilot 不再转圈）', async () => {
    useChatStore.getState().setGenerating(true);
    useChatStore.getState().setMessages([
      {
        id: 'a1',
        sessionId: SID,
        role: 'assistant',
        content: '已结束的回复',
        status: 'delivered',
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(useChatStore.getState().isGenerating).toBe(true);

    renderHook(() => useChat({ autoConnect: false }));
    expect(useChatStore.getState().isGenerating).toBe(false);
  });

  it('owner 收尾后，旁观实例晚到的 stream 帧不得重新拉高 isGenerating', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never),
    );

    const owner = renderHook(() => useChat({ autoConnect: true }));
    await waitFor(() => expect(sseHarness.getOnEvent()).toBeTruthy());
    const ownerOnEvent = sseHarness.getOnEvent()!;

    act(() => {
      owner.result.current.sendMessage('问题');
    });
    act(() => {
      ownerOnEvent({ type: 'stream', content: '正文' });
    });
    expect(useChatStore.getState().isGenerating).toBe(true);

    // 旁观实例也挂上同一路 SSE 回调模拟（第二个 hook 会覆盖 harness 的 onEvent）
    const bystander = renderHook(() => useChat({ autoConnect: true }));
    await waitFor(() => expect(sseHarness.getOnEvent()).not.toBe(ownerOnEvent));
    const bystanderOnEvent = sseHarness.getOnEvent()!;

    // owner 收尾（卸载 = 关闭 Copilot）
    owner.unmount();
    expect(useChatStore.getState().isGenerating).toBe(false);

    // 晚到帧打到旁观实例 → 必须忽略，不能再转圈
    act(() => {
      bystanderOnEvent({ type: 'stream', content: '晚到增量' });
    });
    expect(useChatStore.getState().isGenerating).toBe(false);

    bystander.unmount();
  });

  it('KeepAlive 下 autoConnect→false 时收尾本实例生成（切走问数页不再残留转圈）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never),
    );

    const { result, rerender } = renderHook(
      ({ autoConnect }: { autoConnect: boolean }) => useChat({ autoConnect }),
      { initialProps: { autoConnect: true } },
    );
    await waitFor(() => expect(sseHarness.getOnEvent()).toBeTruthy());
    act(() => {
      result.current.sendMessage('问题');
    });
    expect(useChatStore.getState().isGenerating).toBe(true);

    // 模拟 KeepAlive 切走：active=false → autoConnect=false，组件不卸载
    rerender({ autoConnect: false });
    expect(useChatStore.getState().isGenerating).toBe(false);
  });

  it('安全超时不被 delta 无限续期（硬上限一次，不被 delta 顺延）', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never),
    );

    const { result } = renderHook(() => useChat({ autoConnect: true }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.sendMessage('问题');
    });
    // 第一帧：开始计时
    act(() => {
      sseHarness.getOnEvent()?.({ type: 'stream', content: 'A' });
    });
    // 多次 delta（旧逻辑会无限顺延；新逻辑保持首次计时）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200_000);
    });
    act(() => {
      sseHarness.getOnEvent()?.({ type: 'stream', content: 'B' });
    });
    // 再推进剩余 → 应触发硬上限并解锁
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });

    expect(useChatStore.getState().isGenerating).toBe(false);
  });
});

describe('stopGenerating（中途终止）', () => {
  it('生成中点停止：发 generation.cancel、本地解锁、空气泡移除', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never),
    );

    const { result } = renderHook(() => useChat({ autoConnect: true }));
    await waitFor(() => expect(sseHarness.getOnEvent()).toBeTruthy());
    act(() => {
      result.current.sendMessage('很长的问数');
    });
    expect(useChatStore.getState().isGenerating).toBe(true);
    expect(useChatStore.getState().messages.some((m) => m.role === 'assistant')).toBe(true);

    act(() => {
      result.current.stopGenerating();
    });

    expect(useChatStore.getState().isGenerating).toBe(false);
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().messages.some((m) => m.role === 'assistant')).toBe(false);
    expect(
      wsHarness.sent.some(
        (m) =>
          typeof m === 'object' &&
          m != null &&
          (m as { type?: string }).type === 'generation.cancel',
      ),
    ).toBe(true);
  });

  it('已有正文时停止：标 delivered，不报失败', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: [] }) }) as never),
    );

    const { result } = renderHook(() => useChat({ autoConnect: true }));
    await waitFor(() => expect(sseHarness.getOnEvent()).toBeTruthy());
    act(() => {
      result.current.sendMessage('问题');
    });
    act(() => {
      sseHarness.getOnEvent()?.({ type: 'stream', content: '部分回复' });
    });

    act(() => {
      result.current.stopGenerating();
    });

    const assistant = useChatStore.getState().messages.find((m) => m.role === 'assistant');
    expect(assistant?.status).toBe('delivered');
    expect(assistant?.content).toContain('部分回复');
    expect(useChatStore.getState().isGenerating).toBe(false);
  });
});
