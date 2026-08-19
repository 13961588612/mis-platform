/**
 * H5Adapter.ts — H5 WebSocket/SSE 适配器
 *
 * 实现独立 H5 渠道的消息收发：
 * - WebSocket 消息接收
 * - AgentEvent 流式推送（SSE/WebSocket）
 * - 会话管理
 *
 * 能力：流式输出 ✅ | 自定义 UI ✅ | 文件上传 ✅ | Markdown FULL | 消息长度 8192
 *
 * @module adapters/h5/H5Adapter
 */

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyReply } from 'fastify';
import type { AgentEvent, ChannelCapability } from '../../channels/ChannelCapability.js';
import { H5Capability } from '../../channels/ChannelCapability.js';
import type { InboundMessage } from '../../queue/redisStream.js';
import { sessionGatewayKey } from '../../cluster/ownership.js';
import { logger } from '../../middleware/logger.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 活跃的 WebSocket 连接映射 */
type ConnectionMap = Map<string, WebSocket>;

/** 活跃的 SSE 连接映射 */
type SseConnectionMap = Map<string, FastifyReply>;

// ============================================================================
// H5Adapter
// ============================================================================

/**
 * H5 WebSocket/SSE 适配器
 *
 * 实现 ChannelAdapter 接口，负责独立 H5 渠道的消息收发。
 * 支持两种推送模式：
 * - WebSocket：双向实时通信
 * - SSE (Server-Sent Events)：单向流式推送
 */
export class H5Adapter {
  private readonly capability: H5Capability;
  private readonly wsConnections: ConnectionMap;
  private readonly sseConnections: SseConnectionMap;
  /** Redis 客户端（写 aip:session:{sid}:gateway；可选，未注入则粘滞映射降级为进程内） */
  private _redis: Redis | null = null;
  /** 粘滞映射 TTL（秒）；与 design § key 表一致（3600） */
  private readonly gatewaySessionTtlSec = 3600;

  constructor() {
    this.capability = new H5Capability();
    this.wsConnections = new Map();
    this.sseConnections = new Map();
  }

  /**
   * 获取渠道能力声明
   * @returns 渠道能力
   */
  getCapability(): ChannelCapability {
    return this.capability;
  }

  /**
   * 接收原始 WebSocket 消息，解析为标准入站消息
   *
   * @param rawMessage - 原始消息
   * @param userId - 用户 ID（从 JWT 中获取）
   * @param sessionId - 会话 ID
   * @returns 标准入站消息
   */
  receive(
    rawMessage: {
      content: string;
      messageType?: string;
      metadata?: Record<string, unknown>;
    },
    userId: string,
    sessionId: string,
  ): InboundMessage {
    return {
      id: randomUUID(),
      sessionId,
      userId,
      channelUserId: userId,
      channel: 'h5',
      content: rawMessage.content,
      messageType: rawMessage.messageType ?? 'text',
      traceId: randomUUID(),
      timestamp: new Date().toISOString(),
      ...(rawMessage.metadata != null ? { metadata: rawMessage.metadata } : {}),
    };
  }

  /**
   * 发送 AgentEvent 到 H5 前端（WebSocket 推送）
   *
   * 独立 H5 渠道支持流式输出和 Generative UI，
   * AgentEvent 原样透传给前端 CopilotKit 渲染。
   *
   * @param event - Agent 事件
   * @param sessionId - 目标会话 ID
   */
  async send(event: AgentEvent, sessionId: string): Promise<void> {
    const ws = this.wsConnections.get(sessionId);
    if (ws != null) {
      this.streamEvent(event, ws);
      return;
    }

    // 尝试 SSE 推送
    const reply = this.sseConnections.get(sessionId);
    if (reply != null) {
      this.sendSseEvent(event, reply);
      return;
    }

    logger.warn(
      { sessionId, eventType: event.type },
      'No active connection found for session',
    );
  }

  /**
   * 流式推送事件（WebSocket）
   *
   * 通过 WebSocket 发送流式事件，前端逐帧渲染。
   *
   * @param event - Agent 事件
   * @param ws - WebSocket 连接
   */
  streamEvent(event: AgentEvent, ws: WebSocket): void {
    if (ws.readyState !== ws.OPEN) {
      logger.warn(
        { readyState: ws.readyState },
        'WebSocket not in OPEN state, skipping event',
      );
      return;
    }

    const message = JSON.stringify({
      type: 'agent_event',
      event,
      timestamp: new Date().toISOString(),
    });

    ws.send(message);

    logger.debug(
      { eventType: event.type },
      'Event streamed via WebSocket',
    );
  }

  /**
   * 通过 SSE 推送事件
   *
   * @param event - Agent 事件
   * @param reply - Fastify Reply 对象
   */
  sendSseEvent(event: AgentEvent, reply: FastifyReply): void {
    const data = JSON.stringify({
      type: 'agent_event',
      event,
      timestamp: new Date().toISOString(),
    });

    reply.raw.write(`data: ${data}\n\n`);

    logger.debug(
      { eventType: event.type },
      'Event sent via SSE',
    );
  }

  /**
   * 注入 Redis 客户端（写 aip:session:{sid}:gateway）。
   *
   * @param redis - Redis 客户端
   */
  bindRedis(redis: Redis): void {
    this._redis = redis;
  }

