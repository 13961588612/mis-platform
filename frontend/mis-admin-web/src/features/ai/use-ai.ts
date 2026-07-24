import { useCallback, useRef, useState } from 'react';
import api from '@/lib/api/client';
import { useAiContext } from './ai-context';
import { aiFetchEventSource } from './ai-sse-client';
import type { AiCapability, AiError, UseAIOptions, UseAIResult } from './types';

/** 能力 → BFF 端点（baseURL=/api/v1，故路径省去前缀） */
const ENDPOINT: Record<AiCapability, string> = {
  chat: '/ai/chat/completions',
  summary: '/ai/summary',
  extract: '/ai/extract',
  rag: '/ai/rag',
};

/** axios 错误 → 统一 AiError */
function toAiError(err: unknown): AiError {
  const e = err as {
    response?: { status?: number; data?: { code?: number; message?: string; traceId?: string } };
    message?: string;
  };
  const status = e?.response?.status;
  const data = e?.response?.data;
  if (status === 401) return { kind: 'gate', message: data?.message || '未授权，请重新登录', code: status };
  if (status === 408 || data?.code === 40800)
    return { kind: 'timeout', message: '请求超时，请重试', code: data?.code ?? status };
  if (!status) return { kind: 'network', message: '网络异常，请检查连接', traceId: data?.traceId };
  return {
    kind: 'business',
    message: data?.message || e?.message || '请求失败',
    code: data?.code ?? status,
    traceId: data?.traceId,
  };
}

function buildBody(o: UseAIOptions<unknown>, ctx: ReturnType<typeof useAiContext>) {
  const body: Record<string, unknown> = {
    capability: o.capability,
    ...(o.request as Record<string, unknown>),
    context: o.context ?? ctx.getContext(),
  };
  // T-stream：流式开关透传给 BFF（chat/completions 据 stream 走 SSE 分支）
  if (o.stream) {
    body.stream = true;
  }
  return body;
}

/**
 * 统一 AI 调用 Hook：封装非流式/流式、JWT、错误、降级。
 * - 非流式（extract/summary/rag）：复用 api 客户端，统一解包 ApiResult。
 * - 流式（chat）：调用 aiFetchEventSource（T-stream 就绪后启用；本期 Copilot 走非流式 MVP）。
 */
export function useAI<TReq, TResp = unknown>(opts: UseAIOptions<TReq>): UseAIResult<TResp> {
  const ai = useAiContext();
  const [data, setData] = useState<TResp | null>(null);
  const [streaming, setStreaming] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AiError | null>(null);

  // 用 ref 持有最新 opts/context，使 run 引用稳定，便于在 effect 中自动触发
  const latest = useRef({ opts, ai });
  latest.current = { opts, ai };

  const unavailable = opts.feature ? !ai.isFeatureEnabled(opts.feature) : false;

  const run = useCallback(async (overrides?: Partial<UseAIOptions<unknown>>) => {
    const { opts: o0, ai: ctx } = latest.current;
    const o = { ...o0, ...overrides } as UseAIOptions<unknown>;
    const body = buildBody(o, ctx);
    setLoading(true);
    setError(null);
    setData(null);
    setStreaming('');
    try {
      if (o.stream) {
        // 流式：SSE 逐帧累积（T-stream 就绪后启用）
        let acc = '';
        await aiFetchEventSource(ENDPOINT[o.capability], {
          body: body as Record<string, unknown>,
          onDelta: (delta) => {
            acc += delta;
            setStreaming(acc);
            o.onToken?.(delta);
          },
          onDone: (payload) => {
            setData(acc as unknown as TResp);
            o.onDone?.(acc);
            void payload;
          },
          onError: (err) => {
            const aiErr: AiError = { kind: 'network', message: err.message };
            setError(aiErr);
            o.onError?.(aiErr);
          },
        });
      } else {
        const res = await api.post(ENDPOINT[o.capability], body);
        const payload = res.data as { code: number; message?: string; data?: unknown; traceId?: string };
        if (payload && payload.code === 0) {
          setData(payload.data as TResp);
          o.onDone?.(payload.data);
        } else {
          throw { response: { status: 200, data: payload } };
        }
      }
    } catch (err) {
      const aiErr = toAiError(err);
      setError(aiErr);
      o.onError?.(aiErr);
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, streaming, loading, error, unavailable, run };
}
