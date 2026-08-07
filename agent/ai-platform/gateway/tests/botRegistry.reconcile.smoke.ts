/**
 * botRegistry.reconcile.smoke.ts — O1f-2 收敛侧冒烟测试（无 jest/vitest，用 tsx 直跑）。
 *
 * 桩掉 WecomBotAdapter 的真实 WS 连接（reconcile 只测差量决策，不连企微），覆盖：
 *  ① 新增：空注册表 reconcile([A]) ⇒ entries 有 A、report.started=[A]
 *  ② 元数据更新：仅 name/boundAgentId 变更 ⇒ report.metadataUpdated、adapter 实例不变
 *  ③ 连接参数变更：wsUrl/secret 变更 ⇒ report.restarted、adapter 实例被替换
 *  ④ sessionOwner 保留：重启路径不 drop（回程事件仍精确投递单实例）
 *  ⑤ 消失：reconcile([]) ⇒ stop + removed，注册表归零
 *  ⑥ 幂等：同配置再次 reconcile ⇒ 报告全空（no-op）
 *  ⑦ 停用 Bot 已停止时消失 ⇒ removed 记录但 stopped 不重复记
 *
 * 运行：node_modules/.bin/tsx tests/botRegistry.reconcile.smoke.ts
 * 退出码：0=全部通过，1=存在失败。
 */

import { BotRegistry, type ReconcileReport } from '../src/channels/BotRegistry.js';
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

// ---------------------------------------------------------------------------
// 桩掉 WecomBotAdapter：start 成功、stop no-op、onAgentTextDelta 记录调用
// ---------------------------------------------------------------------------

type StartCallback = (message: { sessionId: string }) => void | Promise<void>;
const startCallbacks: StartCallback[] = [];
const deltaTargets: WecomBotAdapter[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(WecomBotAdapter.prototype as any).start = async function start(this: WecomBotAdapter, onMessage: StartCallback): Promise<void> {
  startCallbacks.push(onMessage);
};
(WecomBotAdapter.prototype as any).stop = function stop(): void {
  /* 桩：不触发真实 WS disconnect */
};
(WecomBotAdapter.prototype as any).onAgentTextDelta = async function onAgentTextDelta(
  this: WecomBotAdapter,
  _sessionId: string,
  _delta: string,
): Promise<void> {
  deltaTargets.push(this);
};

function baseConfig(botId: string, overrides: Partial<BotRuntimeConfig> = {}): BotRuntimeConfig {
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
    ...overrides,
  };
}

function emptyReport(): ReconcileReport {
  return { started: [], stopped: [], restarted: [], metadataUpdated: [], removed: [], errors: [] };
}

function reportEqual(a: ReconcileReport, b: ReconcileReport): boolean {
  const key = (r: ReconcileReport): string =>
    JSON.stringify([r.started, r.stopped, r.restarted, r.metadataUpdated, r.removed, r.errors]);
  return key(a) === key(b);
}

