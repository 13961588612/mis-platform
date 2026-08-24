// @vitest-environment jsdom
/**
 * P0-2 历史自动加载三态 + P0-1 sendMessage 附件落地（QA 验收）。
 *
 * 覆盖 useChat：
 * - loadHistory 三态：loading → loaded（setMessages 渲染）/ error（404 / 失败降级空会话）
 * - loadHistory 404 / 网络异常 → historyState='error'（不抛、不阻塞）
 * - sendMessage(content, attachments) 把附件塞入本地 user 消息（ChatMessage.attachments），
 *   证明附件随消息上行链路在本地侧闭合
 *
 * 说明：useChat 依赖 chat-store（zustand 全局）与 fetch；本测试 mock fetch，并通过
 * 直接读 store 状态验证行为，不依赖真实 WS/SSE。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChat } from './useChat';
import { useChatStore } from '@/stores/chat-store';

const SID = 'web-test-session-1';

function setSession(sid: string) {
  useChatStore.getState().setSessionId(sid);
  useChatStore.getState().setHistoryState('idle');
  useChatStore.getState().clearMessages();
}

beforeEach(() => {
  vi.restoreAllMocks();
  setSession(SID);
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
