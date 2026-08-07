/**
 * BotRegistry.ts — 企微多 Bot 实例注册表（T04 O1f-1 / B4 验收 + O1f-2 热加载）
 *
 * 把原本「`index.ts` 里写死一个 `WecomBotAdapter`」的单实例结构，换成
 * 「一份配置清单 → N 个 adapter 实例」的注册表，满足 B4 验收：
 * **≥2 个 Bot 并存、可独立停用**。
 *
 * 核心职责：
 * - `startAll` / `stopAll`：批量生命周期；单个 Bot 启动失败不影响其他 Bot。
 * - `startBot` / `stopBot`：单实例启停（B4「独立停用」）。
 * - `reconcile`：O1f-2 热加载差量收敛（新增 / 重启 / 元数据更新 / 消失 / 幂等）。
 * - `health()`：给 backend `#54` 消费的 `{botId: 状态}` 映射。
 * - **回程事件派发**：Agent Core 的 `text.delta` / `error` / `done` 事件只带
 *   `sessionId`，不带 `botId`。注册表在入站时记录 `sessionId → botId` 归属，
 *   回程时精确投递；归属未知（如 Gateway 重启后收到旧会话事件）时广播给
 *   全部实例——`WecomBotAdapter` 内部按 `pendingBySession` 判断，不属于自己
 *   的 sessionId 会直接 no-op，所以广播是安全的。
 *
 * @module channels/BotRegistry
 */

import { WecomBotAdapter } from '../adapters/wecom/WecomBotAdapter.js';
import type { BotRuntimeConfig } from '../config/botConfigSource.js';
import type { InboundMessage } from '../queue/redisStream.js';
import { logger } from '../middleware/logger.js';

// ============================================================================
// 类型定义
// ============================================================================

/** Bot 健康状态，与 backend / 前端 `WecomBot['health']` 取值一致 */
export type BotHealth = 'connected' | 'disconnected' | 'unknown';

/** 入站消息回调（通常是 `messageRouter.route`） */
export type BotInboundHandler = (message: InboundMessage) => void | Promise<void>;

/** 注册表中单个 Bot 的运行时条目 */
interface BotEntry {
  config: BotRuntimeConfig;
  adapter: WecomBotAdapter;
  /** 是否已成功 `start()`（区别于 config.enabled） */
  started: boolean;
  /** 最近一次启动失败原因，供 /admin/bots 排障 */
  lastError?: string;
}

/** `/admin/bots` 列表项（不含 secret） */
export interface BotStatusView {
  botId: string;
  name: string;
  enabled: boolean;
  started: boolean;
  health: BotHealth;
  wsUrl: string;
  boundAgentId?: string;
  lastError?: string;
}

/** `reconcile` 差量报告（O1f-2 热加载） */
export interface ReconcileReport {
  /** 本轮新增并成功启动的 botId */
  started: string[];
  /** 本轮从「运行中」变为停止的 botId（含重启前的旧实例与消失场景） */
  stopped: string[];
  /** 本轮因 wsUrl/secret 变更而重启的 botId */
  restarted: string[];
  /** 本轮仅元数据（name/boundAgentId）原地更新的 botId（未重启） */
  metadataUpdated: string[];
  /** 本轮从注册表删除的 botId（停用/删除） */
  removed: string[];
  /** 启动/重启失败项 */
  errors: Array<{ botId: string; reason: string }>;
}

// ============================================================================
// BotRegistry
// ============================================================================

/**
 * 多 Bot 实例注册表。
 */
export class BotRegistry {
  private readonly entries = new Map<string, BotEntry>();
  /** sessionId → botId 归属表（回程事件精确派发用） */
  private readonly sessionOwner = new Map<string, string>();
  /** 归属表容量上限，超出后按插入顺序淘汰最旧项，防止长跑内存泄漏 */
  private readonly maxSessionOwners: number;
  private inboundHandler: BotInboundHandler | null = null;

  /**
   * @param maxSessionOwners - sessionId 归属表容量上限（默认 10000）
   */
  constructor(maxSessionOwners = 10000) {
    this.maxSessionOwners = maxSessionOwners;
  }

  // --------------------------------------------------------------------
  // 注册与生命周期
  // --------------------------------------------------------------------

  /**
   * 注册一批 Bot 配置（不启动）。
   *
   * 重复 botId 会覆盖已有条目并先停掉旧实例，避免野连接残留。
   *
   * @param configs - Bot 运行时配置数组
   */
  register(configs: BotRuntimeConfig[]): void {
    for (const config of configs) {
      const existing = this.entries.get(config.botId);
      if (existing != null) {
        logger.warn({ botId: config.botId }, 'Duplicate botId, replacing existing entry');
        if (existing.started) {
          existing.adapter.stop();
        }
      }
      this.entries.set(config.botId, {
        config,
        adapter: new WecomBotAdapter(config),
        started: false,
      });
    }
    logger.info(
      { count: this.entries.size, botIds: [...this.entries.keys()] },
      'BotRegistry registered bot configs',
    );
  }

