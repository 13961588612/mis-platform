import { deltaText, isDeltaFrame, postEventSource, type SseFrame } from '@/lib/api/sse-client';

// SSE 底座已下沉到 `@/lib/api/sse-client`（F-01 起知识问答也要用，放在 features/ai 下
// 会逼 features/kb 跨 feature 依赖）。本文件只保留 AI 对话侧的语义封装，
// 对外签名与行为完全不变，既有调用方零改动。

/**
 * AI SSE 封装。
 *
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
  await postEventSource(path, {
    body: opts.body,
    signal: opts.signal,
    onError: (err) => opts.onError?.(err),
    onFrame: (frame: SseFrame) => {
      const data = frame.data;
      if (data === null) {
        // 非 JSON 增量（纯文本流）按 delta 处理
        opts.onDelta(frame.raw);
        return;
      }
      if (isDeltaFrame(frame)) {
        opts.onDelta(deltaText(frame));
        return;
      }
      if (frame.event === 'done' || data.type === 'done') {
        opts.onDone?.({
          finishReason: typeof data.finishReason === 'string' ? data.finishReason : undefined,
          sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
        });
        return;
      }
      if (frame.event === 'error' || data.type === 'error') {
        opts.onError?.({
          message: typeof data.message === 'string' ? data.message : 'AI 响应错误',
        });
      }
    },
  });
}
