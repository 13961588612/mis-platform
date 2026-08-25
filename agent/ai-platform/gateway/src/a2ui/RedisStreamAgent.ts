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
 * 订阅时序（消除竞态）：
 * 1. 校验业务 Redis 可用；
 * 2. 快照出站流 tip（XREVRANGE）；
 * 3. 写入站消息；
 * 4. **独立连接** XREAD（BLOCK）从 tip 之后读。
 * 避免「业务连接被 BLOCK 占满」与「fire-and-forget + `$` 丢帧」。
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

      // 出站 XREAD BLOCK 必须用独立连接（与 index.ts redisConsumer 同理），
      // 避免占满业务连接导致 XADD/路由排队，也避免断线后误用已 end 的连接。
      let reader: Redis | null = null;

      // 1) 校验业务 Redis → 2) tip 快照 → 3) 写入站 → 4) 独立连接 XREAD
      void (async () => {
        try {
          await assertRedisReady(this.redis, 'business');

          const streamKey = outboundStreamKey(this.sessionId);
          const tip = await this.redis.xrevrange(streamKey, '+', '-', 'COUNT', 1);
          const startAfterId =
            tip.length > 0 && tip[0] != null && typeof tip[0][0] === 'string'
              ? tip[0][0]
              : '0-0';

          await this.sendToPython(input);

          reader = this.redis.duplicate();
          await waitUntilReady(reader, 'a2ui-outbound-reader');

          await this.subscribeToOutputStream(
            reader,
            input.runId,
            onNext,
            onComplete,
            onError,
            isClosed,
            startAfterId,
          );
        } catch (error: unknown) {
          logger.error(
            {
              error: error instanceof Error ? error.message : String(error),
              sessionId: this.sessionId,
              runId: input.runId,
              redisStatus: this.redis.status,
            },
            'RedisStreamAgent run failed',
          );
          onError(error instanceof Error ? error : new Error(String(error)));
        } finally {
          if (reader != null) {
            try {
              reader.disconnect();
            } catch {
              // ignore disconnect errors on teardown
            }
            reader = null;
          }
        }
      })();

      // 返回 teardown（Observable 退订时终止订阅循环；finally 会 disconnect reader）
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

    // MIS RS256：Gateway 已将 JWT sub → userId（真 MIS userId）。显式写入
    // misUserId，供 Agent Core 入站解析直取（避免按企微 userid 查库失败）。
    const misUserId =
      /^\d+$/.test(this.userId.trim()) && Number(this.userId) > 0
        ? this.userId.trim()
        : undefined;

    const inbound: InboundMessage = MessageRouter.createInboundMessage({
      userId: this.userId,
      channel: 'h5',
      content: this.extractUserText(input),
      sessionId: this.sessionId,
      traceId: input.runId,
      messageType: A2UI_RUN_MESSAGE_TYPE,
      metadata: {
        a2ui: meta,
        ...(misUserId != null ? { misUserId } : {}),
      },
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
   * XREAD（非消费者组）：会话私有流，单消费者；从 {@code startAfterId} 之后读，
   * 只收本 run 写入站后的新回包（由调用方先 snapshot tip 再 send inbound）。
   *
   * @param reader - 专用 Redis 连接（仅本 run 的 BLOCK XREAD，勿复用业务连接）
   * @param runId - 当前 run 标识
   * @param onNext - 单事件回调
   * @param onComplete - done/error 时终止
   * @param onError - 流读取失败
   * @param isClosed - 外部关闭信号（Observable 退订 / error 后置 true）
   * @param startAfterId - XREAD 起点（不含该 id）；缺省 `'0-0'`
   */
  private async subscribeToOutputStream(
    reader: Redis,
    runId: string,
    onNext: (event: AGUIEvent) => void,
    onComplete: () => void,
    onError: (error: Error) => void,
    isClosed: () => boolean,
    startAfterId = '0-0',
  ): Promise<void> {
    const streamKey = outboundStreamKey(this.sessionId);
    let lastId = startAfterId;
    let terminated = false;

    while (!terminated && !isClosed()) {
      try {
        const result = await reader.xread(
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

/**
 * 断言 Redis 业务连接可用；长期运行的 Gateway 若重试耗尽会停在 end/close，
 * 此时 WS ping 仍正常，但 A2UI 一碰 Redis 就会报「Connection is closed.」。
 */
async function assertRedisReady(redis: Redis, label: string): Promise<void> {
  if (redis.status === 'ready') {
    return;
  }
  if (redis.status === 'connecting' || redis.status === 'connect') {
    await waitUntilReady(redis, label);
    return;
  }
  throw new Error(
    `Gateway Redis（${label}）不可用（status=${redis.status}）。` +
      `请重启 AI Gateway 进程；若反复出现，检查 REDIS_URL 与网络。`,
  );
}

/** 等待 duplicate()/新建连接进入 ready（超时则抛错）。 */
async function waitUntilReady(redis: Redis, label: string, timeoutMs = 10_000): Promise<void> {
  if (redis.status === 'ready') {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis（${label}）就绪超时（status=${redis.status}）`));
    }, timeoutMs);
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('error', onError);
    };
    redis.once('ready', onReady);
    redis.once('error', onError);
  });
}
