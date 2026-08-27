/**
 * BotRegistry.ts — 企微多 Bot 实例注册表（T04 O1f-1 / B4 验收 + O1f-2 热加载 + 阶段 A 租约）
 *
 * 把原本「`index.ts` 里写死一个 `WecomBotAdapter`」的单实例结构，换成
 * 「一份配置清单 → N 个 adapter 实例」的注册表，满足 B4 验收：
 * **≥2 个 Bot 并存、可独立停用**。
 *
 * 阶段 A（T2/N2/K1）扩展：每个 Bot 全局恰好一个 owner Gateway（Redis 租约保证），
 * 仅 owner 才 `startEntry` 握企微 WS；`reconcile` 尊重租约（失主停、得主起）。
 * `rememberSessionBot` 除进程内归属外，异步写 Redis `aip:session:{sid}:bot`，
 * 供 Core 出站精准定向（修 N3）。
 *
 * 核心职责：
 * - `startOwnedBots` / `stopAll`：批量生命周期；单个 Bot 启动失败不影响其他 Bot。
 * - `startBot` / `stopBot`：单实例启停（B4「独立停用」）。
 * - `reconcile`：O1f-2 热加载差量收敛（新增 / 重启 / 元数据更新 / 消失 / 幂等）；并尊重租约。
 * - `health()`：给 backend `#54` 消费的 `{botId: 状态}` 映射。
 * - **回程事件派发**：Agent Core 的 `text.delta` / `error` / `done` 事件只带
 *   `sessionId`，不带 `botId`。注册表在入站时记录 `sessionId → botId` 归属，
 *   回程时精确投递；归属未知（如 Gateway 重启后收到旧会话事件）时广播给
 *   全部实例——`WecomBotAdapter` 内部按 `pendingBySession` 判断，不属于自己
 *   的 sessionId 会直接 no-op，所以广播是安全的。
 *
 * @module channels/BotRegistry
 */

import type { Redis } from 'ioredis';
import { WecomBotAdapter } from '../adapters/wecom/WecomBotAdapter.js';
import type { BotRuntimeConfig } from '../config/botConfigSource.js';
import type { InboundMessage } from '../queue/redisStream.js';
import { sessionBotKey } from '../cluster/ownership.js';
import type { BotOwnership } from '../cluster/ownership.js';
import { logger } from '../middleware/logger.js';

// ============================================================================
// 类型定义
// ============================================================================

/** Bot 健康状态，与 backend / 前端 `WecomBot['health']` 取值一致 */
export type BotHealth = 'connected' | 'disconnected' | 'unknown';

/** 入站消息回调（通常是 `messageRouter.route`） */
export type BotInboundHandler = (message: InboundMessage) => void | Promise<void>;

/** 租约判定回调：传入 botId，返回本网关是否已成为 owner（通常由 `ownership.claim` 提供） */
export type BotIsOwner = (botId: string) => Promise<boolean>;

/** 故障转移接管的「旧 owner」流 drain 钩子（由 index.ts 注入，引用 StreamConsumer） */
export type DrainOldStreamFn = (oldGatewayId: string) => Promise<void>;

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
 *
 * 租约模式（阶段 A）：
 * - `bindCluster(ownership, gatewayId, drainOldStream?)` 注入租约协调器与接管 drain 钩子；
 *   未注入时退化为「人人都启」的旧行为（向后兼容单 Gateway）。
 * - `startOwnedBots` / `reconcile` 仅启动本网关 `claim` 成功的 bot（得主起、失主停）。
 */
export class BotRegistry {
  private readonly entries = new Map<string, BotEntry>();
  /** sessionId → botId 归属表（回程事件精确派发用，进程内） */
  private readonly sessionOwner = new Map<string, string>();
  /** 归属表容量上限，超出后按插入顺序淘汰最旧项，防止长跑内存泄漏 */
  private readonly maxSessionOwners: number;
  private inboundHandler: BotInboundHandler | null = null;

  /** 租约协调器（可选；未注入则租约失活） */
  private ownership: BotOwnership | null = null;
  /** 本网关稳定 ID（接管 drain 定位用） */
  private gatewayId = '';
  /** 接管时 drain 旧 owner 出站流的钩子 */
  private drainOldStream: DrainOldStreamFn | null = null;
  /** 最近一次观察到的「上一任 owner」（接管 drain 定位用） */
  private readonly observedPrev = new Map<string, string>();
  /** Redis 客户端（写 `aip:session:{sid}:bot`；可选） */
  private redis: Redis | null = null;

  /**
   * @param maxSessionOwners - sessionId 归属表容量上限（默认 10000）
   */
  constructor(maxSessionOwners = 10000) {
    this.maxSessionOwners = maxSessionOwners;
  }

