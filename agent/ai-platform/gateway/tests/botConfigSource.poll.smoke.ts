/**
 * botConfigSource.poll.smoke.ts — O1f-2 轮询拉取侧冒烟测试（无 jest/vitest，用 tsx 直跑）。
 *
 * 覆盖 fetchRuntime 三态语义 + startPolling 生命周期：
 *  ① 无 token ⇒ fetchRuntime 返回 null（fail-closed，不发 HTTP）
 *  ② 非 200 ⇒ null（跳过本轮，严禁当空清单）
 *  ③ 200 + 空清单 ⇒ []（收敛到零）
 *  ④ 200 + 正常清单 ⇒ 数组（差量；snake_case → camelCase 映射正确）
 *  ⑤ startPolling(interval<=0) ⇒ 不启动，返回幂等 stop
 *  ⑥ startPolling 无 token ⇒ 不启动
 *  ⑦ startPolling(小周期) ⇒ 立即执行一轮并回调；stopPolling 后不再回调
 *
 * 运行：node_modules/.bin/tsx tests/botConfigSource.poll.smoke.ts
 * 退出码：0=全部通过，1=存在失败。
 */

import axios from 'axios';
import {
  BotConfigSource,
  type BotConnectionDefaults,
  type BotRuntimeConfig,
} from '../src/config/botConfigSource.js';

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

// ---------------------------------------------------------------------------
// 罐装 HTTP 层：拦截 axios.create，让 BotConfigSource 构造出的实例返回可编程响应
// ---------------------------------------------------------------------------

type CannedResponse = { status: number; data: unknown };
let canned: CannedResponse | null = null;
let getCalls = 0;

const originalCreate = axios.create.bind(axios);
(axios as unknown as { create: (...args: unknown[]) => unknown }).create = ((
  ...args: unknown[]
): unknown => {
  const instance = originalCreate(...(args as Parameters<typeof axios.create>));
  const realGet = instance.get.bind(instance);
  instance.get = (async (...callArgs: unknown[]) => {
    getCalls += 1;
    if (canned != null) {
      return { status: canned.status, data: canned.data };
    }
    return realGet(...(callArgs as Parameters<typeof instance.get>));
  }) as typeof instance.get;
  return instance;
}) as never;

function makeSource(internalToken: string): BotConfigSource {
  const defaults: BotConnectionDefaults = {
    heartbeatIntervalSec: 30,
    heartbeatTimeoutCount: 3,
    maxReconnectAttempts: 10,
    initialReconnectDelayMs: 1000,
    maxReconnectDelayMs: 30000,
    reconnectBackoffMultiplier: 2,
    subscribeTimeoutMs: 10000,
    defaultWsUrl: 'wss://openws.work.weixin.qq.com',
    sourceName: 'AI智能助手',
  };
  return new BotConfigSource({
    backendBaseUrl: 'http://backend.invalid:8000',
    internalToken,
    timeoutMs: 1000,
    defaults,
    envFallback: { botId: '', secret: '', wsUrl: '' },
  });
}