  /**
   * 启动所有 `enabled` 的 Bot。
   *
   * 单个 Bot 启动失败只记错误并继续，绝不让一个坏 Bot 拖垮整个 Gateway
   * （原 `index.ts` 已是这个语义，这里保持一致并推广到多实例）。
   *
   * @param onMessage - 入站消息回调
   * @returns 成功启动的 Bot 数量
   */
  async startAll(onMessage: BotInboundHandler): Promise<number> {
    this.inboundHandler = onMessage;

    let started = 0;
    for (const [botId, entry] of this.entries) {
      if (!entry.config.enabled) {
        logger.info({ botId, name: entry.config.name }, 'Skip disabled wecom bot');
        continue;
      }
      const ok = await this.startEntry(botId, entry);
      if (ok) {
        started += 1;
      }
    }

    logger.info(
      { started, total: this.entries.size },
      'BotRegistry startAll finished',
    );
    return started;
  }

  /**
   * 启动指定 Bot（幂等：已启动直接返回 true）。
   *
   * @param botId - 目标 Bot ID
   * @returns 是否处于已启动状态
   */
  async startBot(botId: string): Promise<boolean> {
    const entry = this.entries.get(botId);
    if (entry == null) {
      logger.warn({ botId }, 'startBot: unknown botId');
      return false;
    }
    if (entry.started) {
      return true;
    }
    if (this.inboundHandler == null) {
      logger.warn({ botId }, 'startBot: inbound handler not wired yet');
      return false;
    }
    return this.startEntry(botId, entry);
  }

  /**
   * 停止指定 Bot（B4「可独立停用」）。幂等。
   *
   * @param botId - 目标 Bot ID
   * @returns 目标存在且已停止返回 true
   */
  stopBot(botId: string): boolean {
    const entry = this.entries.get(botId);
    if (entry == null) {
      logger.warn({ botId }, 'stopBot: unknown botId');
      return false;
    }
    if (entry.started) {
      entry.adapter.stop();
      entry.started = false;
      this.dropSessionsOf(botId);
      logger.info({ botId, name: entry.config.name }, 'Wecom bot stopped');
    }
    return true;
  }

  /**
   * 停止全部 Bot（优雅关闭用）。
   */
  stopAll(): void {
    for (const [botId, entry] of this.entries) {
      if (entry.started) {
        entry.adapter.stop();
        entry.started = false;
        logger.info({ botId }, 'Wecom bot stopped (shutdown)');
      }
    }
    this.sessionOwner.clear();
  }

  /**
   * 按期望清单差量收敛（O1f-2 热加载收敛侧）。
   *
   * `desired` 是轮询到的**启用中** Bot 清单（含明文 secret，严禁写日志）：
   * - 新增 → 建条目 + `startBot`（失败只记 `lastError` 不阻塞其他 Bot）；
   * - 已存在且 `wsUrl`/`secret` 任一变化 → **重启**（新 adapter，保留 sessionOwner）；
   * - 已存在且仅 `name`/`boundAgentId` 变化 → 原地更新配置，**不重启**；
   * - 已存在且配置全等 → no-op（幂等）；
   * - 清单中消失（停用/删除）→ `stopBot` + drop 会话归属 + 删除条目。
   *
   * 注册表只保留「需要运行的 Bot」：期望清单之外一律移除（停用与删除动作相同，
   * 都从启用清单消失，无需区分）。调用方保证：`desired` 为空数组 = 收敛到零；
   * **`null`（拉取失败）不得进入本方法**，由调用方跳过本轮。
   *
   * @param desired - 期望运行的启用 Bot 配置数组
   * @returns 差量报告
   */
  async reconcile(desired: BotRuntimeConfig[]): Promise<ReconcileReport> {
    const report: ReconcileReport = {
      started: [],
      stopped: [],
      restarted: [],
      metadataUpdated: [],
      removed: [],
      errors: [],
    };

    const desiredIds = new Set<string>();
    for (const config of desired) {
      desiredIds.add(config.botId);
      const entry = this.entries.get(config.botId);

      if (entry == null) {
        // 新增（enabled）：建条目并启动；启动失败只记 lastError，不阻塞。
        const newEntry: BotEntry = {
          config,
          adapter: new WecomBotAdapter(config),
          started: false,
        };
        this.entries.set(config.botId, newEntry);
        const ok = await this.startBot(config.botId);
        if (ok) {
          report.started.push(config.botId);
        } else {
          report.errors.push({
            botId: config.botId,
            reason: newEntry.lastError ?? 'start failed',
          });
        }
        continue;
      }

      // 已存在：连接参数变更 → 重启；仅元数据变更 → 原地更新；全等 → no-op。
      if (this.configsEqual(entry.config, config)) {
        continue;
      }
      if (
        entry.config.wsUrl !== config.wsUrl ||
        entry.config.secret !== config.secret
      ) {
        const ok = await this.restartEntry(config.botId, entry, config);
        if (ok) {
          report.restarted.push(config.botId);
        } else {
          report.errors.push({
            botId: config.botId,
            reason: entry.lastError ?? 'restart failed',
          });
        }
        continue;
      }
      entry.config = config;
      report.metadataUpdated.push(config.botId);
    }

    // 清单中消失（停用/删除）：stop + drop 会话归属 + 删除条目。
    for (const [botId, entry] of [...this.entries]) {
      if (!desiredIds.has(botId)) {
        if (entry.started) {
          this.stopBot(botId);
          report.stopped.push(botId);
        }
        this.entries.delete(botId);
        report.removed.push(botId);
      }
    }

    return report;
  }

