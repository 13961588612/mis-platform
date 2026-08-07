/**
 * botConfigSource.ts — 企微多 Bot 配置来源（T04 O1f-1）
 *
 * 配置来源从 `WECOM_BOT_*` 环境变量改为「启动时从 backend 拉取」
 * （impl-plan §9.4）：
 *
 * 1. **主来源**：`GET {AGENT_CORE_API_URL}/api/v1/channels/wecom/bots/runtime?enabled=true`
 *    带 `X-Internal-Token` 服务间共享令牌（backend `GATEWAY_INTERNAL_TOKEN`）。
 *    该端点返回**含明文 secret** 的运行时清单——运营台端点 `#48` 只返回
 *    `secret_masked`，Gateway 拿不到明文就没法 `aibot_subscribe`。
 * 2. **降级兜底**：backend 不可达 / 未配置令牌 / 返回空清单时，回落到
 *    `WECOM_BOT_ID` + `WECOM_BOT_SECRET` 环境变量，保证仍能起单 Bot
 *    （§9.4 明确要求保留）。
 *
 * 本期只做 **O1f-1（启动时拉取 + 多实例）**；O1f-2 热重载不做，运营台
 * 已常驻「保存后需重启 Gateway 生效」提示。
 *
 * @module config/botConfigSource
 */

import axios, { type AxiosInstance } from 'axios';
import type { WecomBotAdapterConfig } from '../adapters/wecom/WecomBotAdapter.js';
import { logger } from '../middleware/logger.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 单个 Bot 的运行时配置。
 *
 * 在 {@link WecomBotAdapterConfig}（连接参数）之上补充管理面元数据，
 * 供 `BotRegistry` 做生命周期管理与健康上报。
 */
export interface BotRuntimeConfig extends WecomBotAdapterConfig {
  /** 展示名称（日志与 /admin/bots 用） */
  name: string;
  /** 是否启用；registry 只启动 enabled 的实例 */
  enabled: boolean;
  /** 绑定的 Agent ID；为空表示走默认路由 */
  boundAgentId?: string;
}

/** backend `/channels/wecom/bots/runtime` 的单条回包（snake_case） */
interface RuntimeBotWire {
  bot_id?: string;
  name?: string;
  enabled?: boolean;
  ws_url?: string;
  secret?: string;
  bound_agent_id?: string;
}

/** backend 统一响应信封 */
interface ResultEnvelope<T> {
  code?: number;
  data?: T;
  message?: string;
  traceId?: string;
}

/**
 * 连接参数默认值。
 *
 * 这些参数目前不入库（每个 Bot 都一样），统一由环境变量给全局默认，
 * 避免为了几个心跳数字把配置文件 schema 撑复杂。
 */
export interface BotConnectionDefaults {
  heartbeatIntervalSec: number;
  heartbeatTimeoutCount: number;
  maxReconnectAttempts: number;
  initialReconnectDelayMs: number;
  maxReconnectDelayMs: number;
  reconnectBackoffMultiplier: number;
  subscribeTimeoutMs: number;
  /** 默认 WS 地址（backend 未配置 ws_url 时使用） */
  defaultWsUrl: string;
  /** 卡片来源名 */
  sourceName: string;
  /** 卡片来源图标 */
  sourceIconUrl?: string;
}

/** BotConfigSource 构造选项 */
export interface BotConfigSourceOptions {
  /** backend 基址，如 `http://backend:8000` */
  backendBaseUrl: string;
  /** 服务间共享令牌；为空则直接跳过远端拉取 */
  internalToken: string;
  /** 拉取超时（毫秒） */
  timeoutMs: number;
  /** 连接参数默认值 */
  defaults: BotConnectionDefaults;
  /** 环境变量兜底 Bot（botId/secret 任一为空表示无兜底） */
  envFallback: { botId: string; secret: string; wsUrl: string };
}

// ============================================================================
// 工具
// ============================================================================

