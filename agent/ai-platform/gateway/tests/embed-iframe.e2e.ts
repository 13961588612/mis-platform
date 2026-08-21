/**
 * embed-iframe.e2e.ts — E2E 三条闭环用例（T10，R47 多宿主同步 + BUG-1 回归）。
 *
 * 闭环一（iframe 嵌入）：外部宿主（crm-web）与后台自身（mis-admin-web）同时
 * 打开同一会话 S1，一端 A2UI 操作 → Gateway sendRaw → **两端都收到**（多宿主广播）；
 * 一端离线重连后，最近 N 条 A2UI surface 从 Redis List 重放（离线恢复）。
 *
 * 闭环二（后台自身）：mis-admin-web 单端会话 S2，旧协议 agent_event（send）
 * 与新协议前端消息（sendRaw）都能原样送达，连接生命周期（注册/注销/计数）正确。
 *
 * 闭环三（BUG-1 回归）：真实前端连接 query 不带 hostId/clientId——注册两个无
 * clientId 端点，注销其一（close 从连接对象取绑定 clientId），另一不受影响、
 * 广播不中断；空 clientId 注销 no-op；hostId 维度精确匹配生效。
 *
 * 纯逻辑 + 内存 Redis 桩，无需真实 Gateway / Redis。
 *
 * 运行：node_modules/.bin/tsx tests/embed-iframe.e2e.ts
 */

import { H5Adapter, DEFAULT_HOST_ID, getBoundClientId } from '../src/adapters/h5/H5Adapter.js';
import { sessionA2uiReplayKey } from '../src/cluster/ownership.js';
import type { Redis } from 'ioredis';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyReply } from 'fastify';
import type { AgentEvent } from '../src/channels/ChannelCapability.js';

// ============================================================================
// 测试桩
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

/** 内存 Redis 桩（覆盖 H5Adapter 用到的 set/del/rpush/lrange/ltrim/multi）。 */
class FakeRedis {
  private store = new Map<string, string | string[]>();

  async set(key: string, value: string, _mode?: string, _ttl?: number): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n += 1;
    }
    return n;
  }

  async rpush(key: string, value: string): Promise<number> {
    const existing = this.store.get(key);
    const list = Array.isArray(existing) ? [...existing] : [];
    list.push(value);
    this.store.set(key, list);
    return list.length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const existing = this.store.get(key);
    const list = Array.isArray(existing) ? existing : [];
    const from = start < 0 ? Math.max(list.length + start, 0) : start;
    const to = stop < 0 ? Math.max(list.length + stop, 0) : stop;
    return list.slice(from, to + 1);
  }

  async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    const existing = this.store.get(key);
    const list = Array.isArray(existing) ? existing : [];
    const from = start < 0 ? Math.max(list.length + start, 0) : start;
    const to = stop < 0 ? Math.max(list.length + stop, 0) : stop;
    this.store.set(key, list.slice(from, to + 1));
    return 'OK';
  }

  multi(): {
    rpush: (key: string, value: string) => unknown;
    ltrim: (key: string, start: number, stop: number) => unknown;
    exec: () => Promise<unknown[]>;
  } {
    const ops: Array<() => Promise<unknown>> = [];
    return {
      rpush: (key: string, value: string) => {
        ops.push(() => this.rpush(key, value));
        return undefined;
      },
      ltrim: (key: string, start: number, stop: number) => {
        ops.push(() => this.ltrim(key, start, stop));
        return undefined;
      },
      exec: async () => {
        const out: unknown[] = [];
        for (const op of ops) {
          out.push(await op());
        }
        return out;
      },
    };
  }
}

/** WebSocket 桩（记录收到的消息，readyState=OPEN；与 ws 库一致暴露实例 OPEN 常量）。 */
class FakeWs {
  static readonly OPEN = 1;
  readonly OPEN = FakeWs.OPEN;
  readyState = FakeWs.OPEN;
  received: unknown[] = [];

  send(data: string): void {
    this.received.push(JSON.parse(data));
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = 3;
  }
}

/** FastifyReply 桩（SSE：raw.write 收集 data 行）。 */
class FakeReply {
  raw = {
    writeHead: (_status: number, _headers: Record<string, string>) => undefined,
    write: (chunk: string) => {
      this.chunks.push(chunk);
    },
    end: () => {
      this.ended = true;
    },
  };
  chunks: string[] = [];
  ended = false;
}

function parseSseChunks(chunks: string[]): unknown[] {
  const out: unknown[] = [];
  for (const chunk of chunks) {
    const match = /^data: (.*)\n\n$/.exec(chunk);
    if (match != null && match[1] && match[1] !== ': connected') {
      out.push(JSON.parse(match[1]));
    }
  }
  return out;
}

