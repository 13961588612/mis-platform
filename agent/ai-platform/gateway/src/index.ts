/**
 * index.ts — Gateway 入口
 *
 * 启动 Message Gateway 服务：
 * 1. 从环境变量加载配置
 * 2. 创建 Redis 连接
 * 3. 创建并启动 Fastify 服务器
 * 4. 启动企业微信 Bot WebSocket 长连接
 * 5. 注册优雅关闭钩子
 *
 * @module index
 */

import 'dotenv/config';

import * as fs from 'node:fs';
import { Redis } from 'ioredis';
import { logger } from './middleware/logger.js';
import {
  createServer,
  startServer,
  shutdownServer,
  type GatewayServerConfig,
} from './server.js';
import { createBotConfigSourceFromEnv } from './config/botConfigSource.js';
import { StreamConsumer } from './queue/redisStream.js';
import type { InboundMessage } from './queue/redisStream.js';
import {
  parseBackendAgentEvent,
  toGatewayChannel,
} from './router/agentEventParser.js';

// agent Redis 键命名空间前缀（与 Agent Core redis-py 端 `aip:` 一致）。
const REDIS_KEY_PREFIX = process.env['REDIS_KEY_PREFIX'] ?? 'aip:';
const AGENT_EVENTS_STREAM = `${REDIS_KEY_PREFIX}stream:agent:events`;

/**
 * 读取 MIS JWT 公钥（PEM）。
 *
 * 未配置 `MIS_JWT_PUBLIC_KEY_PATH` 时返回 `undefined`，网关仅信任 agent 自有
 * HS256 JWT（向后兼容，不破坏 agent 登录链路）。配置后启用 RS256 验签，
 * 接受父系统（MIS）推来的嵌入令牌。
 *
 * @returns MIS 公钥 PEM 文本，或 undefined
 */
function loadMisJwtPublicKey(): string | undefined {
  const path = process.env['MIS_JWT_PUBLIC_KEY_PATH'];
  if (path == null || path === '') {
    return undefined;
  }
  try {
    return fs.readFileSync(path, 'utf-8');
  } catch (err) {
    logger.error(
      { path, error: err instanceof Error ? err.message : String(err) },
      'Failed to load MIS JWT public key',
    );
    return undefined;
  }
}

// ============================================================================
// 配置加载
// ============================================================================

/**
 * 从环境变量加载 Gateway 配置
 *
 * 环境变量：
 * - GATEWAY_PORT: 监听端口（默认 8080）
 * - GATEWAY_HOST: 监听地址（默认 0.0.0.0）
 * - REDIS_URL: Redis 连接 URL
 * - JWT_SECRET: JWT 签名密钥
 * - JWT_ISSUER: JWT 签发者（默认 ai-platform）
 * - WECOM_CORP_ID: 企业微信 CorpID
 * - WECOM_AGENT_ID: 企业微信应用 AgentID
 * - WECOM_SECRET: 企业微信应用 Secret
 * - WECOM_API_BASE_URL: 企业微信 API 基础 URL
 * - WECOM_BOT_CALLBACK_TOKEN: 企业微信 Bot 回调 Token（URL 回调模式）
 * - WECOM_BOT_ID: 智能机器人 BotID（长连接鉴权）
 * - WECOM_BOT_SECRET: 智能机器人长连接 Secret
 * - WECOM_BOT_WS_URL: 可选，默认 wss://openws.work.weixin.qq.com
 * - AGENT_CORE_API_URL: Agent Core API URL
 * - CORS_ORIGINS: CORS 允许的源（逗号分隔）
 *
 * @returns Gateway 配置
 */
