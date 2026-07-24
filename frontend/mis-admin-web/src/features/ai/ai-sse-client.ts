import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useAuthStore } from '@/stores/auth-store';

// 使用 @microsoft/fetch-event-source 标准具名导出 fetchEventSource（v2）。
// BFF T-stream 就绪后由 useAI 在 capability=chat/rag 且 stream:true 时调用本封装，
// 1:1 透传平台 delta|done|error 事件。
// 注：原 `fetch-event-source`(1.0.0-alpha.x) 仅默认导出且无 v3，改用微软官方同名导出包。

/**
 * AI SSE 封装（基于 fetch-event-source）。
 * 手工注入 Authorization（fetch-event-source 不走 axios 拦截器）。
 * 解析帧：event: delta / done / error。
 */
export interface AiSseOptions {
  body: Record<string, unknown>;
  onDelta: (delta: string) => void;
  onDone?: (payload: { finishReason?: string; sessionId?: string }) => void;
  onError?: (err: { message: string }) => void;
  signal?: AbortSignal;
}

/** 发起一次 SSE 流式请求；调用方持有 signal（AbortController）以便中断 */
export async function aiFetchEventSource(path: string, opts: AiSseOptions): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  await fetchEventSource(`/api/v1${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(opts.body),
    signal: opts.signal,
    openWhenHidden: true,
    onopen: async (res: Response) => {
      if (res.ok && res.status === 200) return;
      opts.onError?.({ message: `AI 连接失败 (${res.status})` });
      throw new Error(`SSE open failed: ${res.status}`);
    },
    onmessage: (ev: { data: string; event: string; id?: string }) => {
      if (!ev.data) return;
      try {
        const frame = JSON.parse(ev.data) as Record<string, unknown>;
        if (ev.event === 'delta' || frame.type === 'delta' || 'delta' in frame) {
          opts.onDelta(String((frame.delta as unknown) ?? ''));
          return;
        }
        if (ev.event === 'done' || frame.type === 'done') {
          opts.onDone?.({
            finishReason: frame.finishReason as string | undefined,
            sessionId: frame.sessionId as string | undefined,
          });
          return;
        }
        if (ev.event === 'error' || frame.type === 'error') {
          opts.onError?.({ message: String(frame.message ?? 'AI 响应错误') });
          return;
        }
      } catch {
        // 非 JSON 增量（纯文本流）按 delta 处理
        opts.onDelta(ev.data);
      }
    },
    onerror: (err: unknown) => {
      const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? 'AI 响应中断');
      opts.onError?.({ message });
    },
  });
}