/** 构造一个 a2ui_surface 前端消息。 */
function surfaceMessage(surfaceId: string): Record<string, unknown> {
  return {
    type: 'a2ui_surface',
    surfaceId,
    operations: [
      {
        op: 'createSurface',
        surfaceId,
        components: [{ id: 'data-table-1', component: 'data-table', props: {} }],
      },
    ],
  };
}

// ============================================================================
// 闭环一：iframe 嵌入多宿主同步 + 离线重放
// ============================================================================

async function scenarioIframeEmbed(): Promise<void> {
  console.log('\n[闭环一] iframe 嵌入：多宿主同步 + 离线重连重放');

  const adapter = new H5Adapter();
  const redis = new FakeRedis();
  adapter.bindRedis(redis as unknown as Redis);

  const wsAdmin = new FakeWs();
  const wsCrm = new FakeWs();

  // 两端同时打开同一会话 S1（后台自身 + 外部 CRM 宿主）
  await adapter.registerWsConnection('S1', wsAdmin as unknown as WebSocket, 'gw-1', {
    hostId: DEFAULT_HOST_ID,
    clientId: 'admin-tab',
  });
  await adapter.registerWsConnection('S1', wsCrm as unknown as WebSocket, 'gw-1', {
    hostId: 'crm-web',
    clientId: 'crm-tab',
  });

  check(
    'S1 注册两个宿主端点',
    adapter.getSessionEndpoints('S1').length === 2,
    `endpoints=${adapter.getSessionEndpoints('S1').length}`,
  );

  // 一端操作 → Agent 增量更新 → Gateway 向该 sessionId 所有连接广播
  const first = surfaceMessage('sfc-a');
  await adapter.sendRaw(first, 'S1');

  check(
    'a2ui_surface 广播到后台自身端',
    wsAdmin.received.length === 1 &&
      (wsAdmin.received[0] as { type: string }).type === 'a2ui_surface',
  );
  check(
    'a2ui_surface 广播到 CRM 宿主端（多宿主同步）',
    wsCrm.received.length === 1 &&
      (wsCrm.received[0] as { type: string }).type === 'a2ui_surface' &&
      (wsCrm.received[0] as { surfaceId: string }).surfaceId === 'sfc-a',
  );

  // 缓存写入 Redis List
  const cached = await redis.lrange(sessionA2uiReplayKey('S1'), 0, -1);
  check('a2ui_surface 写入 Redis List（离线重放源）', cached.length === 1, `len=${cached.length}`);

  // CRM 端离线（关 Tab）→ 重连（新端点）
  await adapter.unregisterWsConnection('S1', 'crm-tab');
  check('CRM 端注销后剩余 1 个端点', adapter.getSessionEndpoints('S1').length === 1);

  const second = surfaceMessage('sfc-b');
  await adapter.sendRaw(second, 'S1');
  check(
    '离线期间新 surface 只推给在线端（后台自身）',
    wsAdmin.received.length === 2 && (wsAdmin.received[0] as { surfaceId: string }).surfaceId === 'sfc-a',
  );
  check('离线期间 CRM 旧连接收不到', wsCrm.received.length === 1);

  // CRM 重连 → 最近 N 条 A2UI operations 重放（只推给新连接，不重复广播）
  const wsCrm2 = new FakeWs();
  await adapter.registerWsConnection('S1', wsCrm2 as unknown as WebSocket, 'gw-1', {
    hostId: 'crm-web',
    clientId: 'crm-tab',
  });
  check(
    '重连后重放缓存 surface（离线恢复）',
    wsCrm2.received.length === 2 &&
      (wsCrm2.received[0] as { surfaceId: string }).surfaceId === 'sfc-a' &&
      (wsCrm2.received[1] as { surfaceId: string }).surfaceId === 'sfc-b',
    `received=${JSON.stringify(wsCrm2.received)}`,
  );
  check('重放不影响在线端（不重复广播）', wsAdmin.received.length === 2);

  // 旧协议 agent_event 同样多宿主广播
  const agentEvent: AgentEvent = { type: 'done' } as AgentEvent;
  await adapter.send(agentEvent, 'S1');
  check(
    '旧协议 agent_event 广播到两个在线端',
    wsAdmin.received.length === 3 && wsCrm2.received.length === 3,
    `admin=${wsAdmin.received.length}, crm=${wsCrm2.received.length}`,
  );

  // 全部离线 → 无活跃连接
  await adapter.unregisterWsConnection('S1', 'admin-tab');
  await adapter.unregisterWsConnection('S1', 'crm-tab');
  check('全部离线后 S1 无活跃连接', !adapter.hasActiveConnection('S1'));
}

