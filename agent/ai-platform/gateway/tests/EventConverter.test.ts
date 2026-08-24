/**
 * EventConverter.test.ts — EventConverter 双向转换单测（tsx 直跑）。
 *
 * 验证 8 种 AgentEvent → BaseEvent 映射 + BaseEvent → 前端消息 + toAgentEvent。
 * 纯逻辑，无需 Redis。
 *
 * 运行：node_modules/.bin/tsx tests/EventConverter.test.ts
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
  const runId = 'run-test-1';

  // ---- text.delta → TEXT_MESSAGE_CHUNK ----
  {
    const events = converter.agentEventToBaseEvent({ type: 'text.delta', content: '你好' }, runId);
    check(
      'text.delta → 1 event',
      events.length === 1 && events[0]?.type === EventType.TEXT_MESSAGE_CHUNK,
      JSON.stringify(events),
    );
    const chunk = events[0] as { delta?: string; messageId?: string };
    check('text.delta content → delta', chunk.delta === '你好', chunk.delta);
    check('text.delta messageId 稳定', chunk.messageId === `msg-${runId}`, chunk.messageId);
  }

  // ---- tool.call(render_a2ui) → START + ACTIVITY_SNAPSHOT + ARGS + END ----
  {
    const args = { surfaceId: 's1', components: [{ id: 'root', component: 'data-table' }] };
    const events = converter.agentEventToBaseEvent(
      { type: 'tool.call', toolName: 'render_a2ui', args },
      runId,
    );
    // 修复契约：render_a2ui 的 tool.call 在 START 之后、ARGS 之前插入 ACTIVITY_SNAPSHOT，
    // 供前端命中 ACTIVITY_SNAPSHOT 分支生成 a2ui_surface；TOOL_CALL 三件套仍保留（中间件兼容）。
    check(
      'tool.call(render_a2ui) → START+ACTIVITY_SNAPSHOT+ARGS+END',
      events.length === 4 &&
        events[0]?.type === EventType.TOOL_CALL_START &&
        events[1]?.type === EventType.ACTIVITY_SNAPSHOT &&
        events[2]?.type === EventType.TOOL_CALL_ARGS &&
        events[3]?.type === EventType.TOOL_CALL_END,
      JSON.stringify(events.map((e) => e.type)),
    );
    const start = events[0] as { toolCallId?: string; toolCallName?: string };
    const argsEvent = events[2] as { toolCallId?: string; delta?: string };
    check('tool.call START toolCallName', start.toolCallName === 'render_a2ui');
    check('tool.call START/ARGS 同 toolCallId', start.toolCallId === argsEvent.toolCallId);
    check(
      'tool.call ARGS delta 为完整 args JSON',
      JSON.parse(argsEvent.delta ?? '{}')['surfaceId'] === 's1',
    );

    // ACTIVITY_SNAPSHOT 必须携带 a2ui_operations（否则前端丢弃）
    const snapshot = events[1] as { content?: { a2ui_operations?: unknown[] } };
    const ops = snapshot.content?.a2ui_operations ?? [];
    check(
      'render_a2ui ACTIVITY_SNAPSHOT 带 a2ui_operations',
      Array.isArray(ops) && ops.length === 2,
      JSON.stringify(ops),
    );
    // 经 baseEventToFrontendMessage 必须生成 a2ui_surface（主 bug 修复验证）
    const surfaceMsg = converter.baseEventToFrontendMessage(events[1]!);
    check(
      'render_a2ui ACTIVITY_SNAPSHOT → a2ui_surface',
      surfaceMsg?.type === 'a2ui_surface' &&
        Array.isArray(surfaceMsg['operations']) &&
        surfaceMsg['operations'].length === 2,
      JSON.stringify(surfaceMsg),
    );
  }

  // ---- tool.call(非 render_a2ui) → START + ARGS + END（保持原行为） ----
  {
    const events = converter.agentEventToBaseEvent(
      { type: 'tool.call', toolName: 'get_weather', args: { city: 'BJ' } },
      runId,
    );
    check(
      'tool.call(其他工具) → START+ARGS+END',
      events.length === 3 &&
        events[0]?.type === EventType.TOOL_CALL_START &&
        events[1]?.type === EventType.TOOL_CALL_ARGS &&
        events[2]?.type === EventType.TOOL_CALL_END,
      JSON.stringify(events.map((e) => e.type)),
    );
  }

  // ---- tool.result → TOOL_CALL_RESULT（与 tool.call 关联同一 toolCallId） ----
  {
    // 独立 runId：FIFO 关联按 run 隔离（同一 run 内 tool.call/tool.result 严格有序）
    const resultRunId = 'run-tool-result';
    const callEvents = converter.agentEventToBaseEvent(
      { type: 'tool.call', toolName: 'render_a2ui', args: {} },
      resultRunId,
    );
    const resultEvents = converter.agentEventToBaseEvent(
      { type: 'tool.result', toolName: 'render_a2ui', result: { status: 'rendered' } },
      resultRunId,
    );
    const callStart = callEvents[0] as { toolCallId?: string };
    const result = resultEvents[0] as { type?: EventType; toolCallId?: string; content?: string };
    check(
      'tool.result → TOOL_CALL_RESULT',
      result.type === EventType.TOOL_CALL_RESULT,
      String(result.type),
    );
    check(
      'tool.result 与 tool.call 关联同一 toolCallId',
      result.toolCallId === callStart.toolCallId,
      `${result.toolCallId} vs ${callStart.toolCallId}`,
    );
    check('tool.result content 为结果 JSON', JSON.parse(result.content ?? '{}')['status'] === 'rendered');
  }

  // ---- ui.render → ACTIVITY_SNAPSHOT（兼容） ----
  {
    const events = converter.agentEventToBaseEvent(
      { type: 'ui.render', component: 'data-table', props: { columns: [] } },
      runId,
    );
    const snapshot = events[0] as { type?: EventType; content?: { a2ui_operations?: unknown[] } };
    check(
      'ui.render → ACTIVITY_SNAPSHOT',
      snapshot.type === EventType.ACTIVITY_SNAPSHOT &&
        Array.isArray(snapshot.content?.a2ui_operations) &&
        snapshot.content!.a2ui_operations!.length === 2,
      JSON.stringify(snapshot),
    );
  }

  // ---- approval.request → ACTIVITY_SNAPSHOT（approval-card 组件） ----
  {
    const events = converter.agentEventToBaseEvent(
      {
        type: 'approval.request',
        skillId: 'mis-approval',
        detail: { approvalId: 'WO-1234', title: '测试审批', status: 'pending' },
      },
      runId,
    );
    const snapshot = events[0] as {
      type?: EventType;
      content?: { a2ui_operations?: Array<Record<string, unknown>> };
    };
    const ops = snapshot.content?.a2ui_operations ?? [];
    const updateComponents = ops[1]?.['updateComponents'] as
      | { components?: Array<Record<string, unknown>> }
      | undefined;
    const root = updateComponents?.components?.[0];
    check(
      'approval.request → ACTIVITY_SNAPSHOT with approval-card root',
      snapshot.type === EventType.ACTIVITY_SNAPSHOT &&
        root?.['component'] === 'approval-card' &&
        root?.['approvalId'] === 'WO-1234',
      JSON.stringify(root),
    );
  }

  // ---- dispatch.trace → CUSTOM ----
  {
    const events = converter.agentEventToBaseEvent(
      { type: 'dispatch.trace', trace: { entries: [{ skill: 'mis-rag' }] } },
      runId,
    );
    const custom = events[0] as { type?: EventType; name?: string; value?: unknown };
    check(
      'dispatch.trace → CUSTOM name=dispatch.trace',
      custom.type === EventType.CUSTOM && custom.name === 'dispatch.trace',
      JSON.stringify(custom),
    );
  }

  // ---- error → RUN_ERROR ----
  {
    const events = converter.agentEventToBaseEvent(
      { type: 'error', errorCode: 'E1', errorMessage: 'boom' },
      runId,
    );
    const err = events[0] as { type?: EventType; message?: string; code?: string };
    check(
      'error → RUN_ERROR',
      err.type === EventType.RUN_ERROR && err.message === 'boom' && err.code === 'E1',
      JSON.stringify(err),
    );
  }

  // ---- done → RUN_FINISHED ----
  {
    const events = converter.agentEventToBaseEvent({ type: 'done' }, runId, 'thread-1');
    const done = events[0] as { type?: EventType; threadId?: string; runId?: string };
    check(
      'done → RUN_FINISHED',
      done.type === EventType.RUN_FINISHED && done.runId === runId && done.threadId === 'thread-1',
      JSON.stringify(done),
    );
  }

  // ---- baseEventToFrontendMessage ----
  {
    const chunkEvent = converter.agentEventToBaseEvent({ type: 'text.delta', content: 'hi' }, runId)[0]!;
    const streamMsg = converter.baseEventToFrontendMessage(chunkEvent);
    check(
      'TEXT_MESSAGE_CHUNK → { type: stream }',
      streamMsg?.type === 'stream' && streamMsg['content'] === 'hi',
      JSON.stringify(streamMsg),
    );

    const surfaceEvent = converter.agentEventToBaseEvent(
      { type: 'ui.render', component: 'data-table', props: {} },
      runId,
    )[0]!;
    const surfaceMsg = converter.baseEventToFrontendMessage(surfaceEvent);
    check(
      'ACTIVITY_SNAPSHOT → { type: a2ui_surface, operations[] }',
      surfaceMsg?.type === 'a2ui_surface' &&
        Array.isArray(surfaceMsg['operations']) &&
        surfaceMsg['operations'].length === 2,
      JSON.stringify(surfaceMsg),
    );

    // 主 bug 修复：render_a2ui 的 tool.call 经 agentEventToBaseEvent + baseEventToFrontendMessage
    // 必须产出 a2ui_surface（前端渲染拦截点），operations 含 [createSurface, updateComponents]。
    const renderEvent = converter.agentEventToBaseEvent(
      {
        type: 'tool.call',
        toolName: 'render_a2ui',
        args: {
          surfaceId: 'surf-x',
          components: [{ id: 'c1', component: 'data-table', props: { rows: [] } }],
          data: { total: 42 },
        },
      },
      runId,
    );
    const renderSnapshot = renderEvent.find((e) => e.type === EventType.ACTIVITY_SNAPSHOT)!;
    const renderSurfaceMsg = converter.baseEventToFrontendMessage(renderSnapshot);
    const renderOps = renderSurfaceMsg != null ? renderSurfaceMsg['operations'] : [];
    const firstOp = renderOps[0] as { createSurface?: { surfaceId?: string } } | undefined;
    const secondOp = renderOps[1] as { updateComponents?: { surfaceId?: string; components?: unknown[] } } | undefined;
    const thirdOp = renderOps[2] as { updateDataModel?: { value?: unknown } } | undefined;
    check(
      'render_a2ui → a2ui_surface 含 createSurface+updateComponents+updateDataModel',
      renderSurfaceMsg?.type === 'a2ui_surface' &&
        renderOps.length === 3 &&
        firstOp?.createSurface?.surfaceId === 'surf-x' &&
        secondOp?.updateComponents?.surfaceId === 'surf-x' &&
        Array.isArray(secondOp?.updateComponents?.components) &&
        thirdOp?.updateDataModel?.value != null,
      JSON.stringify(renderOps),
    );

    const doneEvent = converter.agentEventToBaseEvent({ type: 'done' }, runId)[0]!;
    const doneMsg = converter.baseEventToFrontendMessage(doneEvent);
    check('RUN_FINISHED → { type: done }', doneMsg?.type === 'done', JSON.stringify(doneMsg));
  }

  // ---- toAgentEvent（旧协议兼容） ----
  {
    const chunkEvent = converter.agentEventToBaseEvent({ type: 'text.delta', content: 'hi' }, runId)[0]!;
    const agentEvent: AgentEvent = converter.toAgentEvent(chunkEvent);
    check(
      'toAgentEvent TEXT_MESSAGE_CHUNK → text.delta',
      agentEvent.type === 'text.delta' && agentEvent.content === 'hi',
      JSON.stringify(agentEvent),
    );

    const doneEvent = converter.agentEventToBaseEvent({ type: 'done' }, runId)[0]!;
    const doneAgent: AgentEvent = converter.toAgentEvent(doneEvent);
    check('toAgentEvent RUN_FINISHED → done', doneAgent.type === 'done', doneAgent.type);
  }

  console.log(`\nEventConverter: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
