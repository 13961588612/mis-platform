/**
 * botRegistry.lease.test.ts — T2 租约门控 + T4 rememberSessionBot 写 Redis 单测（tsx 直跑）。
 *
 * 复用既有 smoke 的桩策略（桩掉 WecomBotAdapter 真实 WS 连接），新增：
 *  ① startOwnedBots 仅启动 isOwner=true 的 bot；非 owner 不启动；
 *  ② 租约翻转（A→B）：原 owner A 被停、新 owner B 起（失主停、得主起，修 K1/N2）；
 *  ③ rememberSessionBot 异步写 aip:session:{sid}:bot（T4 修 N3，跨 gateway 可见）。
 * 纯逻辑，无需 Redis（redis 以 fake 注入验证写调用）。
 *
 * 运行：node_modules/.bin/tsx tests/botRegistry.lease.test.ts
 */

import { BotRegistry } from '../src/channels/BotRegistry.js';
import { WecomBotAdapter } from '../src/adapters/wecom/WecomBotAdapter.js';
import type { BotRuntimeConfig } from '../src/config/botConfigSource.js';

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

// 桩掉真实 WS 连接
(WecomBotAdapter.prototype as unknown as { start: unknown }).start = async function start(): Promise<void> {
  /* 桩：不连企微 */
};
(WecomBotAdapter.prototype as unknown as { stop: unknown }).stop = function stop(): void {
  /* 桩：不触发真实 disconnect */
};
(WecomBotAdapter.prototype as unknown as { onAgentTextDelta: unknown }).onAgentTextDelta =
  async function onAgentTextDelta(): Promise<void> {
    /* 桩 */
  };
(WecomBotAdapter.prototype as unknown as { isConnected: unknown }).isConnected = function isConnected(): boolean {
  return false;
};

function baseConfig(botId: string): BotRuntimeConfig {
  return {
    botId,
    name: `Bot ${botId}`,
    enabled: true,
    secret: `secret-${botId}`,
    wsUrl: `wss://openws.work.weixin.qq.com/${botId}`,
    heartbeatIntervalSec: 30,
    heartbeatTimeoutCount: 3,
    maxReconnectAttempts: 10,
    initialReconnectDelayMs: 1000,
    maxReconnectDelayMs: 30000,
    reconnectBackoffMultiplier: 2,
    subscribeTimeoutMs: 10000,
    sourceName: 'AI智能助手',
  } as BotRuntimeConfig;
}

async function main(): Promise<void> {
  // ① 仅 owner 启动
  {
    const reg = new BotRegistry();
    await reg.startAll(async () => undefined);
    reg.register([baseConfig('A'), baseConfig('B')]);
    const started = await reg.startOwnedBots(
      async () => undefined,
      async (botId) => botId === 'A',
    );
    check('仅 owner A 启动，started=1', started === 1, `started=${started}`);
    const a = reg.list().find((x) => x.botId === 'A')!;
    const b = reg.list().find((x) => x.botId === 'B')!;
    check('A started=true', a.started === true);
    check('B started=false（非 owner 不启动）', b.started === false);
  }

  // ② 租约翻转：A→B
  {
    const reg = new BotRegistry();
    await reg.startAll(async () => undefined);
    reg.register([baseConfig('A'), baseConfig('B')]);
    await reg.startOwnedBots(async () => undefined, async (botId) => botId === 'A');
    const started2 = await reg.startOwnedBots(
      async () => undefined,
      async (botId) => botId === 'B',
    );
    check('翻转后 B 新起，started=1', started2 === 1, `started=${started2}`);
    const a2 = reg.list().find((x) => x.botId === 'A')!;
    const b2 = reg.list().find((x) => x.botId === 'B')!;
    check('A 失主被停（started=false）', a2.started === false);
    check('B 得主起（started=true）', b2.started === true);
  }

  // ③ rememberSessionBot 写 Redis（aip:session:{sid}:bot, EX 86400）
  {
    const reg = new BotRegistry();
    const calls: Array<{ key: string; val: string; mode: string; ttl: number }> = [];
    const fakeRedis = {
      set: async (key: string, val: string, mode: string, ttl: number) => {
        calls.push({ key, val, mode, ttl });
        return 'OK';
      },
    };
    reg.bindRedis(fakeRedis as unknown as Parameters<BotRegistry['bindRedis']>[0]);
    await reg.rememberSessionBot('sessX', 'botX');
    check(
      'rememberSessionBot 写 aip:session:sessX:bot',
      calls.some(
        (c) => c.key === 'aip:session:sessX:bot' && c.val === 'botX' && c.mode === 'EX' && c.ttl === 86400,
      ),
      JSON.stringify(calls),
    );
  }

  console.log(`\nbotRegistry lease: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
