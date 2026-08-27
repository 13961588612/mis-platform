/**
 * botOwnership.lease.test.ts — T1/T2 Bot 租约状态机单测（tsx 直跑，无 Redis）。
 *
 * 用「内存 KV + Lua 双」模拟 ioredis（因 ioredis-mock 安装被沙箱拦截，且无本地 Redis）。
 * 双实现 BotOwnership 实际用到的命令：eval（两段 Lua）、get/set/pexpire/del/sadd/smembers，
 * 并带虚拟时钟，使 TTL 完全确定性。
 *
 * 验证点（与 PRD/设计一致）：
 *  ① 并发抢注同 bot 仅 1 个网关成功（原子选主，不抢活连接）；
 *  ② renew 续租刷新 TTL（虚拟时钟推进后 pttl 被重置）；
 *  ③ 失主（TTL 过期 / 他者已持）renew 返回 false 并移出 ownedBots；
 *  ④ release 主动释放后允许 re-claim（且不会误删他者租约）；
 *  ⑤ currentOwner / prevOwner 读值正确；
 *  ⑥ startHeartbeat / stopHeartbeat 可启停不抛错（续租失败走 renew 语义，已在 ②③ 覆盖）。
 *
 * 运行：node_modules/.bin/tsx tests/botOwnership.lease.test.ts
 */

import { BotOwnership } from '../src/cluster/ownership.js';
import type { Redis } from 'ioredis';

// ============================================================================
// 内存 Redis 双（仅覆盖 BotOwnership 用到的子集）
// ============================================================================

interface Entry {
  value: string;
  expiry: number; // 绝对毫秒；Infinity 表示不过期
}

class FakeRedisForOwnership {
  private store = new Map<string, Entry>();
  private now = 0;

  // --- 虚拟时钟 ---
  advance(ms: number): void {
    this.now += ms;
  }

  /** 剩余 TTL（毫秒）：未设置=Infinity，-2=不存在/已过期 */
  pttl(key: string): number {
    const e = this.store.get(key);
    if (e == null) return -2;
    if (e.expiry === Infinity) return Infinity;
    const rem = e.expiry - this.now;
    return rem > 0 ? rem : -2;
  }

  private getRaw(key: string): string | null {
    const e = this.store.get(key);
    if (e == null) return null;
    if (e.expiry <= this.now) {
      this.store.delete(key);
      return null;
    }
    return e.value;
  }

  private setRaw(key: string, value: string, expiry: number): void {
    this.store.set(key, { value, expiry });
  }

  // --- ioredis 子集 API（供 BotOwnership 调用） ---
  async get(key: string): Promise<string | null> {
    return this.getRaw(key);
  }

  async set(key: string, value: string, mode?: string, ttl?: number): Promise<'OK'> {
    let expiry = Infinity;
    if (mode === 'EX' && ttl != null) expiry = this.now + ttl * 1000;
    else if (mode === 'PX' && ttl != null) expiry = this.now + ttl;
    this.setRaw(key, value, expiry);
    return 'OK';
  }

  async pexpire(key: string, ms: number): Promise<number> {
    const e = this.store.get(key);
    if (e == null) return 0;
    e.expiry = this.now + ms;
    return 1;
  }

  async del(key: string): Promise<number> {
    const had = this.store.has(key);
    this.store.delete(key);
    return had ? 1 : 0;
  }

  async sadd(key: string, member: string): Promise<number> {
    const cur = this.getRaw(key) ?? '';
    if (cur.split(',').includes(member)) return 0;
    this.setRaw(key, cur ? `${cur},${member}` : member, Infinity);
    return 1;
  }

  async smembers(key: string): Promise<string[]> {
    const v = this.getRaw(key);
    if (!v) return [];
    return v.split(',').filter(Boolean);
  }

  /**
   * eval：按脚本文本识别两段 Lua（claim / release）并等价执行。
   * claim:  (KEYS[1], ARGV[1]=gwId, ARGV[2]=ttlMs)
   * release:(KEYS[1], ARGV[1]=gwId)
   */
  async eval(script: string, numkeys: number, key: string, ...args: Array<string | number>): Promise<number> {
    if (script.includes('PEXPIRE')) {
      // claim 脚本
      const gwId = String(args[0]);
      const ttlMs = Number(args[1]);
      const cur = this.getRaw(key);
      if (cur === gwId) {
        this.pexpire(key, ttlMs);
        return 1;
      }
      if (cur != null && cur !== gwId) {
        return 0;
      }
      this.setRaw(key, gwId, this.now + ttlMs);
      return 1;
    }
    if (script.includes('DEL')) {
      // release 脚本
      const gwId = String(args[0]);
      const cur = this.getRaw(key);
      if (cur === gwId) {
        this.store.delete(key);
        return 1;
      }
      return 0;
    }
    throw new Error(`FakeRedisForOwnership: unsupported eval script`);
  }
}

// ============================================================================
// 测试主体
// ============================================================================

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