  /**
   * 实际执行单实例启动并包装入站回调（记录 session 归属）。
   *
   * @param botId - 目标 Bot ID
   * @param entry - 注册表条目
   * @returns 是否启动成功
   */
  private async startEntry(botId: string, entry: BotEntry): Promise<boolean> {
    const handler = this.inboundHandler;
    if (handler == null) {
      entry.lastError = 'inbound handler not wired';
      return false;
    }

    try {
      await entry.adapter.start(async (message: InboundMessage) => {
        this.rememberSessionOwner(message.sessionId, botId);
        await handler(message);
      });
      entry.started = true;
      delete entry.lastError;
      logger.info(
        { botId, name: entry.config.name, wsUrl: entry.config.wsUrl },
        'Wecom bot adapter started',
      );
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      entry.started = false;
      entry.lastError = reason;
      logger.error(
        { botId, name: entry.config.name, error: reason },
        'Failed to start wecom bot adapter, continuing with other bots',
      );
      return false;
    }
  }

  /**
   * 重启单实例（连接参数变更路径）。
   *
   * 关键差异 vs `stopBot`：**保留 sessionOwner 映射**（不调 `dropSessionsOf`），
   * 回程事件仍能精确投递到新 adapter（新 adapter 无 pending ⇒ no-op，不误广播）。
   * 进行中的流式回复至多断一条（设计裁定：连接参数变更重启不做 drain）。
   *
   * @param botId - 目标 Bot ID
   * @param entry - 注册表条目（原地替换 adapter）
   * @param config - 新配置（含变更后的 wsUrl/secret）
   * @returns 是否重启成功
   */
  private async restartEntry(
    botId: string,
    entry: BotEntry,
    config: BotRuntimeConfig,
  ): Promise<boolean> {
    entry.adapter.stop();
    entry.config = config;
    entry.adapter = new WecomBotAdapter(config);
    entry.started = false;
    logger.info(
      { botId, name: config.name, wsUrl: config.wsUrl },
      'Wecom bot connection config changed, restarting adapter',
    );
    return this.startEntry(botId, entry);
  }

  /**
   * 判断两份配置是否等价（决定 reconcile 是否需要重启/更新）。
   *
   * 只比较管理面与连接参数（name/enabled/wsUrl/secret/boundAgentId）；
   * 心跳/重连等运行参数来自全局默认（env），不参与差量。
   *
   * @param a - 现配置
   * @param b - 期望配置
   * @returns 是否等价
   */
  private configsEqual(a: BotRuntimeConfig, b: BotRuntimeConfig): boolean {
    return (
      a.name === b.name &&
      a.enabled === b.enabled &&
      a.wsUrl === b.wsUrl &&
      a.secret === b.secret &&
      (a.boundAgentId ?? '') === (b.boundAgentId ?? '')
    );
  }

  // --------------------------------------------------------------------
  // session 归属
  // --------------------------------------------------------------------

  /**
   * 记录 sessionId 的归属 Bot（回程事件派发用）。
   *
   * 同一用户同时对话多个 Bot 时 `sessionId` 可能相同（现网 sessionId 规则是
   * `wecom-bot-{chatId|userId}`，不含 botId）。这里「后写覆盖」= 最近一次
   * 请求的 Bot 拿到回程，是正确的行为；即便判错，`dispatch*` 也会在目标
   * adapter 无 pending 时回退广播，最终不会丢消息。
   *
   * @param sessionId - 会话 ID
   * @param botId - 归属 Bot ID
   */
  private rememberSessionOwner(sessionId: string, botId: string): void {
    if (sessionId.length === 0) {
      return;
    }
    // Map 保持插入序：超限时淘汰最旧一条。
    if (!this.sessionOwner.has(sessionId) && this.sessionOwner.size >= this.maxSessionOwners) {
      const oldest = this.sessionOwner.keys().next();
      if (oldest.done !== true) {
        this.sessionOwner.delete(oldest.value);
      }
    }
    this.sessionOwner.set(sessionId, botId);
  }

