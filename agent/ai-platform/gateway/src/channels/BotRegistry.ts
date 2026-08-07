/**
 * BotRegistry.ts — 企微多 Bot 实例注册表（T04 O1f-1 / B4 验收）
 *
 * 把原本「`index.ts` 里写死一个 `WecomBotAdapter`」的单实例结构，换成
 * 「一份配置清单 → N 个 adapter 实例」的注册表，满足 B4 验收：
 * **≥2 个 Bot 并存、可独立停用**。
 *
 * 核心职责：
 * - `startAll` / `stopAll`：批量生命周期；单个 Bot 启动失败不影响其他 Bot。
 * - `startBot` / `stopBot`：单实例启停（B4「独立停用」）。
 * - `health()`：给 backend `#54` 消费的 `{botId: 状态}` 映射。
 * - **回程事件派发**：Agent Core 的 `text.delta` / `error` / `done` 事件只带
 *   `sessionId`，不带 `botId`。注册表在入站时记录 `sessionId → botId` 归属，
 *   回程时精确投递；归属未知（如 Gateway 重启后收到旧会话事件）时广播给
 *   全部实例——`WecomBotAdapter` 内部按 `pendingBySession` 判断，不属于自己
 *   的 sessionId 会直接 no-op，所以广播是安全的。
 *
 * 不做的事（O1f-2，本期显式不做）：配置热重载。运营台保存后需重启 Gateway，
 * 前端 `agent-wecom-page.tsx` 已常驻该提示横幅。
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
