/**
 * C4 网关 dispatch.trace 透传冒烟测试（无 jest/vitest 运行器，用 tsx 直跑纯函数）。
 *
 * 覆盖（design-c4.md T02 / spec.md §7.2）：
 *  ① parseBackendAgentEvent 透传 trace.entries（不丢弃、不改名、不浅化）
 *  ② 嵌套结构完整：intent / worker_id / tool / status / latency_ms 逐字段存活
 *  ③ 无 trace 的既有事件不得凭空多出 trace 字段（现网零回归）
 *  ④ toH5Event('dispatch.trace') → type='stream'，且 eventData.trace 原样带出
 *  ⑤ transform(event,'h5') 端到端不被降级（degraded=false）
 *  ⑥ 多条 entries 顺序保持
 *  ⑦ 【反例探针】transform(event,'wecom-bot') 的实际行为（记录，不断言通过）
 *
 * 运行：node_modules/.bin/tsx tests/cw4.dispatchTrace.smoke.ts
 * 退出码：0=全部通过，1=存在失败。
 */

import { parseBackendAgentEvent } from '../src/router/agentEventParser.js';
import { EventTransformer } from '../src/router/EventTransformer.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ===== 夹具：后端 dispatch.trace 事件的真实线上形状 =====

const BACKEND_DISPATCH_TRACE = JSON.stringify({
  type: 'dispatch.trace',
  trace: {
    entries: [
      {
        intent: 'rag',
        worker_id: 'mis-rag',
        tool: 'agent__invoke',
        status: 'completed',
        latency_ms: 1200,
        task_id: 'task-1',
        brief_rejected: false,
      },
    ],
  },
});

console.log('\n[1] parseBackendAgentEvent — trace 透传');

const parsed = parseBackendAgentEvent(BACKEND_DISPATCH_TRACE);

check('事件类型为 dispatch.trace', parsed.type === 'dispatch.trace', `实际=${parsed.type}`);
check('trace 字段存在（未被丢弃）', parsed.trace !== undefined);

const entries = (parsed.trace as { entries?: unknown[] } | undefined)?.entries;
check('trace.entries 为数组且非空', Array.isArray(entries) && entries.length === 1);

const entry = (entries?.[0] ?? {}) as Record<string, unknown>;
check('entry.intent 存活', entry.intent === 'rag', `实际=${String(entry.intent)}`);
check('entry.worker_id 存活（未被 camelCase 改名）', entry.worker_id === 'mis-rag');
check('entry.tool 存活', entry.tool === 'agent__invoke');
check('entry.status 存活', entry.status === 'completed');
check('entry.latency_ms 存活（未被改名）', entry.latency_ms === 1200);
check('entry.task_id 存活', entry.task_id === 'task-1');
check('entry.brief_rejected 存活', entry.brief_rejected === false);

console.log('\n[2] 多条 entries 顺序保持');

const multi = parseBackendAgentEvent(
  JSON.stringify({
    type: 'dispatch.trace',
    trace: {
      entries: [
        { intent: 'rag', worker_id: 'mis-rag' },
        { intent: 'crm', worker_id: 'crm-assistant' },
      ],
    },
  }),
);
const multiEntries = (multi.trace as { entries: Array<{ worker_id: string }> }).entries;
check(
  '两条 entries 顺序 = [mis-rag, crm-assistant]',
  multiEntries.map((e) => e.worker_id).join(',') === 'mis-rag,crm-assistant',
  `实际=${multiEntries.map((e) => e.worker_id).join(',')}`,
);

console.log('\n[3] 既有事件零回归 — 不得凭空多出 trace');

const textDelta = parseBackendAgentEvent(
  JSON.stringify({ type: 'text.delta', content: 'hi' }),
);
check('text.delta 无 trace 字段', textDelta.trace === undefined);
check('text.delta 内容不受影响', textDelta.content === 'hi');

const doneEvent = parseBackendAgentEvent(
  JSON.stringify({ type: 'done', token_usage: { prompt: 1, completion: 2, total: 3 } }),
);
check('done 无 trace 字段', doneEvent.trace === undefined);
check('done 的 tokenUsage 仍正确', doneEvent.tokenUsage?.total === 3);

console.log('\n[4] EventTransformer.toH5Event — 原样透传');

const transformer = new EventTransformer();
const h5 = transformer.toH5Event(parsed);

check("toH5Event 的 type 为 'stream'", h5.type === 'stream', `实际=${h5.type}`);
check("eventType 保持 'dispatch.trace'", h5.eventType === 'dispatch.trace');
check('degraded=false（未被降级）', h5.degraded === false);

const h5Trace = (h5.eventData as { trace?: { entries?: unknown[] } } | undefined)?.trace;
check('eventData.trace.entries 到达 H5', Array.isArray(h5Trace?.entries) && h5Trace!.entries!.length === 1);
check(
  'eventData.trace 内容与后端一致',
  (h5Trace?.entries?.[0] as Record<string, unknown>)?.worker_id === 'mis-rag',
);

console.log('\n[5] transform(event, "h5") 端到端不降级');

const routed = transformer.transform(parsed, 'h5');
check("transform → type='stream'", routed.type === 'stream', `实际=${routed.type}`);
check('transform → degraded=false', routed.degraded === false);
check(
  'transform → trace 仍在',
  ((routed.eventData as { trace?: { entries?: unknown[] } })?.trace?.entries?.length ?? 0) === 1,
);

console.log('\n[6] 【探针】transform(event, "wecom-bot") 的实际行为');

const botMsg = transformer.transform(parsed, 'wecom-bot');
console.log(
  `  INFO  wecom-bot 结果: type=${botMsg.type}, degraded=${botMsg.degraded}, ` +
    `content=${JSON.stringify((botMsg as { card?: unknown }).card ?? botMsg.content ?? null).slice(0, 160)}`,
);

console.log(`\n通过 ${passed} 项，失败 ${failed} 项。`);
process.exit(failed > 0 ? 1 : 0);
