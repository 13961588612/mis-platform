/**
 * EventConverter.ts — AgentEvent ↔ BaseEvent 双向转换
 *
 * MIS 私有事件类型（dispatch.trace、approval.request 兼容、ui.render 迁移期映射）
 * 与字段命名（snake_case → camelCase）是存量协议；开源无此转换器，自研并保持
 * 8 种事件映射的显式维护（02-task-breakdown.md §2.2 / 01-architecture.md §2.2）。
 *
 * ## 事件映射表（权威，与 01 §2.2 一致）
 *
 * | AgentEvent        | BaseEvent                              | 方向        |
 * |-------------------|----------------------------------------|-------------|
 * | text.delta        | TEXT_MESSAGE_CHUNK                     | Python→前端 |
 * | tool.call         | TOOL_CALL_START + TOOL_CALL_ARGS + TOOL_CALL_END | Python→中间件 |
 * | tool.result       | TOOL_CALL_RESULT                       | Python→中间件 |
 * | ui.render         | ACTIVITY_SNAPSHOT（兼容 @deprecated）  | Python→前端 |
 * | approval.request  | ACTIVITY_SNAPSHOT                      | Python→前端 |
 * | dispatch.trace    | CUSTOM（type=dispatch.trace）          | Python→前端 |
 * | error             | RUN_ERROR                              | Python→前端 |
 * | done              | RUN_FINISHED                           | Python→中间件 |
 *
 * 说明（与文档差异，均有依据）：
 * - 文档写 tool.call → TOOL_CALL_START + TOOL_CALL_CHUNK；实测 @ag-ui 协议
 *   流式参数事件为 `TOOL_CALL_ARGS`（delta 字段），中间件 processStream 只消费
 *   TOOL_CALL_START/TOOL_CALL_ARGS，故按实际协议发出 START + ARGS + END。
 * - 文档写 text.delta content → deltaText；实测字段名为 `delta`。
 * - 文档签名 `agentEventToBaseEvent(event, runId): BaseEvent`；因 tool.call 映射
 *   为多个事件，本实现返回 `AGUIEvent[]`（更精确的可构造类型，可赋给 BaseEvent）。
 * - @ag-ui 事件 `type` 字段为枚举成员类型（zod ZodLiteral<EventType.X> 推断），
 *   字面量字符串不可直接赋值，统一使用 `EventType.X` 枚举值构造。
 *
 * @module a2ui/EventConverter
 */

import { randomUUID } from 'node:crypto';
import {
  EventType,
  type ActivitySnapshotEvent,
  type AGUIEvent,
  type CustomEvent,
  type RunErrorEvent,
  type RunFinishedEvent,
  type TextMessageChunkEvent,
  type ToolCallArgsEvent,
  type ToolCallEndEvent,
  type ToolCallResultEvent,
  type ToolCallStartEvent,
} from '@ag-ui/client';
import type { AgentEvent } from '../channels/ChannelCapability.js';
import {
  A2UI_CATALOG_ID,
  type A2UICustomMessage,
  type A2UIDoneMessage,
  type A2UIErrorMessage,
  type A2UIFrontendMessage,
  type A2UIStreamMessage,
  type A2UISurfaceMessage,
  A2UI_PROTOCOL_VERSION,
} from './types.js';

// ============================================================================
// 常量
// ============================================================================

/** A2UI activityType（与中间件 A2UIActivityType 一致） */
const A2UI_ACTIVITY_TYPE = 'a2ui-surface';

/** A2UI operations 容器键（与中间件 A2UI_OPERATIONS_KEY 一致） */
const A2UI_OPERATIONS_KEY = 'a2ui_operations';

// ============================================================================
// 工具函数
// ============================================================================

/** 生成工具调用 ID（tool.call → tool.result 关联用） */
function newToolCallId(): string {
  return `tc-${randomUUID().slice(0, 8)}`;
}