  /**
   * 注入租约协调器与接管 drain 钩子（阶段 A）。
   *
   * @param ownership - Bot 租约协调器
   * @param gatewayId - 本网关稳定 ID
   * @param drainOldStream - 接管某 bot 时 drain 旧 owner 出站流的钩子（可选）
   */
  bindCluster(
    ownership: BotOwnership,
    gatewayId: string,
    drainOldStream?: DrainOldStreamFn,
  ): void {
    this.ownership = ownership;
    this.gatewayId = gatewayId;
    this.drainOldStream = drainOldStream ?? null;
  }

  /**
   * 注入 Redis 客户端（用于写 `aip:session:{sid}:bot`）。
   *
   * @param redis - Redis 客户端
   */
  bindRedis(redis: Redis): void {
    this.redis = redis;
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
   * 启动所有 `enabled` 的 Bot（向后兼容：未注入租约时等同于旧 `startAll`）。
   *
   * @param onMessage - 入站消息回调
   * @returns 成功启动的 Bot 数量
   */
  async startAll(onMessage: BotInboundHandler): Promise<number> {
    return this.startOwnedBots(onMessage, async () => true);
  }

  /**
   * 仅启动本网关 `claim` 成功的 Bot（修 K1/N2）。
   *
   * 单个 Bot 启动失败只记错误并继续，绝不让一个坏 Bot 拖垮整个 Gateway。
   * 非 owner 的 Bot 确保停掉本地实例，杜绝「人人都连」导致的企微单 WS 冲突。
   *
   * @param onMessage - 入站消息回调
   * @param isOwner - 租约判定（通常由 `ownership.claim` 提供）
   * @returns 成功启动的 Bot 数量
   */
  async startOwnedBots(
    onMessage: BotInboundHandler,
    isOwner: BotIsOwner,
  ): Promise<number> {
    this.inboundHandler = onMessage;

    let started = 0;
    for (const [botId, entry] of this.entries) {
      if (!entry.config.enabled) {
        logger.info({ botId, name: entry.config.name }, 'Skip disabled wecom bot');
        continue;
      }
      const ok = await this.acquireBot(botId, isOwner);
      if (ok) {
        if (!entry.started) {
          const s = await this.startEntry(botId, entry);
          if (s) {
            started += 1;
          }
        } else {
          started += 1;
        }
      } else if (entry.started) {
        // 非 owner：确保停掉本地实例，避免双连（修 K1/N2）
        this.stopBot(botId);
      }
    }

    logger.info(
      { started, total: this.entries.size },
      'BotRegistry startOwnedBots finished',
    );
    return started;
  }

  /**
   * 抢注 / 接管某 Bot 的租约，并在「新接管」时触发旧 owner 流 drain。
   *
   * @param botId - 目标 Bot ID
   * @param isOwner - 租约判定
   * @returns 本网关是否成为/保持 owner
   */
  private async acquireBot(botId: string, isOwner: BotIsOwner): Promise<boolean> {
    // 观察当前 owner；记录「上一任」供接管 drain 定位旧 stream。
    if (this.ownership != null && this.gatewayId.length > 0) {
      const cur = await this.ownership.currentOwner(botId);
      if (cur != null && cur !== this.gatewayId) {
        this.observedPrev.set(botId, cur);
      }
    }

    const ok = await isOwner(botId);

    if (ok && this.ownership != null && this.gatewayId.length > 0) {
      const prev = this.observedPrev.get(botId);
      if (prev != null && prev !== this.gatewayId) {
        await this.ownership.setPrevOwner(botId, prev);
        this.observedPrev.delete(botId);
        if (this.drainOldStream != null) {
          try {
            await this.drainOldStream(prev);
          } catch (error) {
            logger.error(
              { botId, prev, error: error instanceof Error ? error.message : String(error) },
              'Failed to drain previous owner outbound stream on takeover',
            );
          }
        }
      }
    }
    return ok;
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
   * 按期望清单差量收敛（O1f-2 热加载收敛侧）+ 尊重租约（失主停、得主起）。
   *
   * `desired` 是轮询到的**启用中** Bot 清单（含明文 secret，严禁写日志）：
   * - 新增 → 建条目 + 抢租约 + `startBot`（失败只记 `lastError` 不阻塞）；
   * - 已存在且 `wsUrl`/`secret` 任一变化 → **重启**（新 adapter，保留 sessionOwner）；
   * - 已存在且仅 `name`/`boundAgentId` 变化 → 原地更新配置，**不重启**；
   * - 已存在且配置全等 → no-op（幂等）；
   * - 清单中消失（停用/删除）→ `stopBot` + drop 会话归属 + 删除条目；
   * - 非 owner（租约被他网关抢走）→ 停掉本地实例，避免双连。
   *
   * 注册表只保留「需要运行的 Bot」：期望清单之外一律移除（停用与删除动作相同，
   * 都从启用清单消失，无需区分）。调用方保证：`desired` 为空数组 = 收敛到零；
   * **`null`（拉取失败）不得进入本方法**，由调用方跳过本轮。
   *
   * @param desired - 期望运行的启用 Bot 配置数组
   * @param isOwner - 租约判定（可选；未提供时退化为「人人都启」旧行为）
   * @returns 差量报告
   */
  async reconcile(
    desired: BotRuntimeConfig[],
    isOwner?: BotIsOwner,
  ): Promise<ReconcileReport> {
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
      const botId = config.botId;
      const entry = this.entries.get(botId);

      if (entry == null) {
        // 新增（enabled）：建条目；抢租约 + 启动；启动失败只记 lastError，不阻塞。
        const newEntry: BotEntry = {
          config,
          adapter: new WecomBotAdapter(config),
          started: false,
        };
        this.entries.set(botId, newEntry);
        const ok = isOwner != null ? await this.acquireBot(botId, isOwner) : true;
        if (ok) {
          if (await this.startEntry(botId, newEntry)) {
            report.started.push(botId);
          } else {
            report.errors.push({
              botId,
              reason: newEntry.lastError ?? 'start failed',
            });
          }
        }
        continue;
      }

      // 已存在：连接参数变更 → 重建 adapter（不启动，交由租约门控的启动步骤）；
      // 仅元数据变更 → 原地更新；全等 → no-op。
      if (!this.configsEqual(entry.config, config)) {
        if (
          entry.config.wsUrl !== config.wsUrl ||
          entry.config.secret !== config.secret
        ) {
          await this.restartEntry(botId, entry, config);
          report.restarted.push(botId);
        } else {
          entry.config = config;
          report.metadataUpdated.push(botId);
        }
      }

      // 租约门控：得主起、失主停。
      const ok = isOwner != null ? await this.acquireBot(botId, isOwner) : true;
      if (ok) {
        if (!entry.started) {
          if (await this.startEntry(botId, entry)) {
            if (!report.started.includes(botId)) {
              report.started.push(botId);
            }
          } else {
            report.errors.push({
              botId,
              reason: entry.lastError ?? 'start failed',
            });
          }
        }
      } else if (entry.started) {
        this.stopBot(botId);
        if (!report.stopped.includes(botId)) {
          report.stopped.push(botId);
        }
      }
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
   * 实际执行单实例启动并包装入站回调（记录 session 归属 + 写 Redis）。
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
        // 记录归属：进程内（回程精确派发）+ Redis（跨 gateway 可见，供 Core 出站定向，修 N3）
        await this.rememberSessionBot(message.sessionId, botId);
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
   * 重建单实例 adapter（连接参数变更路径）。
   *
   * 与旧实现差异：本方法**只停 + 重建 adapter**（不立即启动），启动交由
   * `reconcile` 的租约门控逻辑统一处理，避免与 `acquireBot` 重复 start。
   * 重建时**保留 sessionOwner 映射**（不调 `dropSessionsOf`），回程事件仍能
   * 精确投递到新 adapter（新 adapter 无 pending ⇒ no-op，不误广播）。
   *
   * @param botId - 目标 Bot ID
   * @param entry - 注册表条目（原地替换 adapter）
   * @param config - 新配置（含变更后的 wsUrl/secret）
   */
  private async restartEntry(
    botId: string,
    entry: BotEntry,
    config: BotRuntimeConfig,
  ): Promise<void> {
    if (entry.started) {
      entry.adapter.stop();
      entry.started = false;
    }
    entry.config = config;
    entry.adapter = new WecomBotAdapter(config);
    logger.info(
      { botId, name: config.name, wsUrl: config.wsUrl },
      'Wecom bot connection config changed, adapter recreated (owner-gated start pending)',
    );
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
   * 记录 sessionId 的归属 Bot（回程事件派发 + Core 出站定向用）。
   *
   * 进程内归属表 key 已含 botId（见 `WecomBotAdapter.receive`），同一用户同时
   * 对话多个 Bot 时 sessionId 天然隔离，不存在「后写覆盖」歧义（修 N3）。
   * 同时异步写 Redis `aip:session:{sid}:bot`，使跨 gateway 可见，供 Core 出站
   * 按 owner 精准定向。
   *
   * @param sessionId - 会话 ID
   * @param botId - 归属 Bot ID
   */
  async rememberSessionBot(sessionId: string, botId: string): Promise<void> {
    this.rememberSessionOwner(sessionId, botId);
    if (this.redis != null) {
      try {
        await this.redis.set(sessionBotKey(sessionId), botId, 'EX', 86400);
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
            botId,
          },
          'Failed to persist session->bot mapping to Redis',
        );
      }
    }
  }

  /**
   * 记录 sessionId 的归属 Bot（进程内，回程事件精确派发用）。
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
