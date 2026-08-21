/**
 * RedisStreamAgent.ts — AbstractAgent 适配器（Redis Streams → Observable<BaseEvent>）
 *
 * 将私有 Redis Streams 事件流适配为 AG-UI 协议（01-architecture.md §2.1）。
 * AG-UI 官方无 Redis transport（HttpAgent 仅 HTTP/SSE），本项目 Agent 在 Python 侧、
 * 经私有 Redis Streams 通信（`aip:stream:inbound:{channel}` / `aip:outbound:{sessionId}`），
 * 因此按官方 Middleware Pattern 标准扩展点（AbstractAgent）自研薄适配。
 *
 * 职责：
 * 1. 接收 RunAgentInput（已被中间件修改，含 render_a2ui 工具 + Schema）
 * 2. 序列化为 InboundMessage（messageType = `a2ui_run`，完整 RunAgentInput 放入
 *    metadata.a2ui）写入 Agent Core 入站流（复用 MessageRouter 流名/亲和键约定）
 * 3. 订阅 `aip:outbound:{sessionId}` 事件流（02 §6 时序图：Python 将 A2UI run
 *    的 AgentEvent XADD 到该会话私有流）
 * 4. 逐事件经 EventConverter 转 BaseEvent 推入 Observable
 * 5. 收到 done / error 后 complete Observable
 *
 * 订阅时序（较 01 §2.1 伪码的修正）：先启动出站订阅（`$` 起点），再写入站消息，
 * 消除「Python 极速回包早于订阅起点」的竞态窗口。
 *
 * @module a2ui/RedisStreamAgent
 */

import { Observable } from 'rxjs';
import { AbstractAgent, type RunAgentInput, type AGUIEvent } from '@ag-ui/client';
import type { Redis } from 'ioredis';
import type { AgentEvent } from '../channels/ChannelCapability.js';
import { MessageRouter, type RouteResult } from '../router/MessageRouter.js';
import type { InboundMessage } from '../queue/redisStream.js';
import { StreamProducer } from '../queue/redisStream.js';
import { parseBackendAgentEvent } from '../router/agentEventParser.js';
import { EventConverter } from './EventConverter.js';
import {
  A2UI_CATALOG_ID,
  A2UI_RUN_MESSAGE_TYPE,
  type A2uiInboundMeta,
  outboundStreamKey,
} from './types.js';
import { logger } from '../middleware/logger.js';

// ============================================================================
// 常量
// ============================================================================

/** 单轮 XREAD 最大条数 */
const XREAD_COUNT = 64;
/** XREAD 阻塞时长（毫秒）；超时后空转续读 */
const XREAD_BLOCK_MS = 5000;

// ============================================================================
// 类型定义
// ============================================================================

/** RedisStreamAgent 构造参数 */
export interface RedisStreamAgentParams {
  /** Redis 客户端（业务连接，XADD + XREAD 同连接） */
  redis: Redis;
  /** 会话 ID（决定出站流键 aip:outbound:{sessionId} 与入站 sessionId） */
  sessionId: string;
  /** 用户 ID（**仅来自 JWT 验签结果**，P4：绝不信消息体/工具里的 userId） */
  userId: string;
  /** 消息路由器（复用流名/亲和键约定；缺省直接写渠道入站流） */
  messageRouter?: MessageRouter;
  /** 事件转换器（可注入以复用 toolCallId 关联；缺省新建） */
  eventConverter?: EventConverter;
}

// ============================================================================
// RedisStreamAgent
// ============================================================================

/**
 * AbstractAgent 适配器：将 Redis Streams 事件流包装为 AG-UI Observable<BaseEvent>。
 */
export class RedisStreamAgent extends AbstractAgent {
  private readonly redis: Redis;
  private readonly sessionId: string;
  private readonly userId: string;
  private readonly messageRouter: MessageRouter | null;
  private readonly eventConverter: EventConverter;

  constructor(params: RedisStreamAgentParams) {
    super({
      description: 'Redis Streams agent (MIS private transport)',
      threadId: params.sessionId,
    });
    this.redis = params.redis;
    this.sessionId = params.sessionId;
    this.userId = params.userId;
    this.messageRouter = params.messageRouter ?? null;
    this.eventConverter = params.eventConverter ?? new EventConverter();
  }