async function main(): Promise<void> {
  console.log('\n[① 新增] 空注册表 reconcile([A])');
  {
    const registry = new BotRegistry();
    await registry.startAll(async () => undefined); // 接线 inboundHandler
    const report = await registry.reconcile([baseConfig('A')]);
    check('entries 有 A', registry.size() === 1 && registry.getAdapter('A') != null);
    check('started=[A]', report.started.join(',') === 'A', `started=${report.started}`);
    check('无错误', report.errors.length === 0, JSON.stringify(report.errors));
  }

  console.log('\n[② 元数据更新] 仅 name/boundAgentId 变更 ⇒ 不重启');
  {
    const registry = new BotRegistry();
    await registry.startAll(async () => undefined);
    await registry.reconcile([baseConfig('A')]);
    const adapterBefore = registry.getAdapter('A');
    const report = await registry.reconcile([
      baseConfig('A', { name: 'Renamed', boundAgentId: 'crm-assistant' }),
    ]);
    check('metadataUpdated=[A]', report.metadataUpdated.join(',') === 'A', `meta=${report.metadataUpdated}`);
    check('restarted 为空', report.restarted.length === 0);
    check('adapter 实例未变', registry.getAdapter('A') === adapterBefore);
    check('name 已更新', registry.list()[0]?.name === 'Renamed', `name=${registry.list()[0]?.name}`);
    check('boundAgentId 已更新', registry.list()[0]?.boundAgentId === 'crm-assistant');
  }

  console.log('\n[③ 连接参数变更] wsUrl/secret 变更 ⇒ 重启');
  {
    const registry = new BotRegistry();
    await registry.startAll(async () => undefined);
    await registry.reconcile([baseConfig('A')]);
    const adapterBefore = registry.getAdapter('A');
    const report = await registry.reconcile([
      baseConfig('A', { wsUrl: 'wss://new.example/ws' }),
    ]);
    check('restarted=[A]', report.restarted.join(',') === 'A', `restarted=${report.restarted}`);
    check('adapter 实例被替换', registry.getAdapter('A') !== adapterBefore);
    check('新配置生效', registry.list()[0]?.wsUrl === 'wss://new.example/ws');
  }

  console.log('\n[④ sessionOwner 保留] 重启路径不 drop 归属');
  {
    startCallbacks.length = 0;
    deltaTargets.length = 0;
    const registry = new BotRegistry();
    await registry.startAll(async () => undefined);
    await registry.reconcile([baseConfig('A'), baseConfig('B')]);
    // startAll/reconcile 按插入序 push 回调：A 在前（index 0），B 在后（index 1）。
    // 模拟 A 的入站消息 → rememberSessionOwner('sess-1', 'A')
    await startCallbacks[0]!({ sessionId: 'sess-1' });

    // 仅重启 A（wsUrl 变更），B 不动
    const report = await registry.reconcile([
      baseConfig('A', { wsUrl: 'wss://new.example/ws' }),
      baseConfig('B'),
    ]);
    check('A 重启', report.restarted.join(',') === 'A', `restarted=${report.restarted}`);

    // 若 sessionOwner 保留 ⇒ 回程只投递 A 的新 adapter（1 次）；若被 drop ⇒ 广播给 A+B（2 次）
    await registry.dispatchTextDelta('sess-1', 'hi');
    check(
      '回程精确投递 1 次（归属保留）',
      deltaTargets.length === 1,
      `targets=${deltaTargets.length}`,
    );
  }

  console.log('\n[⑤ 消失] reconcile([]) ⇒ stop + removed，注册表归零');
  {
    const registry = new BotRegistry();
    await registry.startAll(async () => undefined);
    await registry.reconcile([baseConfig('A'), baseConfig('B')]);
    const report = await registry.reconcile([]);
    check('removed=[A,B]', report.removed.sort().join(',') === 'A,B', `removed=${report.removed}`);
    check('stopped=[A,B]（原为运行中）', report.stopped.sort().join(',') === 'A,B', `stopped=${report.stopped}`);
    check('注册表归零', registry.size() === 0, `size=${registry.size()}`);
  }

  console.log('\n[⑥ 幂等] 同配置再次 reconcile ⇒ 报告全空');
  {
    const registry = new BotRegistry();
    await registry.startAll(async () => undefined);
    await registry.reconcile([baseConfig('A'), baseConfig('B')]);
    const report = await registry.reconcile([baseConfig('A'), baseConfig('B')]);
    check('报告全空', reportEqual(report, emptyReport()), JSON.stringify(report));
    check('size 不变', registry.size() === 2);
  }

  console.log('\n[⑦ 已停止条目消失] removed 记录、stopped 不重复记');
  {
    const registry = new BotRegistry();
    await registry.startAll(async () => undefined);
    await registry.reconcile([baseConfig('A')]);
    registry.stopBot('A'); // 先手动停用（模拟 O1f-1 独立停用）
    const report = await registry.reconcile([]);
    check('removed=[A]', report.removed.join(',') === 'A', `removed=${report.removed}`);
    check('stopped 为空（A 本就未运行）', report.stopped.length === 0, `stopped=${report.stopped}`);
    check('注册表归零', registry.size() === 0);
  }

  console.log(`\nbotRegistry.reconcile 冒烟结果：${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
