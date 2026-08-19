/**
 * redisStream.ts — Redis Streams 生产/消费
 *
 * 实现 Gateway 与 Agent Core 之间的异步消息传递：
 * - 生产者：将渠道入站消息写入 Redis Stream
 * - 消费者：消费 Agent Core 返回的 AgentEvent 流
 *
 * 阶段 A 扩展（T3/T5）：
 * - `StreamProducer.getOutboundStreamKey(gwId)` / `getPendingOutboundStreamKey()`：
 *   per-owner 出站 stream 键（`aip:stream:gw:{gwId}:events` / 兜底
 *   `aip:stream:gw:pending:events`），与 Agent Core 端对称。
 * - `StreamConsumer`：支持订阅多 stream（接管时 drain 旧 owner 的流），
 *   新增 `attachStream` / `drainAndClaim` / `reclaimLoop`（周期 XAUTOCLAIM 重投
 *   PEL 孤儿消息，修 N1），保证 Gateway 崩溃后孤儿事件恰好一次重投。
 *
 * Stream 命名规范：
 * - 入站消息流：stream:inbound:{channel}
 * - Agent 事件流：stream:agent:{agentId}
 * - 出站事件流（per-owner）：stream:gw:{gatewayId}:events
 *
 * @module queue/redisStream
 */

import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { logger } from '../middleware/logger.js';

// agent Redis 键统一命名空间前缀（与 Agent Core redis-py 端 `aip:` 一致）。
// 共享 Redis 实例下避免与 MIS(`mis:`)键冲突；db index 已做物理隔离。
const REDIS_KEY_PREFIX = process.env['REDIS_KEY_PREFIX'] ?? 'aip:';

// ============================================================================
// 类型定义
// ============================================================================

/** 入站消息结构 */
export interface InboundMessage {
  /** 消息 ID（UUID） */
  id: string;
  /** 会话 ID */
  sessionId: string;
  /** 用户 ID（平台侧统一用户标识） */
  userId: string;
  /** 用户手机号（可选） */
  userMobile?: string;
  /** 渠道侧给出的 userId（如企微 userid） */
  channelUserId?: string;
  /** 渠道类型 */
  channel: string;
  /** Agent ID（可选，路由后填充） */
  agentId?: string;
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  messageType: string;
  /** 追踪 ID */
  traceId: string;
  /** 时间戳（ISO 8601） */
  timestamp: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** AgentEvent 类型（出站事件流） */
  eventType?: string;
  /** AgentEvent JSON（出站事件流，Backend snake_case） */
  eventJson?: string;
  /** 表单填充 HITL 的 resumeToken（entity_select 入站） */
  resumeToken?: string;
  /** 用户选择的候选实体（entity_select 入站，JSON 对象） */
  selectedCandidate?: Record<string, unknown>;
  /** 选择动作：confirm | manual | cancel */
  action?: string;
}

/** Stream 消息字段 */
export type StreamMessage = Record<string, string>;

/** 消费回调类型 */
export type ConsumeCallback = (message: InboundMessage) => Promise<void>;

/**
 * `xreadgroup` 返回的一批流结果（ioredis 无重载多参调用时类型退化为 unknown）。
 *
 * 结构：`[[streamKey, [[messageId, fields[]], ...]], ...]`
 * 只在 `consumeLoop` 消费侧使用，`fields` 为偶数长度的扁平键值数组。
 */
type XReadGroupStream = [string, Array<[string, string[]]>];

// ============================================================================
// 常量
// ============================================================================

const MAX_STREAM_LENGTH = 10000;
const CONSUMER_BLOCK_MS = 5000;
/** 单次 XAUTOCLAIM 重投批大小 */
const RECLAIM_BATCH = 100;

// ============================================================================
// Stream 生产者
// ============================================================================

/**
 * Redis Stream 生产者
 *
 * 将渠道入站消息写入 Redis Stream，供 Agent Core 异步消费。
 */