  /**
   * 注册 WebSocket 连接，并写粘滞映射 aip:session:{sid}:gateway（修 N5）。
   *
   * 客户端持久化 sessionId 并回传；连接建立即记录「该会话 WS 落在哪个 gateway」，
   * 供 Core 出站按 session→gateway 精准定向（重连换 gateway 时覆盖写）。
   *
   * @param sessionId - 会话 ID（客户端回传的稳定 sessionId）
   * @param ws - WebSocket 连接
   * @param gatewayId - 本 Gateway 稳定 ID（写入映射值，TTL 3600）
   */
  async registerWsConnection(
    sessionId: string,
    ws: WebSocket,
    gatewayId: string,
  ): Promise<void> {
    this.wsConnections.set(sessionId, ws);
    await this.persistSessionGateway(sessionId, gatewayId);
    logger.info(
      { sessionId, gatewayId, totalWsConnections: this.wsConnections.size },
      'WebSocket connection registered',
    );
  }

  /**
   * 注销 WebSocket 连接，并删除粘滞映射。
   *
   * @param sessionId - 会话 ID
   */
  async unregisterWsConnection(sessionId: string): Promise<void> {
    this.wsConnections.delete(sessionId);
    await this.clearSessionGateway(sessionId);
    logger.info(
      { sessionId, totalWsConnections: this.wsConnections.size },
      'WebSocket connection unregistered',
    );
  }

  /**
   * 注册 SSE 连接，并写粘滞映射 aip:session:{sid}:gateway（H5 SSE 同属粘滞范畴）。
   *
   * @param sessionId - 会话 ID
   * @param reply - Fastify Reply 对象
   * @param gatewayId - 本 Gateway 稳定 ID（可选，未提供则不写映射）
   */
  async registerSseConnection(
    sessionId: string,
    reply: FastifyReply,
    gatewayId?: string,
  ): Promise<void> {
    // 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    this.sseConnections.set(sessionId, reply);
    if (gatewayId != null && gatewayId.length > 0) {
      await this.persistSessionGateway(sessionId, gatewayId);
    }
    logger.info(
      { sessionId, gatewayId, totalSseConnections: this.sseConnections.size },
      'SSE connection registered',
    );
  }

  /**
   * 注销 SSE 连接，并删除粘滞映射。
   *
   * @param sessionId - 会话 ID
   */
  async unregisterSseConnection(sessionId: string): Promise<void> {
    const reply = this.sseConnections.get(sessionId);
    if (reply != null) {
      reply.raw.end();
    }
    this.sseConnections.delete(sessionId);
    await this.clearSessionGateway(sessionId);
    logger.info(
      { sessionId, totalSseConnections: this.sseConnections.size },
      'SSE connection unregistered',
    );
  }

  /**
   * 写粘滞映射 aip:session:{sid}:gateway = gatewayId（TTL 3600）。
   *
   * Redis 不可用 / 未注入时静默降级（进程内 WS 查找仍可用，仅跨 gateway 粘滞失效）。
   *
   * @param sessionId - 会话 ID
   * @param gatewayId - 本 Gateway 稳定 ID
   */
  private async persistSessionGateway(sessionId: string, gatewayId: string): Promise<void> {
    if (this._redis == null || sessionId.length === 0 || gatewayId.length === 0) {
      return;
    }
    try {
      await this._redis.set(
        sessionGatewayKey(sessionId),
        gatewayId,
        'EX',
        this.gatewaySessionTtlSec,
      );
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
          gatewayId,
        },
        'Failed to persist session->gateway mapping to Redis',
      );
    }
  }

  /**
   * 删除粘滞映射 aip:session:{sid}:gateway（连接关闭 / 重连换 gateway 时）。
   *
   * @param sessionId - 会话 ID
   */
  private async clearSessionGateway(sessionId: string): Promise<void> {
    if (this._redis == null || sessionId.length === 0) {
      return;
    }
    try {
      await this._redis.del(sessionGatewayKey(sessionId));
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        },
        'Failed to clear session->gateway mapping from Redis',
      );
    }
  }

  /**
   * 获取活跃连接数（WebSocket + SSE）
   * @returns 总活跃连接数
   */
  getConnectionCount(): number {
    return this.wsConnections.size + this.sseConnections.size;
  }

  /**
   * 关闭所有连接
   */
  closeAllConnections(): void {
    // 关闭 WebSocket 连接
    for (const [, ws] of this.wsConnections) {
      if (ws.readyState === ws.OPEN) {
        ws.close(1001, 'Server shutting down');
      }
    }
    this.wsConnections.clear();

    // 关闭 SSE 连接
    for (const [, reply] of this.sseConnections) {
      reply.raw.end();
    }
    this.sseConnections.clear();

    logger.info('All H5 connections closed');
  }

  /**
   * 检查会话是否有活跃连接
   * @param sessionId - 会话 ID
   * @returns 是否有活跃连接
   */
  hasActiveConnection(sessionId: string): boolean {
    const ws = this.wsConnections.get(sessionId);
    if (ws != null && ws.readyState === ws.OPEN) {
      return true;
    }

    return this.sseConnections.has(sessionId);
  }
}
