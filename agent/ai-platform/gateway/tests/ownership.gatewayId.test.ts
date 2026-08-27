/**
 * ownership.gatewayId.test.ts — T1 稳定 GatewayId 注入单测（tsx 直跑）。
 *
 * 覆盖 getGatewayId 解析优先级中可单元触发的两条真实路径：
 *   GATEWAY_ID 环境变量 → 优先返回；
 *   无 GATEWAY_ID → 回退 os.hostname()。
 * （第三条「hostname 不可用 → 随机 gw- 前缀 + 告警」为防御分支，需 hostname
 *   不可用的运行时方能动态触发，此处以代码检视覆盖其格式 gw-${uuid.slice(0,8)}。）
 * 纯逻辑，无需 Redis。
 *
 * 运行：node_modules/.bin/tsx tests/ownership.gatewayId.test.ts
 * 退出码：0=全部通过，1=存在失败。
 */

import { getGatewayId } from '../src/cluster/ownership.js';
import * as os from 'node:os';

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
  const prev = process.env['GATEWAY_ID'];

  // ① 显式 GATEWAY_ID 优先
  process.env['GATEWAY_ID'] = 'gw-from-env';
  check('GATEWAY_ID 环境变量优先', getGatewayId() === 'gw-from-env');

  // ② 无 GATEWAY_ID 时回退 os.hostname()
  delete process.env['GATEWAY_ID'];
  const host = os.hostname();
  const fallback = getGatewayId();
  check('无 GATEWAY_ID 回退 hostname', fallback === host, `got=${fallback}`);

  // 还原
  if (prev !== undefined) {
    process.env['GATEWAY_ID'] = prev;
  } else {
    delete process.env['GATEWAY_ID'];
  }

  console.log(`\ngetGatewayId: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