export class StreamProducer {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * 将入站消息写入 Stream
   *
   * @param streamKey - Stream 键名（如 stream:agent:{agentId}）
   * @param message - 入站消息
   * @returns Stream 消息 ID
   */
  async produce(streamKey: string, message: InboundMessage): Promise<string> {
    const fields: StreamMessage = {
      id: message.id,
      sessionId: message.sessionId,
      userId: message.userId,
      channel: message.channel,
      content: message.content,
      messageType: message.messageType,
      traceId: message.traceId,
      timestamp: message.timestamp,
      ...(message.userMobile != null && message.userMobile.length > 0
        ? { userMobile: message.userMobile }
        : {}),
      ...(message.channelUserId != null && message.channelUserId.length > 0
        ? { channelUserId: message.channelUserId }
        : {}),
      ...(message.agentId != null ? { agentId: message.agentId } : {}),
      ...(message.metadata != null
        ? { metadata: JSON.stringify(message.metadata) }
        : {}),
      ...(message.resumeToken != null && message.resumeToken.length > 0
        ? { resumeToken: message.resumeToken }
        : {}),
      ...(message.selectedCandidate != null
        ? { selectedCandidate: JSON.stringify(message.selectedCandidate) }
        : {}),
      ...(message.action != null && message.action.length > 0
        ? { action: message.action }
        : {}),
    };

    const messageId = await this.redis.xadd(
      streamKey,
      'MAXLEN', '~', MAX_STREAM_LENGTH.toString(),
      '*',
      ...Object.entries(fields).flat(),
    );

    if (messageId == null) {
      throw new Error(`Failed to produce message to stream: ${streamKey}`);
    }

    logger.debug(
      { streamKey, messageId, sessionId: message.sessionId },
      'Message produced to stream',
    );

    return messageId;
  }

  /**
   * 构造入站消息 Stream 键名
   * @param channel - 渠道类型
   * @returns Stream 键名
   */
  static getInboundStreamKey(channel: string): string {
    return `${REDIS_KEY_PREFIX}stream:inbound:${channel}`;
  }

  /**
   * 构造 Agent 事件 Stream 键名
   * @param agentId - Agent ID
   * @returns Stream 键名
   */
  static getAgentStreamKey(agentId: string): string {
    return `${REDIS_KEY_PREFIX}stream:agent:${agentId}`;
  }

  /**
   * 构造 per-owner 出站事件 Stream 键名（与 Agent Core 端对称）。
   *
   * @param gatewayId - 持有该会话 Bot 的 owner Gateway ID
   * @returns `aip:stream:gw:{gatewayId}:events`
   */
  static getOutboundStreamKey(gatewayId: string): string {
    return `${REDIS_KEY_PREFIX}stream:gw:${gatewayId}:events`;
  }

  /**
   * 构造兜底出站事件 Stream 键名（owner 解析失败时使用）。
   *
   * @returns `aip:stream:gw:pending:events`
   */
  static getPendingOutboundStreamKey(): string {
    return `${REDIS_KEY_PREFIX}stream:gw:pending:events`;
  }
}

// ============================================================================
// Entity-Select 入站构造（T05 表单填充 HITL 回调）
// ============================================================================

/**
 * 构造一条 entity_select 入站消息（企微按钮点击 / H5 提交回调）。
 *
 * 解析自 wecom 按钮回调的 ``task_id``（=resumeToken）与 ``event_key``
 * （=candidateId | "manual" | "cancel"）后，由调用方构造此消息并路由至
 * Redis 入站流，后端据此续跑表单填充。
 *
 * @param params - 入站参数
 * @returns 标准 InboundMessage（messageType = "entity_select"）
 */
export function buildEntitySelectInbound(params: {
  sessionId: string;
  userId: string;
  channel: string;
  resumeToken: string;
  selectedCandidate?: Record<string, unknown>;
  action?: string;
  traceId?: string;
  channelUserId?: string;
  metadata?: Record<string, unknown>;
}): InboundMessage {
  return {
    id: randomUUID(),
    sessionId: params.sessionId,
    userId: params.userId,
    channel: params.channel,
    content: '',
    messageType: 'entity_select',
    traceId: params.traceId ?? randomUUID(),
    timestamp: new Date().toISOString(),
    resumeToken: params.resumeToken,
    selectedCandidate: params.selectedCandidate,
    action: params.action,
    ...(params.channelUserId != null ? { channelUserId: params.channelUserId } : {}),
    ...(params.metadata != null ? { metadata: params.metadata } : {}),
  };
}

// ============================================================================
// Stream 消费者
// ============================================================================