/**
 * 安全读取字符串字段。
 *
 * @param value - 任意值
 * @returns 去空白后的字符串；非字符串返回空串
 */
function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

// ============================================================================
// BotConfigSource
// ============================================================================

/**
 * Bot 配置来源：远端优先、环境变量兜底。
 */
export class BotConfigSource {
  private readonly options: BotConfigSourceOptions;
  private readonly http: AxiosInstance;

  /**
   * @param options - 配置来源选项
   */
  constructor(options: BotConfigSourceOptions) {
    this.options = options;
    this.http = axios.create({
      baseURL: options.backendBaseUrl.replace(/\/+$/, ''),
      timeout: options.timeoutMs,
      // 4xx/5xx 不抛异常，由调用方统一按「拉取失败」处理，日志更干净。
      validateStatus: () => true,
    });
  }

  /**
   * 加载启用中的 Bot 运行时配置清单。
   *
   * 永不抛异常：任何失败都降级到环境变量兜底，最差返回空数组
   * （Gateway 继续以「无 Bot」模式运行，H5 渠道不受影响）。
   *
   * @returns 可直接交给 `BotRegistry` 的配置数组
   */
  async load(): Promise<BotRuntimeConfig[]> {
    const remote = await this.loadFromBackend();
    if (remote.length > 0) {
      logger.info(
        { count: remote.length, botIds: remote.map((b) => b.botId) },
        'Loaded wecom bot configs from backend',
      );
      return remote;
    }

    const fallback = this.loadFromEnv();
    if (fallback.length > 0) {
      logger.warn(
        { botId: fallback[0]!.botId },
        'Backend bot config unavailable/empty, falling back to WECOM_BOT_* env vars',
      );
      return fallback;
    }

    logger.warn(
      'No wecom bot configured (backend empty and WECOM_BOT_ID/SECRET unset); Bot channel disabled',
    );
    return [];
  }

  /**
   * 从 backend 拉取运行时清单。
   *
   * @returns 配置数组；任何失败返回空数组
   */
  private async loadFromBackend(): Promise<BotRuntimeConfig[]> {
    if (this.options.internalToken.length === 0) {
      logger.warn(
        'GATEWAY_INTERNAL_TOKEN not set, skipping backend bot config pull',
      );
      return [];
    }

    try {
      const response = await this.http.get<ResultEnvelope<RuntimeBotWire[]>>(
        '/api/v1/channels/wecom/bots/runtime',
        {
          params: { enabled: true },
          headers: { 'X-Internal-Token': this.options.internalToken },
        },
      );

      if (response.status !== 200) {
        logger.warn(
          { status: response.status, message: response.data?.message },
          'Backend bot config pull returned non-200',
        );
        return [];
      }

      const body = response.data;
      const items = Array.isArray(body?.data) ? body.data : [];
      const configs: BotRuntimeConfig[] = [];
      for (const item of items) {
        const config = this.toRuntimeConfig(item);
        if (config != null) {
          configs.push(config);
        }
      }
      return configs;
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Backend bot config pull failed',
      );
      return [];
    }
  }

  /**
   * 把 backend 回包（snake_case）转成 Gateway 内部配置（camelCase）。
   *
   * @param wire - backend 单条回包
   * @returns 运行时配置；缺 botId/secret 时返回 null（不可用，跳过）
   */
  private toRuntimeConfig(wire: RuntimeBotWire): BotRuntimeConfig | null {
    const botId = asString(wire.bot_id);
    const secret = asString(wire.secret);
    if (botId.length === 0 || secret.length === 0) {
      logger.warn(
        { botId: botId.length > 0 ? botId : '(empty)', hasSecret: secret.length > 0 },
        'Skip wecom bot without botId/secret',
      );
      return null;
    }

    const d = this.options.defaults;
    const wsUrl = asString(wire.ws_url);
    const boundAgentId = asString(wire.bound_agent_id);

    return {
      botId,
      secret,
      wsUrl: wsUrl.length > 0 ? wsUrl : d.defaultWsUrl,
      name: asString(wire.name) || botId,
      enabled: wire.enabled !== false,
      ...(boundAgentId.length > 0 ? { boundAgentId } : {}),
      heartbeatIntervalSec: d.heartbeatIntervalSec,
      heartbeatTimeoutCount: d.heartbeatTimeoutCount,
      maxReconnectAttempts: d.maxReconnectAttempts,
      initialReconnectDelayMs: d.initialReconnectDelayMs,
      maxReconnectDelayMs: d.maxReconnectDelayMs,
      reconnectBackoffMultiplier: d.reconnectBackoffMultiplier,
      subscribeTimeoutMs: d.subscribeTimeoutMs,
      sourceName: d.sourceName,
      ...(d.sourceIconUrl != null ? { sourceIconUrl: d.sourceIconUrl } : {}),
    };
  }

  /**
   * 环境变量兜底（单 Bot）。
   *
   * @returns 长度 0 或 1 的配置数组
   */
  private loadFromEnv(): BotRuntimeConfig[] {
    const { botId, secret, wsUrl } = this.options.envFallback;
    if (botId.length === 0 || secret.length === 0) {
      return [];
    }

    const d = this.options.defaults;
    return [
      {
        botId,
        secret,
        wsUrl: wsUrl.length > 0 ? wsUrl : d.defaultWsUrl,
        name: `${botId} (env)`,
        enabled: true,
        heartbeatIntervalSec: d.heartbeatIntervalSec,
        heartbeatTimeoutCount: d.heartbeatTimeoutCount,
        maxReconnectAttempts: d.maxReconnectAttempts,
        initialReconnectDelayMs: d.initialReconnectDelayMs,
        maxReconnectDelayMs: d.maxReconnectDelayMs,
        reconnectBackoffMultiplier: d.reconnectBackoffMultiplier,
        subscribeTimeoutMs: d.subscribeTimeoutMs,
        sourceName: d.sourceName,
        ...(d.sourceIconUrl != null ? { sourceIconUrl: d.sourceIconUrl } : {}),
      },
    ];
  }
}