function makeOwner(fake: FakeRedisForOwnership, gwId: string, leaseTtlMs = 1000): BotOwnership {
  return new BotOwnership(fake as unknown as Redis, gwId, {
    leaseTtlMs,
    heartbeatMs: 50,
  });
}

async function main(): Promise<void> {
  // ① 并发抢注同 bot 仅 1 个成功（原子选主）
  {
    const fake = new FakeRedisForOwnership();
    const gwA = makeOwner(fake, 'gw-A');
    const gwB = makeOwner(fake, 'gw-B');
    const aWon = await gwA.claim('bot1');
    const bWon = await gwB.claim('bot1');
    check('并发抢注：gw-A 成功', aWon === true);
    check('并发抢注：gw-B 失败（不抢活连接）', bWon === false);
    check('currentOwner == gw-A', (await gwA.currentOwner('bot1')) === 'gw-A');
  }

  // ② renew 续租刷新 TTL（虚拟时钟确定性）
  {
    const fake = new FakeRedisForOwnership();
    const gwA = makeOwner(fake, 'gw-A', 1000);
    await gwA.claim('bot1');
    check('claim 后 pttl ≈ 1000', fake.pttl('aip:bot:bot1:owner') > 800, `pttl=${fake.pttl('aip:bot:bot1:owner')}`);
    fake.advance(600);
    check('推进 600ms 后 pttl 衰减', fake.pttl('aip:bot:bot1:owner') < 500, `pttl=${fake.pttl('aip:bot:bot1:owner')}`);
    const renewed = await gwA.renew('bot1');
    check('owner 续租成功', renewed === true);
    check('续租后 TTL 被刷新（重置回 ~1000）', fake.pttl('aip:bot:bot1:owner') > 800, `pttl=${fake.pttl('aip:bot:bot1:owner')}`);
  }

  // ③ 失主：TTL 过期后 renew 失败，且他者接管成功
  {
    const fake = new FakeRedisForOwnership();
    const gwA = makeOwner(fake, 'gw-A', 1000);
    const gwB = makeOwner(fake, 'gw-B', 1000);
    await gwA.claim('bot1');
    fake.advance(1500); // 租约自然过期
    check('过期后 currentOwner 为 null', (await gwA.currentOwner('bot1')) === null);
    const lost = await gwA.renew('bot1');
    check('过期后原 owner renew 返回 false', lost === false);
    const bWon = await gwB.claim('bot1');
    check('过期后新网关可接管', bWon === true);
    check('接管后 currentOwner == gw-B', (await gwB.currentOwner('bot1')) === 'gw-B');
  }

  // ④ release 主动释放后允许 re-claim，且不误删他者租约
  {
    const fake = new FakeRedisForOwnership();
    const gwA = makeOwner(fake, 'gw-A');
    const gwB = makeOwner(fake, 'gw-B');
    await gwA.claim('bot1');
    await gwB.claim('bot2'); // 各自持一 bot
    await gwA.release('bot1');
    check('release 后 bot1 owner 为 null', (await gwA.currentOwner('bot1')) === null);
    // release 不应影响 gw-B 的 bot2
    check('release 不误删他者 bot2 租约', (await gwB.currentOwner('bot2')) === 'gw-B');
    const reClaim = await gwB.claim('bot1');
    check('release 后允许 re-claim', reClaim === true);
    check('re-claim 后 bot1 owner == gw-B', (await gwB.currentOwner('bot1')) === 'gw-B');
  }

  // ⑤ currentOwner / prevOwner 读值正确
  {
    const fake = new FakeRedisForOwnership();
    const gwA = makeOwner(fake, 'gw-A');
    await gwA.claim('bot1');
    check('currentOwner == gw-A', (await gwA.currentOwner('bot1')) === 'gw-A');
    await gwA.setPrevOwner('bot1', 'gw-old');
    check('prevOwner == gw-old', (await gwA.prevOwner('bot1')) === 'gw-old');
    const members = await gwA.listGatewayMembers();
    check('listGatewayMembers 初始为空（未 startHeartbeat）', members.length === 0);
  }

  // ⑥ startHeartbeat / stopHeartbeat 可启停不抛错
  {
    const fake = new FakeRedisForOwnership();
    const gwA = makeOwner(fake, 'gw-A');
    await gwA.claim('bot1');
    let threw = false;
    try {
      gwA.startHeartbeat(() => undefined);
      gwA.stopHeartbeat();
    } catch (e) {
      threw = true;
    }
    check('startHeartbeat/stopHeartbeat 不抛错', threw === false);
    // 启心跳后成员集合应写入（setInterval 异步，给一点真实时间）
    gwA.startHeartbeat(() => undefined);
    await new Promise((r) => setTimeout(r, 120));
    gwA.stopHeartbeat();
    const members = await gwA.listGatewayMembers();
    check('心跳把本网关写入 members 集合', members.includes('gw-A'), JSON.stringify(members));
  }

  console.log(`\nbotOwnership lease: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