  /**
   * 运行 Agent：写入入站消息并订阅出站流，将事件转为 Observable。
   *
   * @param input - RunAgentInput（中间件处理后的输入，含 render_a2ui 工具 + Schema）
   * @returns Observable<BaseEvent>
   */
  run(input: RunAgentInput): Observable<AGUIEvent> {
    return new Observable<AGUIEvent>((subscriber) => {
      let closed = false;

      // 订阅端：关闭/退订时终止 XREAD 循环
      const isClosed = (): boolean => closed;
      const teardown = (): void => {
        if (!closed) {
          closed = true;
          logger.debug(
            { sessionId: this.sessionId, runId: input.runId },
            'RedisStreamAgent subscription closed',
          );
        }
      };

      const onNext = (event: AGUIEvent): void => {
        if (!closed) {
          subscriber.next(event);
        }
      };
      const onComplete = (): void => {
        if (!closed) {
          closed = true;
          subscriber.complete();
        }
      };
      const onError = (error: Error): void => {
        if (!closed) {
          closed = true;
          subscriber.error(error);
        }
      };

      // 1) 先启动出站订阅（$ 起点 = 只收此后消息），再写 inbound（消除竞态）。
      this.subscribeToOutputStream(input.runId, onNext, onComplete, onError, isClosed).catch(
        (error: unknown) => {
          onError(error instanceof Error ? error : new Error(String(error)));
        },
      );

      // 2) 写入 Agent Core 入站流
      void this.sendToPython(input).catch((error: unknown) => {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            sessionId: this.sessionId,
            runId: input.runId,
          },
          'RedisStreamAgent failed to send inbound message',
        );
        onError(error instanceof Error ? error : new Error(String(error)));
      });

      // 3) 返回 teardown（Observable 退订时终止订阅循环）
      return teardown;
    });
  }

  // ============================================================================
  // 入站：RunAgentInput → InboundMessage → Redis Stream
  // ============================================================================

  /**
   * 将 RunAgentInput 序列化为 InboundMessage 并写入 Agent Core 入站流。
   *
   * 复用 MessageRouter 的流名/亲和键约定：会话已绑定 agent → `aip:stream:agent:{agentId}`，
   * 未绑定 → `aip:stream:inbound:{channel}`（AgentRouter 决策）。
   *
   * @param input - RunAgentInput
   * @returns 路由结果
   */
  private async sendToPython(input: RunAgentInput): Promise<RouteResult> {
    const meta: A2uiInboundMeta = {
      runId: input.runId,
      catalogId: A2UI_CATALOG_ID,
      runAgentInput: input as unknown as Record<string, unknown>,
    };

    const inbound: InboundMessage = MessageRouter.createInboundMessage({
      userId: this.userId,
      channel: 'h5',
      content: this.extractUserText(input),
      sessionId: this.sessionId,
      traceId: input.runId,
      messageType: A2UI_RUN_MESSAGE_TYPE,
      metadata: { a2ui: meta },
    });

    if (this.messageRouter != null) {
      const result = await this.messageRouter.route(inbound);
      logger.info(
        {
          runId: input.runId,
          sessionId: this.sessionId,
          messageType: A2UI_RUN_MESSAGE_TYPE,
          streamKey: result.streamKey,
          agentId: result.agentId,
        },
        'A2UI run inbound routed to Agent Core',
      );
      return result;
    }

    // 无 MessageRouter（降级）：直接写渠道入站流
    const streamKey = StreamProducer.getInboundStreamKey('h5');
    const messageId = await new StreamProducer(this.redis).produce(streamKey, inbound);
    logger.info(
      { runId: input.runId, sessionId: this.sessionId, streamKey, messageId },
      'A2UI run inbound produced to channel stream (fallback)',
    );
    return {
      messageId,
      sessionId: this.sessionId,
      streamKey,
      agentId: null,
      channel: 'h5',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 从 RunAgentInput.messages 提取最后一条用户文本（入站 content 可读性用）。
   *
   * @param input - RunAgentInput
   * @returns 用户文本（无则空串）
   */
  private extractUserText(input: RunAgentInput): string {
    const messages = input.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role === 'user' && typeof message['content'] === 'string') {
        return message['content'] as string;
      }
    }
    return '';
  }

  // ============================================================================
  // 出站：订阅 aip:outbound:{sessionId} → BaseEvent
  // ============================================================================

  /**
   * 订阅 `aip:outbound:{sessionId}` 事件流，逐事件转换后回调。
   *
   * XREAD（非消费者组）：会话私有流，单消费者，`$` 起点仅收新消息；
   * BLOCK 超时空转续读直到 complete/error/teardown（isClosed）。
   *
   * @param runId - 当前 run 标识
   * @param onNext - 单事件回调
   * @param onComplete - done/error 时终止
   * @param onError - 流读取失败
   * @param isClosed - 外部关闭信号（Observable 退订 / error 后置 true）
   */
  private async subscribeToOutputStream(
    runId: string,
    onNext: (event: AGUIEvent) => void,
    onComplete: () => void,
    onError: (error: Error) => void,
    isClosed: () => boolean,
  ): Promise<void> {
    const streamKey = outboundStreamKey(this.sessionId);
    // 订阅起点：$（只收订阅之后的 A2UI run 回包）
    let lastId = '$';
    let terminated = false;

    while (!terminated && !isClosed()) {
      try {
        const result = await this.redis.xread(
          'COUNT',
          XREAD_COUNT.toString(),
          'BLOCK',
          XREAD_BLOCK_MS.toString(),
          'STREAMS',
          streamKey,
          lastId,
        );

        // BLOCK 超时返回 null → 空转续读（teardown 通过 terminated 退出）
        if (result == null) {
          continue;
        }

        for (const [, messages] of result as Array<[string, Array<[string, string[]]>]>) {
          for (const [messageId, fields] of messages) {
            lastId = messageId;
            const fieldObj = fieldsToRecord(fields);
            const eventJson = fieldObj['event'] ?? fieldObj['eventJson'];
            if (eventJson == null || eventJson.length === 0) {
              continue;
            }

            const agentEvent: AgentEvent = parseBackendAgentEvent(eventJson);
            const baseEvents = this.eventConverter.agentEventToBaseEvent(
              agentEvent,
              runId,
              this.threadId,
            );
            for (const baseEvent of baseEvents) {
              onNext(baseEvent);
            }

            // done / error 为终止事件：发出后 complete
            if (agentEvent.type === 'done' || agentEvent.type === 'error') {
              terminated = true;
              onComplete();
              return;
            }
          }
        }
      } catch (error) {
        if (!terminated) {
          terminated = true;
          onError(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
    }
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 将 Redis Stream 扁平字段数组转换为对象。
 *
 * @param fields - 偶数长度扁平键值数组（[key1, val1, key2, val2, ...]）
 * @returns 字段对象
 */
function fieldsToRecord(fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    if (key != null && key.length > 0) {
      record[key] = fields[i + 1] ?? '';
    }
  }
  return record;
}
