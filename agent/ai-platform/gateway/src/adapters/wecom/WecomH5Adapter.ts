/**
 * WecomH5Adapter.ts — 企业微信 H5 适配器
 *
 * 实现企业微信 H5 渠道的消息收发：
 * - JS-SDK 鉴权配置下发
 * - WebSocket 消息接收
 * - AgentEvent 流式推送（SSE/WebSocket）
 * - 企业微信应用消息推送（通知引导 H5）
 *
 * @module adapters/wecom/WecomH5Adapter
 */

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { WebSocket } from '@fastify/websocket';
import type { AgentEvent, ChannelCapability } from '../../channels/ChannelCapability.js';
import { WecomH5Capability } from '../../channels/ChannelCapability.js';
import { WecomJSSDKHelper, type JsSdkSignature } from './WecomJSSDKHelper.js';
import { WecomAppMessage } from './WecomAppMessage.js';
import type { InboundMessage } from '../../queue/redisStream.js';
import { sessionGatewayKey } from '../../cluster/ownership.js';
import { logger } from '../../middleware/logger.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 企业微信 H5 适配器配置 */
export interface WecomH5AdapterConfig {
  /** 企业 ID */
  corpId: string;
  /** 应用 Agent ID */
  agentId: string;
  /** 应用 Secret */
  corpSecret: string;
  /** 企业微信 API 基础 URL */
  apiBaseUrl: string;
}

/** 活跃的 WebSocket 连接映射 */
type ConnectionMap = Map<string, WebSocket>;

// ============================================================================
// WecomH5Adapter
// ============================================================================

/**
 * 企业微信 H5 适配器
 *
 * 实现 ChannelAdapter 接口，负责企业微信 H5 渠道的消息收发。
 *
 * 能力：流式输出 ✅ | 自定义 UI ✅ | Markdown FULL | 消息长度 4096
 */
export class WecomH5Adapter {
  private readonly jsSdkHelper: WecomJSSDKHelper;
  private readonly appMessage: WecomAppMessage;
  private readonly capability: WecomH5Capability;
  private readonly connections: ConnectionMap;
  /** Redis 客户端（写 aip:session:{sid}:gateway；可选，未注入则粘滞映射降级为进程内） */
  private _redis: Redis | null = null;
  /** 粘滞映射 TTL（秒）；与 design § key 表一致（3600） */
  private readonly gatewaySessionTtlSec = 3600;

  constructor(config: WecomH5AdapterConfig) {
    this.jsSdkHelper = new WecomJSSDKHelper({
      corpId: config.corpId,
      agentId: config.agentId,
      corpSecret: config.corpSecret,
      apiBaseUrl: config.apiBaseUrl,
    });
    this.appMessage = new WecomAppMessage({
      corpId: config.corpId,
      agentId: config.agentId,
      corpSecret: config.corpSecret,
      apiBaseUrl: config.apiBaseUrl,
    });
    this.capability = new WecomH5Capability();
    this.connections = new Map();
  }

  /**
   * 获取渠道能力声明
   * @returns 渠道能力
   */
  getCapability(): ChannelCapability {
    return this.capability;
  }

  /**
   * 获取 JS-SDK 鉴权配置
   *
   * 前端 H5 页面加载时调用此方法，获取企业微信 JS-SDK 签名配置。
   *
   * @param url - 当前页面 URL（不含 # 及之后部分）
   * @returns JS-SDK 签名配置
   */
  async getJsSdkConfig(url: string): Promise<JsSdkSignature> {
    return this.jsSdkHelper.getJsSdkConfig(url);
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
    rawMessage: { content: string; messageType?: string; metadata?: Record<string, unknown> },
    userId: string,
    sessionId: string,
  ): InboundMessage {
    return {
      id: randomUUID(),
      sessionId,
      userId,
      channelUserId: userId,
      channel: 'wecom-h5',
      content: rawMessage.content,
      messageType: rawMessage.messageType ?? 'text',
      traceId: randomUUID(),
      timestamp: new Date().toISOString(),
      ...(rawMessage.metadata != null ? { metadata: rawMessage.metadata } : {}),
    };
  }