/**
 * 从环境变量构造 `BotConfigSource`（index.ts 用）。
 *
 * @param agentCoreApiUrl - backend 基址
 * @returns 配置好的 BotConfigSource
 */
export function createBotConfigSourceFromEnv(agentCoreApiUrl: string): BotConfigSource {
  const sourceIconUrl = process.env['WECOM_BOT_SOURCE_ICON_URL'];
  return new BotConfigSource({
    backendBaseUrl: agentCoreApiUrl,
    internalToken: process.env['GATEWAY_INTERNAL_TOKEN'] ?? '',
    timeoutMs: parseInt(process.env['BOT_CONFIG_PULL_TIMEOUT_MS'] ?? '5000', 10),
    defaults: {
      heartbeatIntervalSec: parseInt(process.env['WECOM_BOT_HEARTBEAT_INTERVAL'] ?? '30', 10),
      heartbeatTimeoutCount: 3,
      maxReconnectAttempts: 10,
      initialReconnectDelayMs: 1000,
      maxReconnectDelayMs: 30000,
      reconnectBackoffMultiplier: 2,
      subscribeTimeoutMs: parseInt(
        process.env['WECOM_BOT_SUBSCRIBE_TIMEOUT_MS'] ?? '10000',
        10,
      ),
      defaultWsUrl: process.env['WECOM_BOT_WS_URL'] ?? 'wss://openws.work.weixin.qq.com',
      sourceName: process.env['WECOM_BOT_SOURCE_NAME'] ?? 'AI智能助手',
      ...(sourceIconUrl != null && sourceIconUrl.length > 0 ? { sourceIconUrl } : {}),
    },
    envFallback: {
      botId: process.env['WECOM_BOT_ID'] ?? '',
      secret: process.env['WECOM_BOT_SECRET'] ?? '',
      wsUrl: process.env['WECOM_BOT_WS_URL'] ?? '',
    },
  });
}