  /**
   * 清理某 Bot 名下的全部 session 归属（停用该 Bot 时调用）。
   *
   * @param botId - 目标 Bot ID
   */
  private dropSessionsOf(botId: string): void {
    for (const [sessionId, owner] of this.sessionOwner) {
      if (owner === botId) {
        this.sessionOwner.delete(sessionId);
      }
    }
  }

  /**
   * 解析回程事件应投递给哪些 adapter。
   *
   * @param sessionId - 会话 ID
   * @returns 归属明确时返回单元素数组；否则返回全部已启动实例
   */
  private resolveTargets(sessionId: string): WecomBotAdapter[] {
    const owner = this.sessionOwner.get(sessionId);
    if (owner != null) {
      const entry = this.entries.get(owner);
      if (entry != null && entry.started) {
        return [entry.adapter];
      }
    }
    // 归属未知：广播。adapter 内部按 pendingBySession 过滤，非己方为 no-op。
    const targets: WecomBotAdapter[] = [];
    for (const entry of this.entries.values()) {
      if (entry.started) {
        targets.push(entry.adapter);
      }
    }
    return targets;
  }

  // --------------------------------------------------------------------
  // 回程事件派发
  // --------------------------------------------------------------------

  /**
   * 派发 Agent `text.delta`。
   *
   * @param sessionId - 会话 ID
   * @param delta - 增量文本
   */
  async dispatchTextDelta(sessionId: string, delta: string): Promise<void> {
    for (const adapter of this.resolveTargets(sessionId)) {
      await adapter.onAgentTextDelta(sessionId, delta);
    }
  }

  /**
   * 派发 Agent `error`。
   *
   * @param sessionId - 会话 ID
   * @param message - 错误文案
   */
  async dispatchError(sessionId: string, message: string): Promise<void> {
    for (const adapter of this.resolveTargets(sessionId)) {
      await adapter.onAgentError(sessionId, message);
    }
  }

  /**
   * 派发 Agent `done`，并释放 session 归属。
   *
   * @param sessionId - 会话 ID
   */
  async dispatchDone(sessionId: string): Promise<void> {
    for (const adapter of this.resolveTargets(sessionId)) {
      await adapter.onAgentDone(sessionId);
    }
    this.sessionOwner.delete(sessionId);
  }

  // --------------------------------------------------------------------
  // 查询
  // --------------------------------------------------------------------

  /**
   * 获取指定 Bot 的 adapter 实例。
   *
   * @param botId - 目标 Bot ID
   * @returns adapter 实例；不存在返回 undefined
   */
  getAdapter(botId: string): WecomBotAdapter | undefined {
    return this.entries.get(botId)?.adapter;
  }

  /**
   * 已注册的 Bot 数量。
   *
   * @returns 注册条目数
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * 已成功启动且 WS 处于连通状态的 Bot 数量（`/health` 用）。
   *
   * @returns 连通实例数
   */
  connectedCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.started && entry.adapter.isConnected()) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * 健康映射（backend `#54` 消费）。
   *
   * 语义：
   * - 未启用 或 已启用但未成功 start ⇒ `disconnected`
   * - 已启动且 WS 连通 ⇒ `connected`
   * - 已启动但 WS 暂时断开（重连中）⇒ `disconnected`
   *
   * 这里不产出 `unknown`——`unknown` 是 backend 在「Gateway 不可达」时才用的
   * 降级值，Gateway 自己永远知道自己的状态。
   *
   * @returns `{botId: health}`
   */
  health(): Record<string, BotHealth> {
    const result: Record<string, BotHealth> = {};
    for (const [botId, entry] of this.entries) {
      if (!entry.started) {
        result[botId] = 'disconnected';
        continue;
      }
      result[botId] = entry.adapter.isConnected() ? 'connected' : 'disconnected';
    }
    return result;
  }

  /**
   * 列出全部 Bot 状态（`/admin/bots` 排障用，**不含 secret**）。
   *
   * @returns 状态视图数组
   */
  list(): BotStatusView[] {
    const health = this.health();
    const views: BotStatusView[] = [];
    for (const [botId, entry] of this.entries) {
      views.push({
        botId,
        name: entry.config.name,
        enabled: entry.config.enabled,
        started: entry.started,
        health: health[botId] ?? 'disconnected',
        wsUrl: entry.config.wsUrl,
        ...(entry.config.boundAgentId != null
          ? { boundAgentId: entry.config.boundAgentId }
          : {}),
        ...(entry.lastError != null ? { lastError: entry.lastError } : {}),
      });
    }
    return views;
  }
}