/**
 * Redis Stream 消费者（支持 per-owner 出站流 + 崩溃重投）。
 *
 * 阻塞式消费 Redis Stream 中的消息，支持消费者组；并支持：
 * - 订阅多 stream（故障转移接管时追加旧 owner 的流，`attachStream`）；
 * - 周期 XAUTOCLAIM 重投本/接管 stream 的 PEL 孤儿消息（`reclaimLoop`，修 N1）；
 * - 对指定旧消费组做 XAUTOCLAIM 接管（`drainAndClaim`，故障转移 drain）。
 */
export class StreamConsumer {
  private readonly redis: Redis;
  private readonly groupName: string;
  private readonly consumerName: string;
  private running = false;
  private currentTimeout: NodeJS.Timeout | undefined;
  /** 消费回调（reclaim 重投复用同一回调） */
  private callback: ConsumeCallback | null = null;
  /** streamKey → 所属消费组（不同 stream 可能属于不同组，如接管旧 owner 流） */
  private readonly streamGroups = new Map<string, string>();
  /** 崩溃重投配置：间隔(ms)，<=0 表示关闭 */
  private reclaimIntervalMs = 0;
  /** 孤儿消息进入重投的最小 idle(ms) */
  private minIdleMs = 30000;
  /** 重投循环是否已启动 */
  private reclaimStarted = false;

  constructor(
    redis: Redis,
    groupName = 'gateway-group',
    consumerName = `gateway-${process.pid}`,
  ) {
    this.redis = redis;
    this.groupName = groupName;
    this.consumerName = consumerName;
  }

