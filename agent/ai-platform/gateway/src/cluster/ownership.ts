/**
 * ownership.ts — 稳定 GatewayId 注入 + Bot 租约选主（T1 / 阶段 A）
 *
 * 每个企微 Bot 的 WebSocket 是「服务端发起的单连接」，全局同一时刻只能有
 * 一个存活 owner Gateway 握连接（一 bot 一 WS 硬约束，见评审 K1/N2）。
 * 本模块用 Redis 租约（`SET key value NX PX ttl` + 心跳续租手写）把
 * 「bot → owner gateway」提升为分布式契约：
 *
 * - `getGatewayId()`：env `GATEWAY_ID` → `os.hostname()` → 告警随机（重启不变优先）。
 * - `BotOwnership.claim/renew/release/currentOwner/prevOwner`：租约抢注 / 续租 /
 *   释放 / 读当前与上一任 owner。
 * - `startHeartbeat`：周期续租 + 注册「失主」回调（续租失败 = 已易主 → 停 bot）。
 *
 * 下游 Core 出站按 `aip:bot:{botId}:owner` 把事件 XADD 到 `aip:stream:gw:{ownerGw}:events`，
 * 仅 owner Gateway 消费 → 精准送达、不重不丢（修 K3/N7）。
 *
 * @module cluster/ownership
 */

import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { logger } from '../middleware/logger.js';

// agent Redis 键统一命名空间前缀（与 Agent Core redis-py 端 `aip:` 一致）。
const REDIS_KEY_PREFIX = process.env['REDIS_KEY_PREFIX'] ?? 'aip:';

// ============================================================================
// Redis 键（两端一致，集中定义避免散落）
// ============================================================================

/** `aip:bot:{botId}:owner` — 租约（value = gatewayId，PX TTL） */
export function botOwnerKey(botId: string): string {
  return `${REDIS_KEY_PREFIX}bot:${botId}:owner`;
}

/** `aip:bot:{botId}:prev_owner` — 上一任 owner（接管 drain 定位旧 stream） */
export function botPrevOwnerKey(botId: string): string {
  return `${REDIS_KEY_PREFIX}bot:${botId}:prev_owner`;
}

/** `aip:gateways:members` — 存活 gatewayId 心跳集合（故障转移 drain 定位） */
export function gatewayMembersKey(): string {
  return `${REDIS_KEY_PREFIX}gateways:members`;
}

/** `aip:gateway:{gwId}:alive` — 单成员存活 TTL 键（members 集合无法给成员设 TTL） */
export function gatewayAliveKey(gatewayId: string): string {
  return `${REDIS_KEY_PREFIX}gateway:${gatewayId}:alive`;
}

/** `aip:session:{sid}:bot` — session → botId（回程精准定向，修 N3） */
export function sessionBotKey(sessionId: string): string {
  return `${REDIS_KEY_PREFIX}session:${sessionId}:bot`;
}

/** `aip:session:{sid}:gateway` — 持有该会话 WS 的 gatewayId（H5/wecom-h5 粘滞，修 N5） */
export function sessionGatewayKey(sessionId: string): string {
  return `${REDIS_KEY_PREFIX}session:${sessionId}:gateway`;
}

export const REDIS_KEY_PREFIX_VALUE = REDIS_KEY_PREFIX;

// ============================================================================
// 配置与类型
// ============================================================================

/** Bot 租约选主配置 */
export interface OwnershipConfig {
  /** 租约 TTL（毫秒），默认 30000 */
  leaseTtlMs: number;
  /** 心跳续租间隔（毫秒），默认 10000 */
  heartbeatMs: number;
  /** Redis 键前缀，默认 `aip:` */
  prefix: string;
}

const DEFAULT_OWNERSHIP_CONFIG: OwnershipConfig = {
  leaseTtlMs: 30000,
  heartbeatMs: 10000,
  prefix: REDIS_KEY_PREFIX,
};

/** 失主回调：续租失败（已易主）时触发，参数是失去的 botId */
export type OwnershipLostCallback = (botId: string) => void | Promise<void>;

// ============================================================================
// 稳定 GatewayId
// ============================================================================