// ============================================================================
// 闭环二：后台自身对话推送
// ============================================================================

async function scenarioAdminSelf(): Promise<void> {
  console.log('\n[闭环二] 后台自身：单端对话推送闭环');

  const adapter = new H5Adapter();
  const ws = new FakeWs();
  await adapter.registerWsConnection('S2', ws as unknown as WebSocket, 'gw-1');

  check(
    '缺省 hostId = mis-admin-web',
    adapter.getSessionEndpoints('S2')[0]?.hostId === DEFAULT_HOST_ID,
  );

  // 新协议流式消息
  await adapter.sendRaw({ type: 'stream', content: '你好' }, 'S2');
  check(
    '新协议 stream 消息送达后台自身',
    ws.received.length === 1 &&
      (ws.received[0] as { type: string }).type === 'stream' &&
      (ws.received[0] as { content: string }).content === '你好',
  );

  // A2UI surface → 送达 + 缓存
  const sfc = surfaceMessage('sfc-admin');
  await adapter.sendRaw(sfc, 'S2');
  check('A2UI surface 送达后台自身', ws.received.length === 2);

  // 旧协议 agent_event
  const agentEvent: AgentEvent = { type: 'text.delta', content: 'x' } as AgentEvent;
  await adapter.send(agentEvent, 'S2');
  const last = ws.received[ws.received.length - 1] as { type: string; event?: { type?: string } };
  check(
    '旧协议 agent_event envelope 送达后台自身',
    last.type === 'agent_event' && last.event?.type === 'text.delta',
    JSON.stringify(last),
  );

  // SSE 通道（后台自身也可用 SSE 接收）
  const reply = new FakeReply();
  await adapter.registerSseConnection('S3', reply as unknown as FastifyReply, 'gw-1', {
    hostId: DEFAULT_HOST_ID,
    clientId: 'admin-sse',
  });
  await adapter.sendRaw(surfaceMessage('sfc-sse'), 'S3');
  const sseEvents = parseSseChunks(reply.chunks);
  check(
    'SSE 通道收到 a2ui_surface',
    sseEvents.length === 1 && (sseEvents[0] as { type: string }).type === 'a2ui_surface',
    JSON.stringify(reply.chunks),
  );

  // 生命周期：hasActiveConnection / 计数 / 注销
  check('S2 有活跃连接', adapter.hasActiveConnection('S2'));
  check('S3 有活跃连接（SSE）', adapter.hasActiveConnection('S3'));
  check('总连接数 = 2', adapter.getConnectionCount() === 2, `count=${adapter.getConnectionCount()}`);

  // 注销时从连接对象取 clientId（与 server.ts close handler 行为一致，BUG-1 修复）
  const boundWsClientId = getBoundClientId(ws);
  const boundSseClientId = getBoundClientId(reply);
  await adapter.unregisterWsConnection('S2', boundWsClientId ?? '');
  await adapter.unregisterSseConnection('S3', boundSseClientId ?? '');
  check('注销后总连接数 = 0', adapter.getConnectionCount() === 0);
  check('注销后 S2 无活跃连接', !adapter.hasActiveConnection('S2'));
}

// ============================================================================
// 闭环三（BUG-1 回归）：无 clientId 多端注销互不影响
// ============================================================================