  /**
   * 启动消费循环。
   *
   * @param streamKey - 主订阅 Stream 键名
   * @param callback - 消费回调
   */
  async start(streamKey: string, callback: ConsumeCallback): Promise<void> {
    this.callback = callback;
    this.registerStream(streamKey, this.groupName);

    this.running = true;
    await this.ensureConsumerGroupFor(streamKey, this.groupName);

    logger.info(
      { streamKey, groupName: this.groupName, consumerName: this.consumerName },
      'Starting stream consumer',
    );

    this.consumeLoop().catch((error) => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), streamKey },
        'Consumer loop error',
      );
    });
    this.maybeStartReclaim();
  }

  /**
   * 停止消费（含重投循环，依靠 running 标志自然退出）。
   */
  stop(): void {
    this.running = false;
    if (this.currentTimeout != null) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = undefined;
    }
    logger.info('Stream consumer stopped');
  }

  /**
   * 动态追加订阅流（故障转移接管时追加旧 owner 的 stream）。
   *
   * @param streamKey - 追加的 Stream 键名
   * @param groupName - 该 stream 所属消费组（默认本消费者组）
   */
  async attachStream(streamKey: string, groupName: string = this.groupName): Promise<void> {
    this.registerStream(streamKey, groupName);
    await this.ensureConsumerGroupFor(streamKey, groupName);
    logger.info(
      { streamKey, groupName, consumerName: this.consumerName },
      'Attached additional stream to consumer',
    );
  }

  /**
   * 对指定旧消费组做 XAUTOCLAIM 接管（Gateway 故障转移 drain 旧 owner PEL）。
   *
   * 将旧 owner 的 stream 追加进订阅，并立即执行一次重投，把旧 owner 崩溃遗留的
   * PEL 孤儿消息重投到本消费者重新处理；随后 `reclaimLoop` 周期性兜底。
   *
   * @param oldStreamKey - 旧 owner 的 Stream 键名（如 `aip:stream:gw:A:events`）
   * @param oldGroup - 旧 owner 的消费组名（如 `gw-A`）
   */
  async drainAndClaim(oldStreamKey: string, oldGroup: string): Promise<void> {
    await this.attachStream(oldStreamKey, oldGroup);
    await this.reclaimStream(oldStreamKey, oldGroup);
    logger.info(
      { oldStreamKey, oldGroup, consumerName: this.consumerName },
      'Drained and claimed orphaned PEL from previous owner stream',
    );
  }

  /**
   * 启用崩溃重投循环（N1）。可于 `start` 之后调用。
   *
   * @param intervalMs - 重投周期（毫秒）
   * @param minIdleMs - 孤儿消息最小 idle 阈值（毫秒）
   */
  enableReclaim(intervalMs: number, minIdleMs: number): void {
    this.reclaimIntervalMs = intervalMs;
    this.minIdleMs = minIdleMs;
    this.maybeStartReclaim();
  }

  /**
   * 确保消费者组存在（指定组名）。
   */
  private async ensureConsumerGroupFor(streamKey: string, groupName: string): Promise<void> {
    try {
      await this.redis.xgroup(
        'CREATE',
        streamKey,
        groupName,
        '$',
        'MKSTREAM',
      );
      logger.info(
        { streamKey, groupName },
        'Consumer group created',
      );
    } catch (error) {
      // 消费者组已存在是正常情况
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  /**
   * 记录 stream → group 订阅关系（去重）。
   */
  private registerStream(streamKey: string, groupName: string): void {
    this.streamGroups.set(streamKey, groupName);
  }

  /**
   * 若已 running 且未启动过，启动重投循环。
   */
  private maybeStartReclaim(): void {
    if (this.running && this.reclaimIntervalMs > 0 && !this.reclaimStarted) {
      this.reclaimStarted = true;
      void this.reclaimLoop();
    }
  }

  /**
   * 主消费循环：按消费组分批读取各订阅 stream 的新消息。
   */
  private async consumeLoop(): Promise<void> {
    while (this.running) {
      try {
        // 将订阅的 stream 按消费组归并，逐组发起 XREADGROUP（不同组不能合并读）。
        const groups = new Map<string, string[]>();
        for (const [streamKey, group] of this.streamGroups) {
          const arr = groups.get(group) ?? [];
          arr.push(streamKey);
          groups.set(group, arr);
        }

        for (const [group, streamKeys] of groups) {
          if (!this.running) {
            break;
          }
          // 每个 stream 对应一个 '>'（仅读新消息）；streams 与 ids 对齐。
          const readArgs: string[] = [];
          for (const key of streamKeys) {
            readArgs.push(key, '>');
          }
          const result = await this.redis.xreadgroup(
            'GROUP', group, this.consumerName,
            'COUNT', '1',
            'BLOCK', CONSUMER_BLOCK_MS.toString(),
            'STREAMS',
            ...readArgs,
          );

          if (result == null || result.length === 0) {
            continue;
          }

          const streams = result as XReadGroupStream[];
          for (const [streamKey, messages] of streams) {
            for (const [messageId, fields] of messages) {
              if (this.callback != null) {
                await this.processMessage(streamKey, messageId, fields, this.callback);
              }
            }
          }
        }
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          'Error consuming message',
        );
        // 短暂等待后重试
        await new Promise<void>((resolve) => {
          this.currentTimeout = setTimeout(resolve, 1000);
        });
      }
    }
  }

  /**
   * 崩溃重投循环（N1）：周期对订阅的各 stream 做 XAUTOCLAIM，把 PEL 中 idle
   * 超过阈值的孤儿消息重投到本消费者重新处理（恰好一次语义）。
   */
  private async reclaimLoop(): Promise<void> {
    logger.info(
      { intervalMs: this.reclaimIntervalMs, minIdleMs: this.minIdleMs, consumerName: this.consumerName },
      'Stream reclaim loop started',
    );
    while (this.running) {
      await new Promise<void>((resolve) => {
        this.currentTimeout = setTimeout(resolve, this.reclaimIntervalMs);
      });
      if (!this.running) {
        break;
      }
      for (const [streamKey, groupName] of this.streamGroups) {
        try {
          await this.reclaimStream(streamKey, groupName);
        } catch (error) {
          logger.error(
            {
              error: error instanceof Error ? error.message : String(error),
              streamKey,
              groupName,
            },
            'Stream reclaim pass failed',
          );
        }
      }
    }
    logger.info({ consumerName: this.consumerName }, 'Stream reclaim loop stopped');
  }

  /**
   * 对单个 stream 执行一次 XAUTOCLAIM 重投。
   *
   * @param streamKey - Stream 键名
   * @param groupName - 消费组名
   */
  private async reclaimStream(streamKey: string, groupName: string): Promise<void> {
    if (this.callback == null) {
      return;
    }
    const result = (await this.redis.xautoclaim(
      streamKey,
      groupName,
      this.consumerName,
      this.minIdleMs,
      '0-0',
      'COUNT',
      RECLAIM_BATCH,
    )) as unknown[];

    if (!Array.isArray(result) || result.length < 2) {
      return;
    }
    const claimed = result[1];
    if (!Array.isArray(claimed)) {
      return;
    }
    for (const entry of claimed) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }
      const messageId = String(entry[0]);
      const fields = entry[1] as string[];
      await this.processMessage(streamKey, messageId, fields, this.callback);
    }
  }

  /**
   * 处理单条消息（含正常消费与重投复用）。
   */
  private async processMessage(
    streamKey: string,
    messageId: string,
    fields: string[],
    callback: ConsumeCallback,
  ): Promise<void> {
    // 该 stream 所属的消费组（接管旧 owner 流时可能与默认组不同）。
    const group = this.streamGroups.get(streamKey) ?? this.groupName;
    try {
      // 将字段数组转换为对象
      const fieldObj: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i] ?? `field_${i}`;
        const value = fields[i + 1] ?? '';
        fieldObj[key] = value;
      }

      // 构造 InboundMessage
      const message: InboundMessage = {
        id: fieldObj['id'] ?? messageId,
        sessionId: fieldObj['sessionId'] ?? '',
        userId: fieldObj['userId'] ?? '',
        channel: fieldObj['channel'] ?? '',
        content: fieldObj['content'] ?? '',
        messageType: fieldObj['messageType'] ?? 'text',
        traceId: fieldObj['traceId'] ?? '',
        timestamp: fieldObj['timestamp'] ?? new Date().toISOString(),
        ...(fieldObj['userMobile'] != null && fieldObj['userMobile'].length > 0
          ? { userMobile: fieldObj['userMobile'] }
          : {}),
        ...(fieldObj['channelUserId'] != null && fieldObj['channelUserId'].length > 0
          ? { channelUserId: fieldObj['channelUserId'] }
          : {}),
        ...(fieldObj['agentId'] != null ? { agentId: fieldObj['agentId'] } : {}),
        ...(fieldObj['metadata'] != null
          ? { metadata: JSON.parse(fieldObj['metadata']) as Record<string, unknown> }
          : {}),
        ...(fieldObj['event'] != null ? { eventJson: fieldObj['event'] } : {}),
        ...(fieldObj['eventType'] != null ? { eventType: fieldObj['eventType'] } : {}),
      };

      // 执行回调
      await callback(message);

      // 确认消息
      await this.redis.xack(streamKey, group, messageId);

      logger.debug(
        { streamKey, group, messageId, sessionId: message.sessionId },
        'Message consumed and acknowledged',
      );
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          streamKey,
          group,
          messageId,
        },
        'Error processing message',
      );
      // 不确认消息，让其留在 PEL 中稍后由 reclaimLoop 重投。
    }
  }
}

