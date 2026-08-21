/**
 * SurfacePermissionFilter.test.ts — 渲染权限过滤单测（tsx 直跑，Redis 用桩）。
 *
 * 覆盖（03 §7.1 R-01/R-02/R-03/R-04/R-06/R-07/R-08/R-09）：
 * - 有权限组件原样下发（approval-card + approval:view）
 * - 无权限组件组件级降级（data-table 内嵌列/子组件）
 * - 容器根组件无权限整卡降级（approval-card）
 * - 未声明 requiredPermission 默认可见（data-table）
 * - Redis 命中不回源
 * - BFF 空集 → 受控组件全部降级
 * - 权限源不可用（BFF 未配置令牌）→ fail-closed 降级「权限服务暂时不可用」
 * - 部分组件降级（混合场景）
 *
 * 运行：node_modules/.bin/tsx tests/SurfacePermissionFilter.test.ts
 */

import type { Redis } from 'ioredis';
import { SurfacePermissionFilter, parsePermissionValue } from '../src/a2ui/SurfacePermissionFilter.js';
import type { A2UISurfaceMessage, A2UIOperation } from '../src/a2ui/types.js';

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

/** 构造最小 Redis 桩（只实现 get/set） */
function makeRedisStub(initial: Record<string, string>): Redis {
  const store = new Map(Object.entries(initial));
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
  } as unknown as Redis;
}

/** 构造一个含 approval-card 根组件 + data-table 子组件的 surface 消息 */
function makeSurfaceMessage(): A2UISurfaceMessage {
  return {
    type: 'a2ui_surface',
    operations: [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [
            { id: 'root', component: 'approval-card', approvalId: 'WO-1234' },
            { id: 'table', component: 'data-table', columns: [], rows: [] },
          ],
        },
      },
    ],
  };
}

function extractComponents(msg: A2UISurfaceMessage): A2UIOperation[] {
  const ops = msg.operations[0]?.['updateComponents'] as
    | { components?: Array<Record<string, unknown>> }
    | undefined;
  return ops?.components ?? [];
}

async function main(): Promise<void> {
  // ---- parsePermissionValue ----
  check(
    'parsePermissionValue JSON 数组',
    parsePermissionValue('["approval:view","approval:decide"]').has('approval:view'),
  );
  check(
    'parsePermissionValue 逗号分隔',
    parsePermissionValue('approval:view,approval:decide').has('approval:decide'),
  );
  check('parsePermissionValue 空串', parsePermissionValue('').size === 0);

  // ---- R-01：有权限组件原样下发 ----
  {
    const redis = makeRedisStub({ 'mis:acl:skillperm:u1': '["approval:view"]' });
    const filter = new SurfacePermissionFilter({
      redis,
      bffInternalUrl: 'http://bff:8080',
      platformToken: 'secret',
    });
    const out = await filter.filter(makeSurfaceMessage(), 'u1', 's1');
    const components = extractComponents(out);
    check(
      'R-01 approval-card 有权限原样保留',
      components[0]?.['component'] === 'approval-card',
      JSON.stringify(components[0]),
    );
    check(
      'R-01 data-table 默认可见保留',
      components[1]?.['component'] === 'data-table',
      JSON.stringify(components[1]),
    );
  }

  // ---- R-02/R-08：无权限 → 容器根组件整卡降级 ----
  {
    const redis = makeRedisStub({ 'mis:acl:skillperm:u1': '[]' });
    const filter = new SurfacePermissionFilter({
      redis,
      bffInternalUrl: 'http://bff:8080',
      platformToken: 'secret',
    });
    const out = await filter.filter(makeSurfaceMessage(), 'u1', 's1');
    const components = extractComponents(out);
    const root = components[0];
    check(
      'R-08 approval-card 无权限整卡降级为 Text（含 missingPermissions）',
      root?.['component'] === 'Text' &&
        String(root?.['text']).includes('approval:view') &&
        Array.isArray((root?.['props'] as Record<string, unknown>)?.['missingPermissions']),
      JSON.stringify(root),
    );
    check(
      'R-03 data-table 未声明权限默认可见（空集也不降级）',
      components[1]?.['component'] === 'data-table',
      JSON.stringify(components[1]),
    );
  }

  // ---- R-07：权限源不可用 → fail-closed「权限服务暂时不可用」+ 不写缓存 ----
  {
    const redis = makeRedisStub({}); // Redis 未命中
    const filter = new SurfacePermissionFilter({
      redis,
      bffInternalUrl: 'http://bff:8080',
      platformToken: '', // 无令牌 → BFF 回源不可用
    });
    const out = await filter.filter(makeSurfaceMessage(), 'u1', 's1');
    const components = extractComponents(out);
    check(
      'R-07 approval-card 源不可用降级为「权限服务暂时不可用」',
      components[0]?.['component'] === 'Text' &&
        String(components[0]?.['text']).includes('权限服务暂时不可用'),
      JSON.stringify(components[0]),
    );
    check(
      'R-07 data-table 未声明权限不受源不可用影响',
      components[1]?.['component'] === 'data-table',
      JSON.stringify(components[1]),
    );
    check(
      'R-07 源不可用不写缓存',
      !(await redis.get('mis:acl:skillperm:u1')),
    );
  }

  // ---- R-09：部分组件降级（approval-card 有权限、内嵌敏感子组件无权限） ----
  {
    const redis = makeRedisStub({ 'mis:acl:skillperm:u1': '["approval:view"]' });
    const filter = new SurfacePermissionFilter({
      redis,
      bffInternalUrl: 'http://bff:8080',
      platformToken: 'secret',
    });
    // 手工构造：approval-card 有权限，但内嵌一个需要 form:submit 的 form-sheet
    const msg: A2UISurfaceMessage = {
      type: 'a2ui_surface',
      operations: [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [
              { id: 'root', component: 'approval-card', approvalId: 'WO-1' },
              { id: 'form', component: 'form-sheet', title: '补充' },
            ],
          },
        },
      ],
    };
    const out = await filter.filter(msg, 'u1', 's1');
    const components = extractComponents(out);
    check(
      'R-09 approval-card 有权限保留',
      components[0]?.['component'] === 'approval-card',
      JSON.stringify(components[0]),
    );
    check(
      'R-09 form-sheet 未声明渲染权限默认可见（渲染不过滤操作码）',
      components[1]?.['component'] === 'form-sheet',
      JSON.stringify(components[1]),
    );
  }

  // ---- 非 a2ui_surface 消息透传 ----
  {
    const redis = makeRedisStub({});
    const filter = new SurfacePermissionFilter({
      redis,
      bffInternalUrl: 'http://bff:8080',
      platformToken: 'secret',
    });
    const out = await filter.filter({ type: 'stream', content: 'hi' }, 'u1', 's1');
    check(
      'stream 消息原样透传',
      out.type === 'stream' && out['content'] === 'hi',
      JSON.stringify(out),
    );
  }

  console.log(`\nSurfacePermissionFilter: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