function baseConfig(overrides: Partial<BotRuntimeConfig>): BotRuntimeConfig {
  return {
    botId: 'bot-1',
    name: 'Bot 1',
    enabled: true,
    secret: 'secret-1',
    wsUrl: 'wss://openws.work.weixin.qq.com',
    heartbeatIntervalSec: 30,
    heartbeatTimeoutCount: 3,
    maxReconnectAttempts: 10,
    initialReconnectDelayMs: 1000,
    maxReconnectDelayMs: 30000,
    reconnectBackoffMultiplier: 2,
    subscribeTimeoutMs: 10000,
    sourceName: 'AI智能助手',
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log('\n[① 无 token] fetchRuntime 返回 null（fail-closed，不发 HTTP）');
  {
    canned = { status: 200, data: { code: 0, data: [] } };
    getCalls = 0;
    const source = makeSource('');
    const result = await source.fetchRuntime();
    check('null', result === null, `got ${String(result)}`);
    check('未发 HTTP', getCalls === 0, `getCalls=${getCalls}`);
  }

  console.log('\n[② 非 200] fetchRuntime 返回 null（跳过本轮）');
  {
    canned = { status: 503, data: { code: 5001, message: 'boom' } };
    getCalls = 0;
    const source = makeSource('tok');
    const result = await source.fetchRuntime();
    check('null', result === null, `got ${String(result)}`);
    check('发过一次 HTTP', getCalls === 1, `getCalls=${getCalls}`);
  }

  console.log('\n[③ 200 + 空清单] fetchRuntime 返回 []（收敛到零）');
  {
    canned = { status: 200, data: { code: 0, data: [] } };
    const source = makeSource('tok');
    const result = await source.fetchRuntime();
    check('空数组且非 null', result !== null && Array.isArray(result) && result.length === 0,
      `got ${JSON.stringify(result)}`);
  }

  console.log('\n[④ 200 + 正常清单] snake_case → camelCase 映射');
  {
    canned = {
      status: 200,
      data: {
        code: 0,
        data: [
          {
            bot_id: 'bot-1',
            name: 'Bot 1',
            enabled: true,
            ws_url: 'wss://custom.example/ws',
            secret: 's3cr3t',
            bound_agent_id: 'crm-assistant',
          },
          { bot_id: '', name: 'bad', enabled: true, ws_url: '', secret: '' },
        ],
      },
    };
    const source = makeSource('tok');
    const result = await source.fetchRuntime();
    check('返回数组', Array.isArray(result), `got ${String(result)}`);
    if (result != null) {
      check('过滤掉缺 botId/secret 项', result.length === 1, `len=${result.length}`);
      const cfg = result[0]!;
      check('botId 映射', cfg.botId === 'bot-1');
      check('wsUrl 映射', cfg.wsUrl === 'wss://custom.example/ws');
      check('secret 透传', cfg.secret === 's3cr3t');
      check('boundAgentId 映射', cfg.boundAgentId === 'crm-assistant');
      check('name 映射', cfg.name === 'Bot 1');
    }
  }

  console.log('\n[⑤ interval<=0] startPolling 不启动，返回幂等 stop');
  {
    getCalls = 0;
    canned = { status: 200, data: { code: 0, data: [] } };
    const source = makeSource('tok');
    let callbacks = 0;
    const stop = source.startPolling(0, () => {
      callbacks++;
    });
    await new Promise((r) => setTimeout(r, 30));
    check('无回调', callbacks === 0, `callbacks=${callbacks}`);
    check('无 HTTP', getCalls === 0, `getCalls=${getCalls}`);
    stop();
    stop(); // 幂等
    check('stop 幂等不抛', true);
  }

  console.log('\n[⑥ 无 token] startPolling 不启动');
  {
    getCalls = 0;
    const source = makeSource('');
    let callbacks = 0;
    const stop = source.startPolling(10, () => {
      callbacks++;
    });
    await new Promise((r) => setTimeout(r, 30));
    check('无回调', callbacks === 0, `callbacks=${callbacks}`);
    check('无 HTTP', getCalls === 0, `getCalls=${getCalls}`);
    stop();
  }

  console.log('\n[⑦ 小周期] 立即执行一轮 + 周期回调；stopPolling 后停止');
  {
    canned = {
      status: 200,
      data: {
        code: 0,
        data: [{ bot_id: 'bot-x', name: 'X', enabled: true, ws_url: '', secret: 's' }],
      },
    };
    const source = makeSource('tok');
    let rounds = 0;
    let lastPayload: BotRuntimeConfig[] | null = null;
    const stop = source.startPolling(15, (configs) => {
      rounds++;
      lastPayload = configs;
    });
    // 立即执行一轮（异步），再等 2 个周期
    await new Promise((r) => setTimeout(r, 60));
    check('至少 2 轮（立即 1 + 周期 ≥1）', rounds >= 2, `rounds=${rounds}`);
    check(
      '回调收到数组',
      lastPayload != null && Array.isArray(lastPayload) && lastPayload[0]?.botId === 'bot-x',
      `payload=${JSON.stringify(lastPayload)}`,
    );
    stop();
    const roundsAfterStop = rounds;
    await new Promise((r) => setTimeout(r, 40));
    check('stop 后不再回调', rounds === roundsAfterStop, `rounds=${rounds}`);
  }

  console.log(`\nbotConfigSource.poll 冒烟结果：${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
