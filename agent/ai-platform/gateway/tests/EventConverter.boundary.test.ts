/**
 * EventConverter.boundary.test.ts — 边界用例验证（QA 严过关补充）。
 *
 * 验证 render_a2ui 在「真实 Python 出参异常」场景下的健壮性：
 * 1. components 缺失（undefined）→ 不产生 null，不产生可渲染但有兜底的最小 surface
 * 2. components 为空数组 → 不产生报错，a2ui_surface 仍产出（前端渲染空 surface）
 * 3. surfaceId 缺失 → 降级为 a2ui-{runId}
 * 4. data 缺失 → 不产出 updateDataModel
 * 5. components 非数组（如字符串误传）→ 降级为空数组，不抛错
 *
 * 运行：node_modules/.bin/tsx tests/EventConverter.boundary.test.ts
 */

import { EventType } from '@ag-ui/client';
import { EventConverter } from '../src/a2ui/EventConverter.js';
import type { AgentEvent } from '../src/channels/ChannelCapability.js';

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

function main(): void {
  const converter = new EventConverter();
  const runId = 'run-boundary-1';

  // 边界 1：components 缺失（真实 Python 漏传 components）
  {
    const events = converter.agentEventToBaseEvent(
      { type: 'tool.call', toolName: 'render_a2ui', args: { surfaceId: 's1' } },
      runId,
    );
    const snapshot = events.find((e) => e.type === EventType.ACTIVITY_SNAPSHOT)!;
    const surfaceMsg = converter.baseEventToFrontendMessage(snapshot);
    const ops = surfaceMsg != null ? surfaceMsg['operations'] : [];
    const updateComponents = ops[1] as { updateComponents?: { components?: unknown[] } } | undefined;
    check(
      '边界1: components 缺失 → a2ui_surface 仍产出且 components=[]（不抛错/null）',
      surfaceMsg?.type === 'a2ui_surface' &&
        Array.isArray(updateComponents?.updateComponents?.components) &&
        updateComponents!.updateComponents!.components!.length === 0,
      JSON.stringify(surfaceMsg),
    );
  }

  // 边界 2：components 为空数组
  {
    const events = converter.agentEventToBaseEvent(
      { type: 'tool.call', toolName: 'render_a2ui', args: { surfaceId: 's2', components: [] } },
      runId,
    );
    const snapshot = events.find((e) => e.type === EventType.ACTIVITY_SNAPSHOT)!;
    const surfaceMsg = converter.baseEventToFrontendMessage(snapshot);
    const ops = surfaceMsg != null ? surfaceMsg['operations'] : [];
    check(
      '边界2: components=[] → a2ui_surface 产出（前端渲染空 surface）',
      surfaceMsg?.type === 'a2ui_surface' && ops.length === 2,
      JSON.stringify(surfaceMsg),
    );
  }

  // 边界 3：surfaceId 缺失 → 降级为 a2ui-{runId}
  {
    const events = converter.agentEventToBaseEvent(
      { type: 'tool.call', toolName: 'render_a2ui', args: { components: [{ id: 'c1', component: 'data-table' }] } },
      runId,
    );
    const snapshot = events.find((e) => e.type === EventType.ACTIVITY_SNAPSHOT)! as {
      content?: { a2ui_operations?: Array<Record<string, unknown>> };
    };
    const ops = snapshot.content?.a2ui_operations ?? [];
    const createSurface = ops[0] as { createSurface?: { surfaceId?: string } } | undefined;
    check(
      '边界3: surfaceId 缺失 → 降级 a2ui-{runId}',
      createSurface?.createSurface?.surfaceId === `a2ui-${runId}`,
      String(createSurface?.createSurface?.surfaceId),
    );
  }

  // 边界 4：data 缺失 → 不产出 updateDataModel（operations 仅 2 个）
  {
    const events = converter.agentEventToBaseEvent(
      { type: 'tool.call', toolName: 'render_a2ui', args: { surfaceId: 's4', components: [] } },
      runId,
    );
    const snapshot = events.find((e) => e.type === EventType.ACTIVITY_SNAPSHOT)!;
    const surfaceMsg = converter.baseEventToFrontendMessage(snapshot);
    const ops = surfaceMsg != null ? surfaceMsg['operations'] : [];
    check(
      '边界4: data 缺失 → operations 仅 [createSurface, updateComponents]',
      ops.length === 2 && ops[1] != null && 'updateComponents' in (ops[1] as object),
      JSON.stringify(ops),
    );
  }

  // 边界 5：components 非数组（误传字符串）→ 降级为空数组，不抛错
  {
    let threw = false;
    let surfaceType = '';
    try {
      const events = converter.agentEventToBaseEvent(
        { type: 'tool.call', toolName: 'render_a2ui', args: { surfaceId: 's5', components: 'bad' as unknown as object[] } },
        runId,
      );
      const snapshot = events.find((e) => e.type === EventType.ACTIVITY_SNAPSHOT)!;
      const surfaceMsg = converter.baseEventToFrontendMessage(snapshot);
      surfaceType = surfaceMsg?.type ?? 'null';
    } catch (e) {
      threw = true;
    }
    check(
      '边界5: components 非数组 → 不抛错，产出 a2ui_surface',
      !threw && surfaceType === 'a2ui_surface',
      `threw=${threw}, surfaceType=${surfaceType}`,
    );
  }

  console.log(`\nEventConverter Boundary: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