/**
 * 解析稳定 GatewayId。
 *
 * 优先级：`GATEWAY_ID` 环境变量 → `os.hostname()` → 随机（告警）。
 * 稳定且重启不变（k8s StatefulSet Pod 名 `gw-a`）是故障转移 drain 可定向的前提；
 * 随机兜底仅用于本地无配置场景，并明确告警「非稳定 ID」。
 *
 * @returns 当前 Gateway 的稳定实例 ID
 */
export function getGatewayId(): string {
  const fromEnv = process.env['GATEWAY_ID'];
  if (fromEnv != null && fromEnv.length > 0) {
    return fromEnv;
  }

  try {
    const host = hostname();
    if (host != null && host.length > 0) {
      return host;
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to read hostname for GatewayId',
    );
  }

  const randomId = `gw-${randomUUID().slice(0, 8)}`;
  logger.warn(
    { gatewayId: randomId },
    'GATEWAY_ID env not set and hostname unavailable; generated ephemeral id (NOT stable across restarts)',
  );
  return randomId;
}

// ============================================================================
// Bot 租约选主
// ============================================================================

/**
 * 基于 Redis 租约的 Bot 所有权协调器。
 *
 * 并发安全：抢注走 Lua 脚本（`SET NX PX` + 同主续租 + 他主拒绝），保证任一时刻
 * 全局最多一个 owner。`claim` 成功即把 botId 记入 `ownedBots`，供心跳续租；
 * 心跳续租失败（已易主）触发 `onLost` 回调。
 */
export class BotOwnership {
  private readonly redis: Redis;
  private readonly gatewayId: string;
  private readonly leaseTtlMs: number;
  private readonly heartbeatMs: number;

  /** 当前本网关持有租约的 botId 集合（心跳续租用） */
  private readonly ownedBots = new Set<string>();
  /** 心跳定时器；未启动时为空 */
  private heartbeatTimer: NodeJS.Timeout | undefined;
  /** 失主回调（续租失败 = 已易主） */
  private onLost: OwnershipLostCallback | null = null;

  constructor(
    redis: Redis,
    gatewayId: string,
    cfg?: Partial<OwnershipConfig>,
  ) {
    this.redis = redis;
    this.gatewayId = gatewayId;
    this.leaseTtlMs = cfg?.leaseTtlMs ?? DEFAULT_OWNERSHIP_CONFIG.leaseTtlMs;
    this.heartbeatMs = cfg?.heartbeatMs ?? DEFAULT_OWNERSHIP_CONFIG.heartbeatMs;
  }

  /**
   * 抢注 / 续租 Bot 租约。
   *
   * - key 不存在 → `SET value=gatewayId NX PX ttl`，成为 owner（返回 true）。
   * - key 已属本网关 → 刷新 TTL，仍是 owner（返回 true，覆盖「重启同 ID 重认领」）。
   * - key 属其他存活网关 → 拒绝（返回 false，不抢活连接）。
   *
   * @param botId - 目标 Bot ID
   * @returns 是否成为/保持 owner
   */
  async claim(botId: string): Promise<boolean> {
    const script = `
      local cur = redis.call('GET', KEYS[1])
      if cur == ARGV[1] then
        redis.call('PEXPIRE', KEYS[1], ARGV[2])
        return 1
      end
      if cur and cur ~= ARGV[1] then
        return 0
      end
      redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
      return 1
    `;
    const result = (await this.redis.eval(
      script,
      1,
      botOwnerKey(botId),
      this.gatewayId,
      this.leaseTtlMs,
    )) as number;

    const owned = result === 1;
    if (owned) {
      this.ownedBots.add(botId);
    } else {
      this.ownedBots.delete(botId);
    }
    return owned;
  }

  /**
   * 续租（仅 owner 调用；失败表示已易主）。
   *
   * @param botId - 目标 Bot ID
   * @returns 续租是否成功（仍持有租约）
   */
  async renew(botId: string): Promise<boolean> {
    const cur = await this.redis.get(botOwnerKey(botId));
    if (cur === this.gatewayId) {
      await this.redis.pexpire(botOwnerKey(botId), this.leaseTtlMs);
      return true;
    }
    this.ownedBots.delete(botId);
    return false;
  }