/** 生成消息 ID */
function newMessageId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** 将未知值规整为 Record（dispatch.trace / CUSTOM 透传用） */
function asRecord(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

/** 从 ACTIVITY_SNAPSHOT content 中提取 a2ui_operations（无则返回 null） */
function extractOperations(content: Record<string, unknown>): A2UISurfaceMessage['operations'] | null {
  const ops = content[A2UI_OPERATIONS_KEY];
  if (Array.isArray(ops)) {
    return ops.filter(
      (op): op is Record<string, unknown> => op != null && typeof op === 'object' && !Array.isArray(op),
    );
  }
  return null;
}

// ============================================================================
// EventConverter
// ============================================================================

/**
 * AgentEvent ↔ BaseEvent 双向转换器。
 *
 * 职责：
 * 1. `agentEventToBaseEvent`：Python/Gateway AgentEvent → AG-UI BaseEvent 数组
 *    （方向 A，供 RedisStreamAgent 推入 Observable）。
 * 2. `baseEventToFrontendMessage`：BaseEvent → 前端 SSE/WS 消息（方向 B，
 *    A2UIRuntime 过滤后下发）。
 * 3. `toAgentEvent`：BaseEvent → AgentEvent（H5Adapter.send 兼容，供旧协议消费）。
 */
export class EventConverter {
  /** runId → toolCallId FIFO（tool.call 按序入队，tool.result 按序出队关联） */
  private readonly toolCallIdQueues = new Map<string, string[]>();

  /**
   * AgentEvent → BaseEvent（方向 A）。
   *
   * @param event - Agent 事件（Gateway 统一 camelCase）
   * @param runId - 当前 run 标识（AG-UI 协议锚点）
   * @param threadId - 会话线程标识（RUN_FINISHED 用；缺省取 runId）
   * @returns BaseEvent 数组（tool.call 展开为 START+ARGS+END）
   */
  agentEventToBaseEvent(event: AgentEvent, runId: string, threadId = runId): AGUIEvent[] {
    switch (event.type) {
      case 'text.delta':
        return [this.toTextMessageChunk(event, runId)];
      case 'tool.call':
        return this.toToolCallEvents(event, runId);
      case 'tool.result':
        return [this.toToolCallResult(event, runId)];
      case 'ui.render':
        return [this.uiRenderToActivitySnapshot(event, runId)];
      case 'approval.request':
        return [this.approvalRequestToActivitySnapshot(event, runId)];
      case 'dispatch.trace':
        return [this.toCustomDispatchTrace(event)];
      case 'error':
        return [this.toRunError(event)];
      case 'done':
        return [this.toRunFinished(event, runId, threadId)];
      default: {
        // 未知事件类型：安全忽略（不中断流），仅降级为 RUN_ERROR 提示。
        const err: RunErrorEvent = {
          type: EventType.RUN_ERROR,
          message: `Unknown AgentEvent type: ${String(event.type)}`,
          code: 'UNKNOWN_AGENT_EVENT',
        };
        return [err];
      }
    }
  }

  /**
   * BaseEvent → 前端 SSE/WS 消息（方向 B）。
   *
   * 仅下发前端可消费的事件：stream / a2ui_surface / done / error / custom。
   * 中间件内部事件（TOOL_CALL_* / RUN_STARTED / STATE_* / REASONING_*）与
   * 无 operations 的 lifecycle 骨架事件返回 null（不下发，由下发方跳过）。
   *
   * @param event - AG-UI BaseEvent
   * @returns 前端消息；无需下发时返回 null
   */
  baseEventToFrontendMessage(event: AGUIEvent): A2UIFrontendMessage | null {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_CHUNK: {
        const chunk = event as TextMessageChunkEvent;
        const message: A2UIStreamMessage = {
          type: 'stream',
          content: chunk.delta ?? '',
        };
        return message;
      }

      case EventType.ACTIVITY_SNAPSHOT: {
        const snapshot = event as ActivitySnapshotEvent;
        const operations = extractOperations(snapshot.content);
        if (operations == null) {
          // lifecycle 骨架（status: building/retrying/failed，无 operations）不下发，
          // 最终 painted surface 由带 operations 的 ACTIVITY_SNAPSHOT 承载。
          return null;
        }
        const message: A2UISurfaceMessage = {
          type: 'a2ui_surface',
          operations,
          runId: undefined,
          sessionId: undefined,
        };
        return message;
      }

      case EventType.RUN_FINISHED: {
        const done: A2UIDoneMessage = { type: 'done' };
        return done;
      }

      case EventType.RUN_ERROR: {
        const errEvent = event as RunErrorEvent;
        const message: A2UIErrorMessage = {
          type: 'error',
          errorCode: errEvent.code ?? 'RUN_ERROR',
          message: errEvent.message,
        };
        return message;
      }

      case EventType.CUSTOM: {
        const custom = event as CustomEvent;
        const message: A2UICustomMessage = {
          type: 'custom',
          eventType: custom.name,
          data: asRecord(custom.value),
        };
        return message;
      }

      default:
        // RUN_STARTED / TOOL_CALL_* / STATE_* / REASONING_* / ACTIVITY_DELTA 等
        // 为中间件内部或旧协议事件，不下发（新前端协议不含这些消息）。
        return null;
    }
  }

  /**
   * BaseEvent → AgentEvent（H5Adapter.send 兼容，旧协议消费方用）。
   *
   * 注意：A2UI 新前端走 `baseEventToFrontendMessage` + `H5Adapter.sendRaw`，
   * 本方法仅用于需要回退到旧 `agent_event` 封装协议的场景（如旧 H5 客户端）。
   *
   * @param event - AG-UI BaseEvent
   * @returns AgentEvent
   */
  toAgentEvent(event: AGUIEvent): AgentEvent {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_CHUNK: {
        const chunk = event as TextMessageChunkEvent;
        return { type: 'text.delta', content: chunk.delta ?? '' };
      }

      case EventType.ACTIVITY_SNAPSHOT: {
        const snapshot = event as ActivitySnapshotEvent;
        const operations = extractOperations(snapshot.content);
        return {
          type: 'ui.render',
          component: A2UI_ACTIVITY_TYPE,
          props: operations != null ? { [A2UI_OPERATIONS_KEY]: operations } : {},
        };
      }

      case EventType.RUN_FINISHED:
        return { type: 'done' };

      case EventType.RUN_ERROR: {
        const errEvent = event as RunErrorEvent;
        return {
          type: 'error',
          errorCode: errEvent.code ?? 'RUN_ERROR',
          errorMessage: errEvent.message,
        };
      }

      case EventType.CUSTOM: {
        const custom = event as CustomEvent;
        return { type: 'dispatch.trace', trace: asRecord(custom.value) };
      }

      case EventType.TOOL_CALL_START: {
        const start = event as ToolCallStartEvent;
        return { type: 'tool.call', toolName: start.toolCallName, args: {} };
      }

      case EventType.TOOL_CALL_RESULT:
        return { type: 'tool.result', toolName: '', result: {} };

      default:
        // RUN_STARTED / TOOL_CALL_ARGS / TOOL_CALL_END / STATE_* / REASONING_*
        // 无直接 AgentEvent 对应物，降级为 done（保持流可终止）。
        return { type: 'done' };
    }
  }

  // ============================================================================
  // 方向 A：AgentEvent → BaseEvent
  // ============================================================================

  /** text.delta → TEXT_MESSAGE_CHUNK */
  private toTextMessageChunk(event: AgentEvent, runId: string): TextMessageChunkEvent {
    return {
      type: EventType.TEXT_MESSAGE_CHUNK,
      // 同一 run 内稳定 messageId，保证前端将多个 chunk 追加到同一条消息。
      messageId: `msg-${runId}`,
      delta: event.content ?? '',
    };
  }

  /** tool.call → TOOL_CALL_START + TOOL_CALL_ARGS + TOOL_CALL_END */
  private toToolCallEvents(event: AgentEvent, runId: string): AGUIEvent[] {
    const toolName = event.toolName ?? '';
    const toolCallId = newToolCallId();
    // FIFO 入队：tool.result 按调用顺序出队关联（同名工具多次调用也可正确匹配）
    const queue = this.toolCallIdQueues.get(runId) ?? [];
    queue.push(toolCallId);
    this.toolCallIdQueues.set(runId, queue);

    const start: ToolCallStartEvent = {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: toolName,
    };

    const args: ToolCallArgsEvent = {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      // Python 产出的是完整 args 对象；一次性作为完整 delta 发出，
      // 中间件 extractCompleteItems 可从完整 JSON 中渐进提取组件。
      delta: JSON.stringify(event.args ?? {}),
    };

    const end: ToolCallEndEvent = {
      type: EventType.TOOL_CALL_END,
      toolCallId,
    };

    return [start, args, end];
  }

  /** tool.result → TOOL_CALL_RESULT（与 tool.call 的 toolCallId 关联） */
  private toToolCallResult(event: AgentEvent, runId: string): ToolCallResultEvent {
    const queue = this.toolCallIdQueues.get(runId) ?? [];
    const toolCallId = queue.shift() ?? newToolCallId();
    if (queue.length === 0) {
      this.toolCallIdQueues.delete(runId);
    }
    return {
      type: EventType.TOOL_CALL_RESULT,
      messageId: newMessageId(`msg-${runId}`),
      toolCallId,
      content: JSON.stringify(event.result ?? {}),
    };
  }

  /** ui.render → ACTIVITY_SNAPSHOT（迁移期兼容，@deprecated） */
  private uiRenderToActivitySnapshot(event: AgentEvent, runId: string): ActivitySnapshotEvent {
    const surfaceId = `legacy-${runId}`;
    const componentName = event.component ?? 'Text';
    const component: Record<string, unknown> = {
      id: 'root',
      component: componentName,
      ...(event.props ?? {}),
    };
    return {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: `a2ui-surface-${runId}-legacy`,
      activityType: A2UI_ACTIVITY_TYPE,
      content: {
        [A2UI_OPERATIONS_KEY]: [
          {
            version: A2UI_PROTOCOL_VERSION,
            createSurface: { surfaceId, catalogId: A2UI_CATALOG_ID },
          },
          {
            version: A2UI_PROTOCOL_VERSION,
            updateComponents: { surfaceId, components: [component] },
          },
        ],
      },
      replace: true,
    };
  }

  /** approval.request → ACTIVITY_SNAPSHOT（审批卡片作为 A2UI Surface 渲染） */
  private approvalRequestToActivitySnapshot(
    event: AgentEvent,
    runId: string,
  ): ActivitySnapshotEvent {
    const surfaceId = `approval-${runId}`;
    const detail = event.detail ?? {};
    const component: Record<string, unknown> = {
      id: 'root',
      component: 'approval-card',
      approvalId: String(detail['approvalId'] ?? ''),
      title: String(detail['title'] ?? '审批请求'),
      description: String(detail['description'] ?? ''),
      status: String(detail['status'] ?? 'pending'),
      ...(event.skillId != null ? { skillId: event.skillId } : {}),
      detail,
    };
    return {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: `a2ui-surface-${runId}-approval`,
      activityType: A2UI_ACTIVITY_TYPE,
      content: {
        [A2UI_OPERATIONS_KEY]: [
          {
            version: A2UI_PROTOCOL_VERSION,
            createSurface: { surfaceId, catalogId: A2UI_CATALOG_ID },
          },
          {
            version: A2UI_PROTOCOL_VERSION,
            updateComponents: { surfaceId, components: [component] },
          },
        ],
      },
      replace: true,
    };
  }

  /** dispatch.trace → CUSTOM（技能分发/调试追踪透传） */
  private toCustomDispatchTrace(event: AgentEvent): CustomEvent {
    return {
      type: EventType.CUSTOM,
      name: 'dispatch.trace',
      value: event.trace ?? {},
    };
  }

  /** error → RUN_ERROR（错误终止当前 run） */
  private toRunError(event: AgentEvent): RunErrorEvent {
    return {
      type: EventType.RUN_ERROR,
      message: event.errorMessage ?? event.errorCode ?? 'Agent error',
      ...(event.errorCode != null ? { code: event.errorCode } : {}),
    };
  }

  /** done → RUN_FINISHED（触发中间件 flush pending A2UI） */
  private toRunFinished(event: AgentEvent, runId: string, threadId: string): RunFinishedEvent {
    void event;
    return {
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
    };
  }
}