async function scenarioNoClientIdMultiEndpoint(): Promise<void> {
  console.log('\n[闭环三] BUG-1 回归：无 clientId 多端注销互不影响');

  const adapter = new H5Adapter();
  const redis = new FakeRedis();
  adapter.bindRedis(redis as unknown as Redis);

  // 真实前端（ws-client / sse-client）连接 query 不带 hostId/clientId，
  // 注册时 H5Adapter 为每个端点生成随机 clientId 并绑定到连接对象。
  const wsA = new FakeWs();
  const wsB = new FakeWs();
  await adapter.registerWsConnection('S4', wsA as unknown as WebSocket, 'gw-1');
  await adapter.registerWsConnection('S4', wsB as unknown as WebSocket, 'gw-1');

  check(
    'S4 注册两个无 clientId 端点',
    adapter.getSessionEndpoints('S4').length === 2,
    `endpoints=${adapter.getSessionEndpoints('S4').length}`,
  );

  // 关键：clientId 已绑定到连接对象（server.ts close handler 从连接对象读取）
  const boundA = getBoundClientId(wsA);
  const boundB = getBoundClientId(wsB);
  check(
    'clientId 绑定到连接对象且两端唯一',
    typeof boundA === 'string' && boundA.length > 0 && boundA !== boundB,
    `boundA=${boundA}, boundB=${boundB}`,
  );

  // 防御：空 clientId 注销为 no-op，绝不删除整会话（旧逻辑的误删分支已移除）
  await adapter.unregisterWsConnection('S4', '');
  check(
    '空 clientId 注销为 no-op（不删整会话）',
    adapter.getSessionEndpoints('S4').length === 2,
    `endpoints=${adapter.getSessionEndpoints('S4').length}`,
  );

  // 广播两个端都收到
  await adapter.sendRaw(surfaceMessage('sfc-nc'), 'S4');
  check(
    '广播到达两个端',
    wsA.received.length === 1 && wsB.received.length === 1,
    `wsA=${wsA.received.length}, wsB=${wsB.received.length}`,
  );

  // 注销其一（模拟 server.ts：从连接对象取 clientId）→ 另一不受影响
  await adapter.unregisterWsConnection('S4', boundA ?? '');
  check(
    '注销 A 后剩余 1 个端点（B 存活）',
    adapter.getSessionEndpoints('S4').length === 1 &&
      adapter.getSessionEndpoints('S4')[0]?.clientId === boundB,
    `endpoints=${JSON.stringify(adapter.getSessionEndpoints('S4'))}`,
  );

  // BUG-1 核心验收：注销其一，另一仍能收到广播
  await adapter.sendRaw(surfaceMessage('sfc-nc2'), 'S4');
  check(
    'B 仍收到广播（A 注销不影响 B）',
    wsB.received.length === 2 &&
      (wsB.received[1] as { surfaceId: string }).surfaceId === 'sfc-nc2',
    `wsB=${wsB.received.length}`,
  );
  check('A 不再收到广播', wsA.received.length === 1);

  // 清理 WS 端
  await adapter.unregisterWsConnection('S4', boundB ?? '');
  check('S4 清理后无活跃连接', !adapter.hasActiveConnection('S4'));

  // SSE 侧同样验证（无 clientId 多端注销互不影响）
  const replyA = new FakeReply();
  const replyB = new FakeReply();
  await adapter.registerSseConnection('S5', replyA as unknown as FastifyReply, 'gw-1');
  await adapter.registerSseConnection('S5', replyB as unknown as FastifyReply, 'gw-1');
  check(
    'S5 注册两个无 clientId SSE 端点',
    adapter.getSessionEndpoints('S5').length === 2,
    `endpoints=${adapter.getSessionEndpoints('S5').length}`,
  );
  const sseBoundA = getBoundClientId(replyA);
  await adapter.unregisterSseConnection('S5', sseBoundA ?? '');
  check(
    '注销 SSE A 后剩余 1 个端点（B 存活）',
    adapter.getSessionEndpoints('S5').length === 1,
    `endpoints=${adapter.getSessionEndpoints('S5').length}`,
  );
  const sseRemaining = adapter.getSessionEndpoints('S5')[0];
  if (sseRemaining != null) {
    await adapter.unregisterSseConnection('S5', sseRemaining.clientId, sseRemaining.hostId);
  }
  check('S5 清理后无活跃连接', !adapter.hasActiveConnection('S5'));

  // hostId 维度精确匹配：同 clientId 不同 hostId 互不影响（hostId 维度生效）
  const wsH1 = new FakeWs();
  const wsH2 = new FakeWs();
  await adapter.registerWsConnection('S6', wsH1 as unknown as WebSocket, 'gw-1', {
    hostId: 'crm-web',
    clientId: 'tab-1',
  });
  await adapter.registerWsConnection('S6', wsH2 as unknown as WebSocket, 'gw-1', {
    hostId: 'mis-admin-web',
    clientId: 'tab-1',
  });
  check(
    '同 clientId 不同 hostId 注册为两个端点',
    adapter.getSessionEndpoints('S6').length === 2,
    `endpoints=${adapter.getSessionEndpoints('S6').length}`,
  );
  await adapter.unregisterWsConnection('S6', 'tab-1', 'crm-web');
  check(
    '按 hostId+clientId 精确注销仅移除 CRM 端',
    adapter.getSessionEndpoints('S6').length === 1 &&
      adapter.getSessionEndpoints('S6')[0]?.hostId === 'mis-admin-web',
    `endpoints=${JSON.stringify(adapter.getSessionEndpoints('S6'))}`,
  );
  await adapter.unregisterWsConnection('S6', 'tab-1', 'mis-admin-web');
  check('S6 清理后无活跃连接', !adapter.hasActiveConnection('S6'));
}

// ============================================================================
// 主入口
// ============================================================================

async function main(): Promise<void> {
  await scenarioIframeEmbed();
  await scenarioAdminSelf();
  await scenarioNoClientIdMultiEndpoint();

  console.log(`\nembed-iframe E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
