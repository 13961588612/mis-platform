/**
 * chat-core 事件适配器单测（T06' 迁入 + F3 dispatch.trace 对齐）。
 *
 * <p>覆盖：
 * - 最终协议直出事件（stream / a2ui_surface / dispatch.trace / done / error）；
 * - 旧协议 `agent_event` envelope（text.delta / tool.call / tool.result / ui.render）；
 * - **F3**：dispatch.trace 两风格归一 ——
 *   `{ type: 'dispatch.trace', trace }` 与 `{ type: 'custom', eventType: 'dispatch.trace', data }`
 *   都必须产出内部 `{ type: 'dispatch.trace', trace }`；
 * - 防御：无法识别 / custom 非 dispatch.trace / trace 形状非法 → null 或空 entries，绝不抛。
 */
import { describe, expect, it } from 'vitest';
import { parseStreamLine } from './event-adapter';
import type { RawStreamLine } from './types';

describe('parseStreamLine 最终协议直出', () => {
  it('stream 文本增量', () => {
    expect(parseStreamLine({ type: 'stream', content: '你好' })).toEqual({
      type: 'stream',
      content: '你好',
    });
  });

  it('a2ui_surface 渲染指令（operations 透传 + surfaceId）', () => {
    const event = parseStreamLine({
      type: 'a2ui_surface',
      surfaceId: 'sfc-1',
      operations: [
        {
          type: 'createSurface',
          surfaceId: 'sfc-1',
          components: [{ id: 'root', component: 'data-table' }],
        },
      ],
    });
    expect(event).toMatchObject({ type: 'a2ui_surface', surfaceId: 'sfc-1' });
    expect(event && 'operations' in event ? (event.operations as unknown[]).length : 0).toBe(1);
  });

  it('done 携带 tokenUsage（snake_case 与 camelCase 兼容）', () => {
    expect(parseStreamLine({ type: 'done', token_usage: { prompt: 1, completion: 2, total: 3 } })).toEqual({
      type: 'done',
      tokenUsage: { prompt: 1, completion: 2, total: 3 },
    });
    expect(parseStreamLine({ type: 'done', tokenUsage: { prompt: 1, completion: 2, total: 3 } })).toEqual({
      type: 'done',
      tokenUsage: { prompt: 1, completion: 2, total: 3 },
    });
  });

  it('error 归一（error_code / message）', () => {
    expect(parseStreamLine({ type: 'error', error_code: 'A2UI_RUN_ERROR', message: 'boom' })).toEqual({
      type: 'error',
      errorCode: 'A2UI_RUN_ERROR',
      message: 'boom',
    });
  });
});

describe('parseStreamLine dispatch.trace 两风格归一（F3）', () => {
  const entries = [
    { intent: '查余额', worker_id: 'w-1', tool: 'member-query', status: 'ok', latency_ms: 12 },
    { intent: '查余额', worker_id: 'w-2', tool: 'member-query', status: 'ok', latency_ms: 8 },
  ];

  it('旧风格 { type: dispatch.trace, trace } 原样归一', () => {
    const event = parseStreamLine({ type: 'dispatch.trace', trace: { entries } });
    expect(event).toEqual({ type: 'dispatch.trace', trace: { entries } });
  });

  it('F3 新风格 { type: custom, eventType: dispatch.trace, data } → 内部 trace 事件', () => {
    const raw: RawStreamLine = {
      type: 'custom',
      eventType: 'dispatch.trace',
      data: { entries },
    };
    const event = parseStreamLine(raw);
    expect(event).toEqual({ type: 'dispatch.trace', trace: { entries } });
  });

  it('custom 事件 eventType 非 dispatch.trace → null（不中断流）', () => {
    expect(
      parseStreamLine({ type: 'custom', eventType: 'some.other', data: { entries } }),
    ).toBeNull();
  });

  it('data 缺 entries / 非数组 → 空 entries（防御，不抛）', () => {
    expect(parseStreamLine({ type: 'custom', eventType: 'dispatch.trace', data: {} })).toEqual({
      type: 'dispatch.trace',
      trace: { entries: [] },
    });
    expect(
      parseStreamLine({ type: 'custom', eventType: 'dispatch.trace', data: 'not-an-object' }),
    ).toEqual({ type: 'dispatch.trace', trace: { entries: [] } });
    expect(parseStreamLine({ type: 'dispatch.trace', trace: { entries: 'bad' } })).toEqual({
      type: 'dispatch.trace',
      trace: { entries: [] },
    });
  });
});

describe('parseStreamLine 旧协议 agent_event envelope', () => {
  it('envelope 内嵌 text.delta / tool.call / tool.result / ui.render', () => {
    expect(
      parseStreamLine({
        type: 'agent_event',
        event: { type: 'text.delta', content: '流式' },
      }),
    ).toEqual({ type: 'text.delta', content: '流式' });

    expect(
      parseStreamLine({
        type: 'agent_event',
        event: { type: 'tool.call', toolName: 'skill', args: { name: 'member.profile' } },
      }),
    ).toMatchObject({ type: 'tool.call', toolName: 'skill' });

    expect(
      parseStreamLine({
        type: 'agent_event',
        event: { type: 'tool.result', toolName: 'skill', result: { ok: true } },
      }),
    ).toMatchObject({ type: 'tool.result', toolName: 'skill', result: { ok: true } });

    expect(
      parseStreamLine({
        type: 'agent_event',
        event: { type: 'ui.render', component: 'data-table', props: { rows: [] } },
      }),
    ).toMatchObject({ type: 'ui.render', component: 'data-table', props: { rows: [] } });
  });

  it('envelope 内嵌 dispatch.trace 同样归一', () => {
    const event = parseStreamLine({
      type: 'agent_event',
      event: { type: 'dispatch.trace', trace: { entries: [{ worker_id: 'w-1' }] } },
    });
    expect(event).toEqual({
      type: 'dispatch.trace',
      trace: { entries: [{ worker_id: 'w-1' }] },
    });
  });
});

describe('parseStreamLine 防御', () => {
  it('未知 type → null（调用方忽略，绝不中断流）', () => {
    expect(parseStreamLine({ type: 'unknown.event' })).toBeNull();
    expect(parseStreamLine({ type: 'a2ui_surface' })).toEqual({
      type: 'a2ui_surface',
      operations: [],
      surfaceId: undefined,
    });
  });

  it('无 type / 非对象 → null', () => {
    expect(parseStreamLine({})).toBeNull();
    // 运行时通道（WS/SSE 反序列化）可能送来 null event，防御路径必须容忍；
    // 类型契约不允许 null，故显式断言运行时形态（as unknown）。
    expect(parseStreamLine({ event: null } as unknown as RawStreamLine)).toBeNull();
  });
});
