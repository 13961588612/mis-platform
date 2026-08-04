import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useAuthStore } from '@/stores/auth-store';

/**
 * 通用 SSE（Server-Sent Events）POST 客户端。
 *
 * <p>放在 `lib/api` 而非某个 feature 下：AI 对话与知识问答（F-01）都要用，
 * 若由 `features/ai` 持有会逼着 `features/kb` 跨 feature 直接依赖，违反架构军规1。
 * 这里只做「发请求 + 解帧 + 分发」，不含任何业务语义。
 *
 * <p>手工注入 `Authorization`：`fetch-event-source` 走原生 fetch，
 * 不经过 axios 拦截器，拿不到自动附加的令牌。
 */

/** 单个 SSE 帧（已解析 JSON；非 JSON 正文放在 `raw`）。 */
export interface SseFrame {
  /** 事件名（`event:` 行）；服务端未给出时为空串。 */
  event: string;
  /** `data:` 行解析出的 JSON 对象；非 JSON 时为 null。 */
  data: Record<string, unknown> | null;
  /** `data:` 行原文，便于非 JSON 流兜底。 */
  raw: string;
}

/** SSE 请求选项。 */
export interface SsePostOptions {
  /** 请求体（自动 JSON 序列化）。 */
  body: Record<string, unknown>;
  /** 每帧回调。 */
  onFrame: (frame: SseFrame) => void;
  /** 连接层错误（打开失败 / 中断）；业务 error 帧仍走 `onFrame`。 */
  onError?: (err: { message: string }) => void;
  /** 中断信号，由调用方持有 AbortController。 */
  signal?: AbortSignal;
  /** 额外请求头。 */
  headers?: Record<string, string>;
}

/**
 * 发起一次 SSE POST 请求。
 *
 * @param path `/api/v1` 之后的路径，例如 `/ai/rag`
 * @param opts 请求与回调
 */
export async function postEventSource(path: string, opts: SsePostOptions): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  await fetchEventSource(`/api/v1${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
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
      let parsed: Record<string, unknown> | null = null;
      try {
        const obj: unknown = JSON.parse(ev.data);
        parsed = obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }
      opts.onFrame({ event: ev.event ?? '', data: parsed, raw: ev.data });
    },
    onerror: (err: unknown) => {
      const message =
        err instanceof Error
          ? err.message
          : String((err as { message?: string })?.message ?? 'AI 响应中断');
      opts.onError?.({ message });
      // 抛出以终止 fetch-event-source 的默认重试，由调用方决定是否重发
      throw err instanceof Error ? err : new Error(message);
    },
  });
}

/** 判定一帧是否为文本增量：事件名为 `delta`，或 payload 里带 `text`/`delta` 键。 */
export function isDeltaFrame(frame: SseFrame): boolean {
  if (frame.event === 'delta') return true;
  const d = frame.data;
  if (!d) return false;
  return d.type === 'delta' || 'text' in d || 'delta' in d;
}

/** 取出增量文本：优先新契约 `text`，回落旧契约 `delta`，再回落原文。 */
export function deltaText(frame: SseFrame): string {
  const d = frame.data;
  if (!d) return frame.raw;
  const text = d.text;
  if (typeof text === 'string') return text;
  const delta = d.delta;
  if (typeof delta === 'string') return delta;
  return '';
}
