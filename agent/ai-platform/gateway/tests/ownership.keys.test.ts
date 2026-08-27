/**
 * ownership.keys.test.ts — T1/T3 Redis 键生成函数单测（tsx 直跑）。
 *
 * 验证 TS 侧键函数产出与跨语言规范字面量逐字节一致：
 *   botOwnerKey        → aip:bot:{botId}:owner
 *   sessionBotKey      → aip:session:{sessionId}:bot
 *   getOutboundStreamKey       → aip:stream:gw:{gatewayId}:events
 *   getPendingOutboundStreamKey → aip:stream:gw:pending:events
 * 纯逻辑，无需 Redis。
 *
 * 运行：node_modules/.bin/tsx tests/ownership.keys.test.ts
 */

import { botOwnerKey, sessionBotKey } from '../src/cluster/ownership.js';
import { StreamProducer } from '../src/queue/redisStream.js';

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

async function main(): Promise<void> {
  check('botOwnerKey', botOwnerKey('B1') === 'aip:bot:B1:owner', botOwnerKey('B1'));
  check(
    'sessionBotKey',
    sessionBotKey('S1') === 'aip:session:S1:bot',
    sessionBotKey('S1'),
  );
  check(
    'getOutboundStreamKey',
    StreamProducer.getOutboundStreamKey('gwX') === 'aip:stream:gw:gwX:events',
    StreamProducer.getOutboundStreamKey('gwX'),
  );
  check(
    'getPendingOutboundStreamKey',
    StreamProducer.getPendingOutboundStreamKey() === 'aip:stream:gw:pending:events',
    StreamProducer.getPendingOutboundStreamKey(),
  );

  console.log(`\nownership keys: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
