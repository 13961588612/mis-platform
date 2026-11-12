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
 * <p>R47 多宿主广播（01-architecture.md §5.5）：
 * 同一 sessionId 允许多个端（hostId 维度，如 mis-admin-web / crm-web / supply-chain-web）
 * 同时连接；`send` / `sendRaw` 向该会话**所有**连接广播（Surface 同步）；
 * 每次注册新连接时从 Redis List（`aip:session:{sid}:a2ui:replay`，最近 N 条）重放
 * A2UI surface 操作，实现「新端加入 / 离线重连 → 当前界面状态自愈」。
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
import { sessionA2uiReplayKey, sessionGatewayKey } from '../../cluster/ownership.js';
import { logger } from '../../middleware/logger.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 默认宿主标识（管理后台自身；iframe 宿主显式传 hostId）。 */
export const DEFAULT_HOST_ID = 'mis-admin-web';

/** A2UI surface 操作重放上限（Redis List 保留最近 N 条，R47）。 */
export const A2UI_REPLAY_LIMIT = 50;

/** 单个会话连接端点（同 sessionId 多端，hostId+clientId 双维度）。 */
export interface SessionEndpoint {
  /** 宿主标识（如 mis-admin-web / crm-web / supply-chain-web）。 */
  hostId: string;
  /** 连接端标识（同一宿主可开多 Tab，clientId 唯一）。 */
  clientId: string;
  /** 连接模式。 */
  mode: 'ws' | 'sse';
  /** WebSocket 连接（mode=ws）。 */
  ws?: WebSocket;
  /** SSE 连接（mode=sse）。 */
  reply?: FastifyReply;
  /** 连接建立时间（ISO 8601）。 */
  connectedAt: string;
}

/** 注册连接时的可选元信息（R47：hostId / clientId）。 */
export interface ConnectionOptions {
  /** 宿主标识，缺省 DEFAULT_HOST_ID。 */
  hostId?: string;
  /** 连接端标识，缺省随机 UUID。 */
  clientId?: string;
}

/** 注册时绑定到连接对象上的连接标识（WS socket / SSE reply）。 */
export interface BoundConnectionIdentity {
  /** 连接端标识（buildEndpoint 解析后：显式 clientId 或随机 UUID）。 */
  a2uiClientId?: string;
  /** 宿主标识（buildEndpoint 解析后：显式 hostId 或 DEFAULT_HOST_ID）。 */
  a2uiHostId?: string;
}

/** 连接对象上 clientId 绑定属性名。 */
const BOUND_CLIENT_ID_KEY = 'a2uiClientId';
/** 连接对象上 hostId 绑定属性名。 */
const BOUND_HOST_ID_KEY = 'a2uiHostId';

/**
 * 读取绑定在连接对象上的 clientId（WS socket / SSE reply）。
 *
 * <p>BUG-1 修复（R47）：注册时 H5Adapter 把解析后的 clientId（显式 query.clientId
 * 或随机 UUID）绑定到连接对象，close handler 从连接对象读取，**不依赖 query.clientId**——
 * 真实前端（ws-client / sse-client）连接 query 不带 clientId，缺省会误删同会话全部端点。
 *
 * @param connection - WebSocket 连接或 FastifyReply（SSE）
 * @returns 绑定值；未绑定 / 空串返回 undefined
 */
