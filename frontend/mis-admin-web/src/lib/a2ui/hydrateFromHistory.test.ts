/**
 * hydrateA2uiFromMetadata — 历史 metadata.a2ui → SurfaceStore 回填。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { hydrateA2uiFromMetadata } from './hydrateFromHistory';
import { useSurfaceStore } from './surface-store';

describe('hydrateA2uiFromMetadata', () => {
  beforeEach(() => {
    useSurfaceStore.getState().clear();
  });

  it('从 surfaces 快照重建并挂消息私有 surfaceId', () => {
    const scoped = hydrateA2uiFromMetadata(
      {
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
      'msg-1',
    );
    expect(scoped).toBe('main__msg__msg-1');
    const surface = useSurfaceStore.getState().surfaces['main__msg__msg-1'];
    expect(surface).toBeDefined();
    expect(surface?.components[0]?.component).toBe('data-table');
  });

  it('无 a2ui / 非法载荷返回 undefined', () => {
    expect(hydrateA2uiFromMetadata(null, 'm')).toBeUndefined();
    expect(hydrateA2uiFromMetadata({}, 'm')).toBeUndefined();
    expect(hydrateA2uiFromMetadata({ surfaces: [] }, 'm')).toBeUndefined();
  });
});
