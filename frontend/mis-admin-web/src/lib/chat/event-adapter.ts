/**
 * chat-core 事件适配器（T06'）。
 *
 * <p>将 SSE/WS 原始载荷归一化为 {@link ChatStreamEvent}，兼容两类协议：
 * 1. 最终协议（02 文档 §4）：`stream` / `a2ui_surface` / `dispatch.trace` / `done` / `error`
 * 2. 旧协议（旧版独立前端存量）：`agent_event` envelope 内嵌 `text.delta` / `tool.call`
 *    / `tool.result` / `ui.render` / `approval.request` / `dispatch.trace` / `error` / `done`
 *
 * <p>dispatch.trace 支持两种 Gateway 下发风格（F3 对齐）：
 * - `{ type: 'dispatch.trace', trace }`（旧风格 / 直出）
 * - `{ type: 'custom', eventType: 'dispatch.trace', data }`（EventConverter CUSTOM 分支）
 * 二者统一归一为内部 `{ type: 'dispatch.trace', trace }` 事件。
 */

import { camelizeKeys } from './camelize';
import type { ChatStreamEvent, DispatchTracePayload, RawStreamLine, TokenUsage } from './types';

/**
 * 解析一条原始载荷（可能是 envelope 或直接事件）。
 * 无法识别时返回 null（调用方忽略，绝不中断流）。
 */
export function parseStreamLine(raw: RawStreamLine): ChatStreamEvent | null {
  // 1) agent_event envelope：{ type: 'agent_event', event: {...} }
  const envelopeEvent = raw.event;
  if (raw.type === 'agent_event' && envelopeEvent != null && typeof envelopeEvent === 'object') {
    return adaptLegacyEvent(envelopeEvent as Record<string, unknown>);
  }

  // 2) 最终协议事件（type 直出）
  const type = raw.type;
  if (typeof type !== 'string') return null;

  switch (type) {
    case 'stream': {
      const content = typeof raw.content === 'string' ? raw.content : '';
      return { type: 'stream', content };
    }
    case 'a2ui_surface': {
      const operations = Array.isArray(raw.operations)
        ? (raw.operations as import('../a2ui/types').A2uiOperation[])
        : [];
      return { type: 'a2ui_surface', operations, surfaceId: asString(raw.surfaceId) };
    }
    case 'dispatch.trace': {
      return { type: 'dispatch.trace', trace: adaptTrace(raw.trace) };
    }
    case 'custom': {
      // F3：Gateway EventConverter CUSTOM 分支 → { type:'custom', eventType, data }。
      // 仅归一 dispatch.trace 自定义事件；其它 custom 事件忽略（绝不中断流）。
      if (raw.eventType !== 'dispatch.trace') return null;
      return { type: 'dispatch.trace', trace: adaptTrace(raw.data) };
    }
    case 'done': {
      return { type: 'done', tokenUsage: adaptTokenUsage(raw.token_usage ?? raw.tokenUsage) };
    }
    case 'error': {
      return {
        type: 'error',
        errorCode: asString(raw.error_code ?? raw.errorCode),
        message: asString(raw.message ?? raw.errorMessage) ?? '未知错误',
      };
    }
    case 'text.delta': {
      return { type: 'text.delta', content: asString(raw.content) };
    }
    case 'tool.call': {
      return {
        type: 'tool.call',
        toolName: asString(raw.tool_name ?? raw.toolName),
        args: asRecord(raw.args),
      };
    }
    case 'tool.result': {
      return {
        type: 'tool.result',
        toolName: asString(raw.tool_name ?? raw.toolName),
        result: asRecord(raw.result),
      };
    }
    case 'ui.render': {
      return {
        type: 'ui.render',
        component: asString(raw.component),
        props: asRecord(raw.props),
      };
    }
    case 'approval.request': {
      return {
        type: 'approval.request',
        skillId: asString(raw.skill_id ?? raw.skillId),
        detail: asRecord(raw.detail),
      };
    }
    default:
      return null;
  }
}

/** 旧协议 AgentEvent（snake_case）→ 前端事件。 */
function adaptLegacyEvent(event: Record<string, unknown>): ChatStreamEvent | null {
  const type = asString(event.type);
  if (!type) return null;
  return parseStreamLine({ ...event, type });
}

/** dispatch.trace 载荷归一化（防御：entries 非数组时返回空）。 */
function adaptTrace(raw: unknown): DispatchTracePayload {
  if (raw == null || typeof raw !== 'object') return { entries: [] };
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return { entries: [] };
  return {
    entries: entries.filter((e): e is NonNullable<typeof entries>[number] => e != null && typeof e === 'object'),
  };
}

function adaptTokenUsage(raw: unknown): TokenUsage | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const r = raw as { prompt?: unknown; completion?: unknown; total?: unknown };
  const prompt = Number(r.prompt ?? 0);
  const completion = Number(r.completion ?? 0);
  const total = Number(r.total ?? 0);
  if (Number.isNaN(prompt) || Number.isNaN(completion) || Number.isNaN(total)) return undefined;
  return { prompt, completion, total };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return camelizeKeys(value) as Record<string, unknown>;
}