  /**
   * 主动释放租约（优雅关闭）；仅当本网关仍是 owner 时才 DEL，避免误删他者。
   *
   * @param botId - 目标 Bot ID
   */
  async release(botId: string): Promise<void> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, botOwnerKey(botId), this.gatewayId);
    this.ownedBots.delete(botId);
  }

  /**
   * 释放本网关持有的全部租约（优雅关闭时批量调用）。
   */
  async releaseAll(): Promise<void> {
    const bots = [...this.ownedBots];
    for (const botId of bots) {
      await this.release(botId);
    }
  }

  /**
   * 读取当前 owner（出站 / 接管读）。
   *
   * @param botId - 目标 Bot ID
   * @returns owner gatewayId 或 null（无人持有）
   */
  async currentOwner(botId: string): Promise<string | null> {
    return this.redis.get(botOwnerKey(botId));
  }

  /**
   * 读取上一任 owner（drain 旧 stream 用）。
   *
   * @param botId - 目标 Bot ID
   * @returns 上一任 gatewayId 或 null
   */
  async prevOwner(botId: string): Promise<string | null> {
    return this.redis.get(botPrevOwnerKey(botId));
  }

  /**
   * 写入上一任 owner（本网关接管成功时记录，供后续 drain 定位旧 stream）。
   *
   * @param botId - 目标 Bot ID
   * @param gatewayId - 上一任 gatewayId
   */
  async setPrevOwner(botId: string, gatewayId: string): Promise<void> {
    await this.redis.set(botPrevOwnerKey(botId), gatewayId, 'EX', 300);
  }

  /**
   * 列出存活 gatewayId 集合（故障转移 drain 时定位历史 owner 的 stream）。
   *
   * @returns 存活 gatewayId 列表
   */
  async listGatewayMembers(): Promise<string[]> {
    const members = await this.redis.smembers(gatewayMembersKey());
    return members;
  }

  /**
   * 启动心跳：周期续租持有中的 bot 租约 + 写 gateway 存活集合；
   * 续租失败（已易主）触发 `onLost` 回调（上层据此停 bot）。
   *
   * @param onLost - 失主回调（可选，可后续通过 `setOnLost` 设置）
   */
  startHeartbeat(onLost?: OwnershipLostCallback): void {
    if (onLost != null) {
      this.onLost = onLost;
    }
    if (this.heartbeatTimer != null) {
      logger.warn('BotOwnership heartbeat already running');
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      void this.heartbeatTick();
    }, this.heartbeatMs);

    // 避免定时器阻止进程退出（与 botConfigSource 轮询同款处理）。
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
    logger.info(
      { gatewayId: this.gatewayId, heartbeatMs: this.heartbeatMs, leaseTtlMs: this.leaseTtlMs },
      'BotOwnership heartbeat started',
    );
  }

  /** 设置 / 替换失主回调 */
  setOnLost(onLost: OwnershipLostCallback): void {
    this.onLost = onLost;
  }

  /** 停止心跳 */
  stopHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    logger.info({ gatewayId: this.gatewayId }, 'BotOwnership heartbeat stopped');
  }

  /** 心跳单轮：写存活集合 + 续租已持有 bot；失主触发回调 */
  private async heartbeatTick(): Promise<void> {
    try {
      await this.redis.sadd(gatewayMembersKey(), this.gatewayId);
      await this.redis.set(
        gatewayAliveKey(this.gatewayId),
        '1',
        'EX',
        Math.ceil(this.leaseTtlMs / 1000),
      );
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'BotOwnership liveness heartbeat failed',
      );
    }

    const bots = [...this.ownedBots];
    for (const botId of bots) {
      let ok = false;
      try {
        ok = await this.renew(botId);
      } catch (error) {
        logger.warn(
          { botId, error: error instanceof Error ? error.message : String(error) },
          'Bot lease renew failed',
        );
        ok = false;
      }
      if (!ok) {
        this.ownedBots.delete(botId);
        if (this.onLost != null) {
          try {
            await this.onLost(botId);
          } catch (error) {
            logger.error(
              { botId, error: error instanceof Error ? error.message : String(error) },
              'onLost callback threw',
            );
          }
        }
      }
    }
  }
}