// ============================================================================
// Stream 管理
// ============================================================================

/**
 * 获取 Stream 信息
 * @param redis - Redis 客户端
 * @param streamKey - Stream 键名
 * @returns Stream 信息
 */
export async function getStreamInfo(
  redis: Redis,
  streamKey: string,
): Promise<{
  length: number;
  groups: number;
  pending: number;
  lastEntryId: string;
}> {
  const info = (await redis.xinfo('STREAM', streamKey)) as unknown[];
  const infoObj: Record<string, unknown> = {};
  for (let i = 0; i < info.length; i += 2) {
    const key = info[i] as string;
    infoObj[key] = info[i + 1];
  }

  return {
    length: (infoObj['length'] as number) ?? 0,
    groups: (infoObj['groups'] as number) ?? 0,
    pending: (infoObj['pending'] as number) ?? 0,
    lastEntryId: (infoObj['last-entry'] as string) ?? '0-0',
  };
}

/**
 * 清理过期 Stream 消息
 * @param redis - Redis 客户端
 * @param streamKey - Stream 键名
 * @param maxLength - 最大保留长度
 */
export async function trimStream(
  redis: Redis,
  streamKey: string,
  maxLength = MAX_STREAM_LENGTH,
): Promise<number> {
  const trimmed = await redis.xtrim(streamKey, 'MAXLEN', '~', maxLength.toString());
  if (trimmed > 0) {
    logger.info(
      { streamKey, trimmed, maxLength },
      'Stream trimmed',
    );
  }
  return trimmed;
}
