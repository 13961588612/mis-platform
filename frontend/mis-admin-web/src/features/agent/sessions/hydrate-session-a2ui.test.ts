/**
 * 运营会话回放 A2UI hydrate：隔离 Copilot + 可清理。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useSurfaceStore } from '@/lib/a2ui/surface-store';
import type { SessionMessage } from '../types';
import {
  buildOpsSurfaceId,
  cleanupOpsSessionA2ui,
  hydrateOpsSessionA2ui,
  isOpsSessionSurface,
} from './hydrate-session-a2ui';

function assistantWithA2ui(id: string, sessionId: string): SessionMessage {
  return {
    id,
    session_id: sessionId,
    role: 'assistant',
    content: '查到以下门店',
    timestamp: '2026-04-20T10:00:00Z',
    metadata: {
      a2ui: {
        surfaces: [
          {
            surfaceId: 'main',
            components: [
              {
                id: 'tbl',
                component: 'data-table',
                props: {
                  columns: [{ key: 'name', title: '店名' }],
                  rows: [{ name: '无锡店' }],
                },
              },
            ],
          },
        ],
      },
    },
  };
}

describe('hydrateOpsSessionA2ui', () => {
  beforeEach(() => {
    useSurfaceStore.getState().clear();
  });

  it('写入 ops 私有 surfaceId，不覆盖 Copilot 的 main', () => {
    useSurfaceStore.getState().upsert({
      surfaceId: 'main',
      components: [{ id: 'copilot', component: 'text', props: { content: 'live' } }],
      dataModels: {},
    });
    useSurfaceStore.getState().setActive('main');

    const sessionId = 'sess-ops-1';
    const msg = assistantWithA2ui('msg-1', sessionId);
    const map = hydrateOpsSessionA2ui([msg], sessionId);

    const expected = buildOpsSurfaceId(sessionId, 'msg-1', 'main');
    expect(map['msg-1']).toBe(expected);
    expect(useSurfaceStore.getState().surfaces.main?.components[0]?.id).toBe('copilot');
    expect(useSurfaceStore.getState().activeSurfaceId).toBe('main');
    expect(useSurfaceStore.getState().surfaces[expected]?.components[0]?.component).toBe(
      'data-table',
    );
  });

  it('cleanup 只删本会话 ops surface', () => {
    const sessionId = 'sess-ops-2';
    const map = hydrateOpsSessionA2ui([assistantWithA2ui('m2', sessionId)], sessionId);
    const opsId = map['m2'];
    expect(opsId).toBeTruthy();
    useSurfaceStore.getState().upsert({
      surfaceId: 'main',
      components: [],
      dataModels: {},
    });

    cleanupOpsSessionA2ui(sessionId);
    expect(useSurfaceStore.getState().surfaces[opsId!]).toBeUndefined();
    expect(useSurfaceStore.getState().surfaces.main).toBeDefined();
    expect(isOpsSessionSurface(opsId!, sessionId)).toBe(true);
  });

  it('无 a2ui 元数据时返回空 map', () => {
    const map = hydrateOpsSessionA2ui(
      [
        {
          id: 'm3',
          session_id: 's',
          role: 'assistant',
          content: '纯文本',
          timestamp: '2026-04-20T10:00:00Z',
        },
      ],
      's',
    );
    expect(map).toEqual({});
  });
});