  /**
   * 发送 AgentEvent 到 H5 前端（WebSocket 流式推送）
   *
   * 企业微信 H5 渠道支持流式输出和 Generative UI，
   * AgentEvent 原样透传给前端 CopilotKit 渲染。
   *
   * @param event - Agent 事件
   * @param sessionId - 目标会话 ID
   */
  async send(event: AgentEvent, sessionId: string): Promise<void> {
    const ws = this.connections.get(sessionId);
    if (ws == null) {
      logger.warn(
        { sessionId, eventType: event.type },
        'WebSocket connection not found for session',
      );
      return;
    }

    if (ws.readyState !== ws.OPEN) {
      logger.warn(
        { sessionId, readyState: ws.readyState },
        'WebSocket not in OPEN state',
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
      { sessionId, eventType: event.type },
      'Event sent to H5 via WebSocket',
    );
  }

  /**
   * 流式推送事件（SSE 兼容）
   *
   * 通过 WebSocket 发送流式事件，前端逐帧渲染。
   *
   * @param event - Agent 事件
   * @param ws - WebSocket 连接
   */
  streamEvent(event: AgentEvent, ws: WebSocket): void {
    if (ws.readyState !== ws.OPEN) {
      return;
    }

    const message = JSON.stringify({
      type: 'stream',
      event,
      timestamp: new Date().toISOString(),
    });

    ws.send(message);
  }

  /**
   * 推送企业微信应用消息（通知引导 H5）
   *
   * 当需要主动通知用户时（如 HITL 审批），推送应用消息引导用户打开 H5。
   *
   * @param userId - 目标用户 ID
   * @param title - 消息标题
   * @param content - 消息内容
   * @param h5Url - H5 链接 URL
   */
  async pushAppMessage(
    userId: string,
    title: string,
    content: string,
    h5Url: string,
  ): Promise<string> {
    return this.appMessage.sendApprovalNotification(userId, title, content, h5Url);
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
   * @param sessionId - 会话 ID（本端点每次连接生成稳定 sessionId）
   * @param ws - WebSocket 连接
   * @param gatewayId - 本 Gateway 稳定 ID（写入映射值，TTL 3600）
   */
  async registerConnection(
    sessionId: string,
    ws: WebSocket,
    gatewayId: string,
  ): Promise<void> {
    this.connections.set(sessionId, ws);
    await this.persistSessionGateway(sessionId, gatewayId);
    logger.info(
      { sessionId, gatewayId, totalConnections: this.connections.size },
      'WebSocket connection registered',
    );
  }

  /**
   * 注销 WebSocket 连接，并删除粘滞映射。
   *
   * @param sessionId - 会话 ID
   */
  async unregisterConnection(sessionId: string): Promise<void> {
    this.connections.delete(sessionId);
    await this.clearSessionGateway(sessionId);
    logger.info(
      { sessionId, totalConnections: this.connections.size },
      'WebSocket connection unregistered',
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
   * 获取活跃连接数
   * @returns 活跃 WebSocket 连接数
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * 关闭所有连接
   */
  closeAllConnections(): void {
    for (const ws of this.connections.values()) {
      if (ws.readyState === ws.OPEN) {
        ws.close(1001, 'Server shutting down');
      }
    }
    this.connections.clear();
    logger.info('All WebSocket connections closed');
  }

  /**
   * 获取 JS-SDK Helper 实例
   * @returns JS-SDK Helper
   */
  getJsSdkHelper(): WecomJSSDKHelper {
    return this.jsSdkHelper;
  }

  /**
   * 获取应用消息推送实例
   * @returns 应用消息推送器
   */
  getAppMessage(): WecomAppMessage {
    return this.appMessage;
  }
}