function loadConfig(): GatewayServerConfig {
  // 核心必填：Redis + JWT。企微自建应用凭证仅 H5 需要，可留空。
  const requiredEnvVars = ['REDIS_URL', 'JWT_SECRET'];
  for (const envVar of requiredEnvVars) {
    if (process.env[envVar] == null || process.env[envVar] === '') {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  return {
    port: parseInt(process.env['GATEWAY_PORT'] ?? '8080', 10),
    host: process.env['GATEWAY_HOST'] ?? '0.0.0.0',
    corsOrigins: (process.env['CORS_ORIGINS'] ?? '*').split(',').map((s) => s.trim()),
    auth: {
      jwtSecret: process.env['JWT_SECRET']!,
      jwtIssuer: process.env['JWT_ISSUER'] ?? 'ai-platform',
      accessTokenTtl: parseInt(process.env['JWT_ACCESS_TOKEN_TTL'] ?? '7200', 10),
      wecomCallbackToken: process.env['WECOM_BOT_CALLBACK_TOKEN'] ?? '',
      wecomCallbackAesKey: process.env['WECOM_BOT_CALLBACK_ENCODING_AES_KEY'] ?? '',
      misJwtPublicKey: loadMisJwtPublicKey(),
      misJwtIssuer: process.env['MIS_JWT_ISSUER'] ?? 'mis-platform',
    },
    wecomH5: {
      corpId: process.env['WECOM_CORP_ID'] ?? '',
      agentId: process.env['WECOM_AGENT_ID'] ?? '',
      corpSecret: process.env['WECOM_SECRET'] ?? '',
      apiBaseUrl: process.env['WECOM_API_BASE_URL'] ?? 'https://qyapi.weixin.qq.com',
    },
    agentCoreApiUrl: process.env['AGENT_CORE_API_URL'] ?? 'http://backend:8000',
  };
}

// ============================================================================
// Redis 连接
// ============================================================================

/**
 * 创建 Redis 连接
 *
 * @param redisUrl - Redis 连接 URL
 * @returns Redis 客户端
 */
function createRedisConnection(redisUrl: string): Redis {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      if (times > 10) {
        logger.error(
          { times },
          'Redis connection retry limit exceeded',
        );
        return null;
      }
      const delay = Math.min(times * 500, 5000);
      logger.warn(
        { times, delayMs: delay },
        'Redis connection retrying',
      );
      return delay;
    },
    reconnectOnError: (error: Error) => {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some((e) => error.message.includes(e));
    },
  });

  redis.on('connect', () => {
    logger.info('Redis connected');
  });

  redis.on('error', (error: Error) => {
    logger.error({ error: error.message }, 'Redis connection error');
  });

  redis.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return redis;
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * Gateway 主入口
 */