export function getBoundClientId(connection: unknown): string | undefined {
  if (connection == null || typeof connection !== 'object') {
    return undefined;
  }
  const value = (connection as Record<string, unknown>)[BOUND_CLIENT_ID_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 读取绑定在连接对象上的 hostId（WS socket / SSE reply）。
 *
 * @param connection - WebSocket 连接或 FastifyReply（SSE）
 * @returns 绑定值；未绑定 / 空串返回 undefined
 */
export function getBoundHostId(connection: unknown): string | undefined {
  if (connection == null || typeof connection !== 'object') {
    return undefined;
  }
  const value = (connection as Record<string, unknown>)[BOUND_HOST_ID_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 活跃的会话连接注册表：sessionId → (hostId:clientId → endpoint) */
type SessionConnectionMap = Map<string, Map<string, SessionEndpoint>>;

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
 *
 * R47 之后连接注册表从「sessionId → 单连接」升级为
 * 「sessionId → {hostId:clientId → endpoint}」多宿主广播。
 */
export class H5Adapter {
  private readonly capability: H5Capability;
  /** Redis 客户端（写 aip:session:{sid}:gateway + aip:session:{sid}:a2ui:replay；可选，未注入则降级为进程内） */
  private _redis: Redis | null = null;
  /** 粘滞映射 TTL（秒）；与 design § key 表一致（3600） */
  private readonly gatewaySessionTtlSec = 3600;
  /** 会话连接注册表（R47：同 sessionId 多端广播）。 */
  private readonly sessionConnections: SessionConnectionMap = new Map();

  constructor() {
    this.capability = new H5Capability();
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
   * 发送 AgentEvent 到 H5 前端（同 sessionId 所有连接广播）。
   *
   * 独立 H5 渠道支持流式输出和 Generative UI，AgentEvent 原样透传。
   * R47：向该会话全部端（多宿主）广播；无连接时告警（不缓存旧协议事件）。
   *
   * @param event - Agent 事件
   * @param sessionId - 目标会话 ID
   */
  async send(event: AgentEvent, sessionId: string): Promise<void> {
    const endpoints = this.getSessionEndpoints(sessionId);
    if (endpoints.length === 0) {
      logger.warn(
        { sessionId, eventType: event.type },
        'No active connection found for session',
      );
      return;
    }
    for (const endpoint of endpoints) {
      if (endpoint.mode === 'ws' && endpoint.ws != null) {
        this.streamEvent(event, endpoint.ws);
      } else if (endpoint.mode === 'sse' && endpoint.reply != null) {
        this.sendSseEvent(event, endpoint.reply);
      }
    }
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
   * 发送新协议前端消息（A2UI 链路，直接下发不做 agent_event 封装）。
   *
   * A2UIRuntime 将 BaseEvent 转换为前端消息（a2ui_surface / stream / done /
   * error / custom）后，经本方法原样推送。R47：向该会话**所有**连接广播；
   * `a2ui_surface` 同时写入 Redis List（最近 N 条），供新端加入 / 离线重连重放。
   *
   * @param message - 前端消息对象
   * @param sessionId - 目标会话 ID
   */
  async sendRaw(message: Record<string, unknown>, sessionId: string): Promise<void> {
    const endpoints = this.getSessionEndpoints(sessionId);
    if (endpoints.length > 0) {
      for (const endpoint of endpoints) {
        if (endpoint.mode === 'ws' && endpoint.ws != null) {
          this.streamRaw(message, endpoint.ws);
        } else if (endpoint.mode === 'sse' && endpoint.reply != null) {
          this.sendSseRaw(message, endpoint.reply);
        }
      }
    } else {
      logger.warn(
        { sessionId, messageType: message['type'] },
        'No active connection found for session (sendRaw)',
      );
    }

    // A2UI surface 操作缓存（离线也缓存：Agent 产出时客户端已断开，重连后重放）
    if (message['type'] === 'a2ui_surface') {
      await this.cacheA2uiSurface(sessionId, message);
    }
  }

  /**
   * 通过 WebSocket 原样推送前端消息（不封装 agent_event）。
   *
   * @param message - 前端消息对象
   * @param ws - WebSocket 连接
   */
  private streamRaw(message: Record<string, unknown>, ws: WebSocket): void {
    if (ws.readyState !== ws.OPEN) {
      logger.warn(
        { readyState: ws.readyState },
        'WebSocket not in OPEN state, skipping raw message',
      );
      return;
    }
    ws.send(JSON.stringify(message));
    logger.debug(
      { messageType: message['type'] },
      'Raw message streamed via WebSocket',
    );
  }

  /**
   * 通过 SSE 原样推送前端消息（不封装 agent_event）。
   *
   * @param message - 前端消息对象
   * @param reply - Fastify Reply 对象
   */
  private sendSseRaw(message: Record<string, unknown>, reply: FastifyReply): void {
    reply.raw.write(`data: ${JSON.stringify(message)}\n\n`);
    logger.debug(
      { messageType: message['type'] },
      'Raw message sent via SSE',
    );
  }

  /**
   * 注入 Redis 客户端（写 aip:session:{sid}:gateway + aip:session:{sid}:a2ui:replay）。
   *
   * @param redis - Redis 客户端
   */
  bindRedis(redis: Redis): void {
    this._redis = redis;
  }

  /**
   * 注册 WebSocket 连接，并写粘滞映射 aip:session:{sid}:gateway（修 N5）。
   *
   * R47：同一 sessionId 允许多端（hostId 维度）；新连接注册后立即从 Redis List
   * 重放最近 N 条 A2UI surface 操作（新端加入即获得当前界面状态）。
   *
   * @param sessionId - 会话 ID（客户端回传的稳定 sessionId）
   * @param ws - WebSocket 连接
   * @param gatewayId - 本 Gateway 稳定 ID（写入映射值，TTL 3600）
   * @param opts - 可选：hostId（宿主标识）/ clientId（连接端标识）
   */
  async registerWsConnection(
    sessionId: string,
    ws: WebSocket,
    gatewayId: string,
    opts?: ConnectionOptions,
  ): Promise<void> {
    const endpoint = this.buildEndpoint('ws', opts);
    endpoint.ws = ws;
    this.addEndpoint(sessionId, endpoint);
    // BUG-1 修复：clientId/hostId 绑定到连接对象，close 时从连接对象取（不依赖 query.clientId）
    this.bindConnectionIdentity(ws, endpoint);
    await this.persistSessionGateway(sessionId, gatewayId);
    logger.info(
      { sessionId, hostId: endpoint.hostId, clientId: endpoint.clientId, gatewayId, totalConnections: this.getConnectionCount() },
      'WebSocket connection registered',
    );
    await this.replayA2uiToEndpoint(sessionId, endpoint);
  }

  /**
   * 注销 WebSocket 连接；最后一个端点离开时删除粘滞映射。
   *
   * <p>BUG-1 修复：clientId 必填（close handler 从连接对象取绑定值），
   * 空串 / 未匹配一律 no-op，**不再有「缺省删除该会话全部端点」的分支**，
   * 杜绝多端同会话时误删其它端（R47 广播中断）。hostId 可选，提供时精确匹配。
   *
   * @param sessionId - 会话 ID
   * @param clientId - 连接端标识（必填；buildEndpoint 解析后的实际值）
   * @param hostId - 宿主标识（可选；提供时按 hostId:clientId 精确 key 匹配）
   */
  async unregisterWsConnection(sessionId: string, clientId: string, hostId?: string): Promise<void> {
    const removed = this.removeEndpoint(sessionId, clientId, hostId);
    if (removed == null) {
      logger.debug({ sessionId, clientId, hostId }, 'WS connection unregister: endpoint not found');
      return;
    }
    if (!this.sessionConnections.has(sessionId)) {
      await this.clearSessionGateway(sessionId);
    }
    logger.info(
      { sessionId, hostId: removed.hostId, clientId: removed.clientId, totalConnections: this.getConnectionCount() },
      'WebSocket connection unregistered',
    );
  }

  /**
   * 注册 SSE 连接，并写粘滞映射 aip:session:{sid}:gateway（H5 SSE 同属粘滞范畴）。
   *
   * @param sessionId - 会话 ID
   * @param reply - Fastify Reply 对象
   * @param gatewayId - 本 Gateway 稳定 ID（可选，未提供则不写映射）
   * @param opts - 可选：hostId（宿主标识）/ clientId（连接端标识）
   */
  async registerSseConnection(
    sessionId: string,
    reply: FastifyReply,
    gatewayId?: string,
    opts?: ConnectionOptions,
  ): Promise<void> {
    // 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const endpoint = this.buildEndpoint('sse', opts);
    endpoint.reply = reply;
    this.addEndpoint(sessionId, endpoint);
    // BUG-1 修复：clientId/hostId 绑定到 reply 对象，close 时从连接对象取（不依赖 query.clientId）
    this.bindConnectionIdentity(reply, endpoint);
    if (gatewayId != null && gatewayId.length > 0) {
      await this.persistSessionGateway(sessionId, gatewayId);
    }
    logger.info(
      { sessionId, hostId: endpoint.hostId, clientId: endpoint.clientId, gatewayId, totalConnections: this.getConnectionCount() },
      'SSE connection registered',
    );
    await this.replayA2uiToEndpoint(sessionId, endpoint);
  }

  /**
   * 注销 SSE 连接；最后一个端点离开时删除粘滞映射。
   *
   * <p>BUG-1 修复：clientId 必填（close handler 从连接对象取绑定值），
   * 空串 / 未匹配一律 no-op，**不再有「缺省删除该会话全部端点」的分支**。
   *
   * @param sessionId - 会话 ID
   * @param clientId - 连接端标识（必填；buildEndpoint 解析后的实际值）
   * @param hostId - 宿主标识（可选；提供时按 hostId:clientId 精确 key 匹配）
   */
  async unregisterSseConnection(sessionId: string, clientId: string, hostId?: string): Promise<void> {
    const removed = this.removeEndpoint(sessionId, clientId, hostId);
    if (removed == null) {
      logger.debug({ sessionId, clientId, hostId }, 'SSE connection unregister: endpoint not found');
      return;
    }
    if (removed.mode === 'sse' && removed.reply != null) {
      removed.reply.raw.end();
    }
    if (!this.sessionConnections.has(sessionId)) {
      await this.clearSessionGateway(sessionId);
    }
    logger.info(
      { sessionId, hostId: removed.hostId, clientId: removed.clientId, totalConnections: this.getConnectionCount() },
      'SSE connection unregistered',
    );
  }

  // ============================================================================
  // 内部：会话连接注册表（R47）
  // ============================================================================

  /**
   * 构建会话连接端点（hostId 缺省 mis-admin-web；clientId 缺省随机 UUID）。
   */
  private buildEndpoint(mode: 'ws' | 'sse', opts?: ConnectionOptions): SessionEndpoint {
    const hostId = opts?.hostId != null && opts.hostId.length > 0 ? opts.hostId : DEFAULT_HOST_ID;
    const clientId = opts?.clientId != null && opts.clientId.length > 0 ? opts.clientId : randomUUID();
    return { hostId, clientId, mode, connectedAt: new Date().toISOString() };
  }

  /**
   * 将端点标识绑定到连接对象（注册时写入；close handler 从连接对象读取）。
   *
   * <p>BUG-1 修复（R47）：close 时从连接对象取实际 clientId/hostId，不依赖
   * query.clientId——真实前端连接 query 不带 clientId，缺省会误删同会话全部端点。
   *
   * @param connection - WebSocket 连接或 FastifyReply（SSE）
   * @param endpoint - 已解析的端点（clientId 为实际注册值）
   */
  private bindConnectionIdentity(
    connection: WebSocket | FastifyReply,
    endpoint: SessionEndpoint,
  ): void {
    const target = connection as unknown as Record<string, unknown>;
    target[BOUND_CLIENT_ID_KEY] = endpoint.clientId;
    target[BOUND_HOST_ID_KEY] = endpoint.hostId;
  }

  /** 端点 key（hostId:clientId）。 */
  private endpointKey(hostId: string, clientId: string): string {
    return `${hostId}:${clientId}`;
  }

  /** 将端点加入会话注册表（同 hostId+clientId 重复注册视为覆盖）。 */
  private addEndpoint(sessionId: string, endpoint: SessionEndpoint): void {
    let map = this.sessionConnections.get(sessionId);
    if (map == null) {
      map = new Map();
      this.sessionConnections.set(sessionId, map);
    }
    map.set(this.endpointKey(endpoint.hostId, endpoint.clientId), endpoint);
  }

  /**
   * 从会话注册表移除指定端点。
   *
   * <p>BUG-1 修复：clientId 必填，**不再有「缺省删除该会话全部端点」的分支**——
   * 空串 / 未匹配一律返回 null（no-op），杜绝误删同会话其它端（R47 广播中断）。
   * hostId 可选：提供时按 hostId:clientId 精确 key 匹配（hostId 维度生效）；
   * 缺省退化为 clientId 扫描（兼容显式 clientId 的旧调用）。
   *
   * @param sessionId - 会话 ID
   * @param clientId - 连接端标识（必填；空串视为不匹配）
   * @param hostId - 宿主标识（可选；提供时精确匹配）
   * @returns 被移除的端点，无则 null
   */
  private removeEndpoint(sessionId: string, clientId: string, hostId?: string): SessionEndpoint | null {
    if (clientId.length === 0) {
      return null;
    }
    const map = this.sessionConnections.get(sessionId);
    if (map == null) {
      return null;
    }
    if (hostId != null && hostId.length > 0) {
      const key = this.endpointKey(hostId, clientId);
      const endpoint = map.get(key);
      if (endpoint == null) {
        return null;
      }
      map.delete(key);
      if (map.size === 0) {
        this.sessionConnections.delete(sessionId);
      }
      return endpoint;
    }
    for (const [key, endpoint] of map) {
      if (endpoint.clientId === clientId) {
        map.delete(key);
        if (map.size === 0) {
          this.sessionConnections.delete(sessionId);
        }
        return endpoint;
      }
    }
    return null;
  }

  /**
   * 获取会话当前全部连接端点（按注册顺序）。
   *
   * @param sessionId - 会话 ID
   */
  getSessionEndpoints(sessionId: string): SessionEndpoint[] {
    const map = this.sessionConnections.get(sessionId);
    return map == null ? [] : [...map.values()];
  }

  /**
   * 缓存 A2UI surface 操作到 Redis List（最近 N 条，离线重连重放）。
   *
   * @param sessionId - 会话 ID
   * @param message - 前端消息（a2ui_surface）
   */
  private async cacheA2uiSurface(sessionId: string, message: Record<string, unknown>): Promise<void> {
    if (this._redis == null || sessionId.length === 0) {
      return;
    }
    try {
      const key = sessionA2uiReplayKey(sessionId);
      const pipeline = this._redis.multi();
      pipeline.rpush(key, JSON.stringify(message));
      pipeline.ltrim(key, -A2UI_REPLAY_LIMIT, -1);
      await pipeline.exec();
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        },
        'Failed to cache A2UI surface for replay',
      );
    }
  }

  /**
   * 向单个端点重放最近缓存的 A2UI surface 操作（新端加入 / 离线重连）。
   *
   * @param sessionId - 会话 ID
   * @param endpoint - 目标端点（只推送给该端点，不广播）
   */
  private async replayA2uiToEndpoint(sessionId: string, endpoint: SessionEndpoint): Promise<void> {
    if (this._redis == null || sessionId.length === 0) {
      return;
    }
    try {
      const key = sessionA2uiReplayKey(sessionId);
      const raw = await this._redis.lrange(key, 0, -1);
      if (raw == null || raw.length === 0) {
        return;
      }
      let replayed = 0;
      for (const item of raw) {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(item) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (endpoint.mode === 'ws' && endpoint.ws != null) {
          this.streamRaw(message, endpoint.ws);
        } else if (endpoint.mode === 'sse' && endpoint.reply != null) {
          this.sendSseRaw(message, endpoint.reply);
        }
        replayed += 1;
      }
      logger.info(
        { sessionId, hostId: endpoint.hostId, clientId: endpoint.clientId, replayed },
        'A2UI surface replay delivered to endpoint',
      );
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        },
        'Failed to replay A2UI surfaces to endpoint',
      );
    }
  }

  // ============================================================================
  // 粘滞映射（修 N5）
  // ============================================================================

  /**
   * 写粘滞映射 aip:session:{sid}:gateway = gatewayId（TTL 3600）。
   *
   * Redis 不可用 / 未注入时静默降级（进程内连接查找仍可用，仅跨 gateway 粘滞失效）。
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
   * 删除粘滞映射 aip:session:{sid}:gateway（最后一个连接关闭 / 重连换 gateway 时）。
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

  // ============================================================================
  // 生命周期与诊断
  // ============================================================================

  /**
   * 获取活跃连接数（所有会话的所有端点）
   * @returns 总活跃连接数
   */
  getConnectionCount(): number {
    let total = 0;
    for (const map of this.sessionConnections.values()) {
      total += map.size;
    }
    return total;
  }

  /**
   * 关闭所有连接
   */
  closeAllConnections(): void {
    for (const map of this.sessionConnections.values()) {
      for (const endpoint of map.values()) {
        if (endpoint.mode === 'ws' && endpoint.ws != null) {
          if (endpoint.ws.readyState === endpoint.ws.OPEN) {
            endpoint.ws.close(1001, 'Server shutting down');
          }
        } else if (endpoint.mode === 'sse' && endpoint.reply != null) {
          endpoint.reply.raw.end();
        }
      }
    }
    this.sessionConnections.clear();

    logger.info('All H5 connections closed');
  }

  /**
   * 检查会话是否有活跃连接
   * @param sessionId - 会话 ID
   * @returns 是否有活跃连接
   */
  hasActiveConnection(sessionId: string): boolean {
    const map = this.sessionConnections.get(sessionId);
    if (map == null) {
      return false;
    }
    for (const endpoint of map.values()) {
      if (endpoint.mode === 'ws' && endpoint.ws != null && endpoint.ws.readyState === endpoint.ws.OPEN) {
        return true;
      }
      if (endpoint.mode === 'sse' && endpoint.reply != null) {
        return true;
      }
    }
    return false;
  }
}