async function main(): Promise<void> {
  let redis: Redis | null = null;
  let isShuttingDown = false;

  try {
    // 加载配置
    const config = loadConfig();
    logger.info(
      {
        port: config.port,
        host: config.host,
        agentCoreApiUrl: config.agentCoreApiUrl,
      },
      'Starting AI Platform Gateway',
    );

    // 业务连接（路由 / 亲和查询 / HTTP 侧）
    redis = createRedisConnection(process.env['REDIS_URL']!);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 10000);

      redis!.on('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      redis!.on('error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // 消费连接必须独立：XREADGROUP BLOCK 会占满单连接，拖慢 GET/XADD（实测 route 可达 10s+）
    const redisConsumer = createRedisConnection(process.env['REDIS_URL']!);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis consumer connection timeout'));
      }, 10000);
      redisConsumer.on('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      redisConsumer.on('error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // 创建服务器和适配器
    const {
      app,
      wecomH5Adapter,
      botRegistry,
      h5Adapter,
      messageRouter,
      eventTransformer,
    } = await createServer(redis, config);

    // 启动 HTTP 服务器
    await startServer(app, { port: config.port, host: config.host });

    // 启动企业微信多 Bot WebSocket 长连接（从 backend 拉取配置，环境变量兜底）
    const botConfigSource = createBotConfigSourceFromEnv(config.agentCoreApiUrl);
    const botConfigs = await botConfigSource.load();
    botRegistry.register(botConfigs);
    const startedBots = await botRegistry.startAll(async (inboundMessage: InboundMessage) => {
      await messageRouter.route(inboundMessage);
    });
    logger.info(
      { registered: botRegistry.size(), started: startedBots },
      'Wecom Bot adapters startup finished',
    );

    // 启动热加载轮询（O1f-2）：周期拉取 backend 启用清单，差量 reconcile。
    // 无 GATEWAY_INTERNAL_TOKEN 时 startPolling 内部直接跳过（保持 fail-closed）；
    // BOT_CONFIG_POLL_INTERVAL_MS<=0 时不轮询（退回 O1f-1 行为）。
    const botPollIntervalMs = parseInt(
      process.env['BOT_CONFIG_POLL_INTERVAL_MS'] ?? '30000',
      10,
    );
    const stopBotPolling = botConfigSource.startPolling(
      botPollIntervalMs,
      async (runtimeConfigs) => {
        if (runtimeConfigs == null) {
          // 拉取失败 / 无 token：跳过本轮，保持现状（严禁把失败当空清单）。
          logger.warn('Bot config poll skipped (pull failed)');
          return;
        }
        const reconcileReport = await botRegistry.reconcile(runtimeConfigs);
        logger.info(
          {
            started: reconcileReport.started,
            restarted: reconcileReport.restarted,
            metadataUpdated: reconcileReport.metadataUpdated,
            stopped: reconcileReport.stopped,
            removed: reconcileReport.removed,
            errors: reconcileReport.errors,
          },
          'Bot config reconciled',
        );
      },
    );

    // 启动事件流消费者（消费 Agent Core 返回的事件）— 使用独立 Redis 连接
    const eventConsumer = new StreamConsumer(
      redisConsumer,
      'gateway-event-group',
      `gateway-events-${process.pid}`,
    );
    await eventConsumer.start(AGENT_EVENTS_STREAM, async (message: InboundMessage) => {
      try {
        if (message.eventJson == null || message.eventJson.length === 0) {
          return;
        }

        const event = parseBackendAgentEvent(message.eventJson);
        const channel = toGatewayChannel(message.channel);

        logger.info(
          {
            sessionId: message.sessionId,
            channel,
            eventType: event.type,
            perfPhase: 'gw_event',
          },
          'Agent event for channel',
        );

        // 企微 Bot：用 aibot_respond_msg 流式更新（收到消息时已回「思考中...」）
        if (channel === 'wecom-bot') {
          if (event.type === 'text.delta' && event.content != null) {
            await botRegistry.dispatchTextDelta(message.sessionId, event.content);
          } else if (event.type === 'error') {
            await botRegistry.dispatchError(
              message.sessionId,
              event.errorMessage ?? event.errorCode ?? '处理出错',
            );
          } else if (event.type === 'done') {
            await botRegistry.dispatchDone(message.sessionId);
          }
          return;
        }

        const channelMessage = eventTransformer.transform(event, channel);

        if (channel === 'h5' && channelMessage.eventData != null) {
          await h5Adapter.send(channelMessage.eventData, message.sessionId);
        } else if (channel === 'wecom-h5' && channelMessage.eventData != null) {
          await wecomH5Adapter.send(channelMessage.eventData, message.sessionId);
        }
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            sessionId: message.sessionId,
          },
          'Error processing event from stream',
        );
      }
    });

    logger.info(
      {
        port: config.port,
        wecomH5Connections: wecomH5Adapter.getConnectionCount(),
        h5Connections: h5Adapter.getConnectionCount(),
        botConnected: botRegistry.connectedCount(),
      },
      'AI Platform Gateway is running',
    );

    // ===== 优雅关闭 =====

    const gracefulShutdown = async (signal: string): Promise<void> => {
      if (isShuttingDown) {
        logger.warn('Shutdown already in progress, ignoring signal');
        return;
      }
      isShuttingDown = true;

      logger.info({ signal }, 'Received shutdown signal, shutting down gracefully');

      // 停止热加载轮询（先停拉取，避免关停期间再触发 reconcile）
      stopBotPolling();

      // 停止事件消费者
      eventConsumer.stop();

      // 关闭服务器和适配器
      await shutdownServer(app, {
        wecomH5Adapter,
        botRegistry,
        h5Adapter,
      });

      // 关闭 Redis（业务连接 + 消费连接）
      if (redis != null) {
        redis.disconnect();
      }
      redisConsumer.disconnect();

      logger.info('Gateway shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

    process.on('uncaughtException', (error: Error) => {
      logger.fatal(
        { error: error.message, stack: error.stack },
        'Uncaught exception',
      );
      void gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason: unknown) => {
      logger.fatal(
        { reason: reason instanceof Error ? reason.message : String(reason) },
        'Unhandled rejection',
      );
      void gracefulShutdown('unhandledRejection');
    });
  } catch (error) {
    logger.fatal(
      { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
      'Failed to start Gateway',
    );
    if (redis != null) {
      redis.disconnect();
    }
    process.exit(1);
  }
}

// 启动
main().catch((error) => {
  logger.fatal(
    { error: error instanceof Error ? error.message : String(error) },
    'Fatal error in main',
  );
  process.exit(1);
});
