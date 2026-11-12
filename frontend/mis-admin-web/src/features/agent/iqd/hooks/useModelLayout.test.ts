/**
 * useModelLayout.test.ts — 画布布局持久化的**纯函数**单测（T03b 回归守卫）。
 *
 * <p>本文件只测纯函数（不挂 React / 不挂 Query），沿用项目既有 vitest node 环境。
 *
 * <p>重点钉住三条**静默失效**的规则：
 * <ol>
 *   <li>{@link normalizeLayout}：布局是服务端 JSONB，**服务端不校验结构**；脏数据一旦
 *       流进 `<ReactFlow>` 会直接白屏（不是报错，是整块画布没了）。</li>
 *   <li>{@link mergeDerivedNodes} 的**坐标优先级**：本地既有坐标必须优先于服务端坐标。
 *       否则「拖完 → 防抖 600ms → PUT 完成」窗口内的一次 catalog 轮询会把节点**弹回原位**
 *       —— 这正是 T02b-1 当初把画布做成恒只读的原因，也是本批最容易引入的回归。</li>
 *   <li>{@link toLayoutNodes} 用 **item_key** 而不是 ReactFlow 节点 id 作锚点：
 *       节点 id 是前端派生标识（`model:mdl:model:orders`），派生规则一改，历史布局全失配。</li>
 * </ol>
 */
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { CatalogNodeData } from './useCatalogNodes';
import {
  EMPTY_LAYOUT,
  layoutPositions,
  mergeDerivedNodes,
  normalizeLayout,
  toLayoutEdges,
  toLayoutNodes,
} from './useModelLayout';

function node(
  id: string,
  itemKey: string,
  x: number,
  y: number,
  extra: Partial<Node<CatalogNodeData>> = {},
): Node<CatalogNodeData> {
  return {
    id,
    type: 'iqdModel',
    position: { x, y },
    data: {
      itemKey,
      kind: 'model',
      displayName: itemKey,
      columns: [],
      measureNames: [],
      inScope: false,
      source: 'mdl',
    },
    ...extra,
  };
}

describe('normalizeLayout（防御式解析服务端布局）', () => {
  it('null / undefined / 非对象 → 空布局约定值', () => {
    expect(normalizeLayout(null)).toMatchObject({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      auto_layout_version: 0,
      version: 0,
    });
    expect(normalizeLayout(undefined).nodes).toEqual([]);
  });

  it('丢字段 / 类型不符的节点被剔除或回退（不把脏数据送进 ReactFlow）', () => {
    const layout = normalizeLayout({
      nodes: [
        null,
        { x: 1, y: 2 }, // 无 item_key → 丢弃
        { item_key: 'mdl:model:orders', x: '15', y: 'not-a-number' },
      ],
      edges: [null, { id: 'e1' }, { id: 'e2', source: 'a', target: 'b' }],
    });

    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0]).toEqual({ item_key: 'mdl:model:orders', x: 15, y: 0 });
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toEqual({
      id: 'e2',
      source: 'a',
      target: 'b',
      source_handle: null,
      target_handle: null,
    });
  });

  it('viewport.zoom=0 / 缺失 → 回退 1（zoom=0 会让画布空白）', () => {
    expect(normalizeLayout({ viewport: { x: 5, y: 6, zoom: 0 } }).viewport).toEqual({
      x: 5,
      y: 6,
      zoom: 1,
    });
    expect(normalizeLayout({ nodes: [], edges: [] }).viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('version / auto_layout_version 缺失 → 0（PUT 的 base_version 从 0 起）', () => {
    const layout = normalizeLayout({ nodes: [], edges: [], version: '3' });
    expect(layout.version).toBe(3);
    expect(layout.auto_layout_version).toBe(0);
  });

  it('EMPTY_LAYOUT 与后端空态语义一致（HTTP 200 + 空布局，不是 404）', () => {
    expect(EMPTY_LAYOUT.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(EMPTY_LAYOUT.nodes).toEqual([]);
    expect(EMPTY_LAYOUT.version).toBe(0);
  });
});

describe('layoutPositions（item_key → 坐标）', () => {
  it('按 item_key 建索引（不是节点 id）', () => {
    const positions = layoutPositions(
      normalizeLayout({
        nodes: [
          { item_key: 'mdl:model:orders', x: 10, y: 20 },
          { item_key: 'pg_main.public.customers', x: 30, y: 40 },
        ],
      }),
    );
    expect(positions.get('mdl:model:orders')).toEqual({ x: 10, y: 20 });
    expect(positions.get('pg_main.public.customers')).toEqual({ x: 30, y: 40 });
    expect(positions.size).toBe(2);
  });
});

describe('mergeDerivedNodes（本地交互态 × 服务端坐标 × 派生网格）', () => {
  const derived = [node('model:mdl:model:orders', 'mdl:model:orders', 40, 40)];
  const key = 'mdl:model:orders';

  it('★ 默认：**本地既有坐标优先**（否则 catalog 轮询会把刚拖的节点弹回原位）', () => {
    const previous = [node('model:mdl:model:orders', key, 300, 220)];
    const merged = mergeDerivedNodes(
      derived,
      previous,
      new Map([[key, { x: 5, y: 6 }]]),
    );
    expect(merged[0].position).toEqual({ x: 300, y: 220 });
  });

  it('无本地节点时用服务端坐标', () => {
    const merged = mergeDerivedNodes(derived, [], new Map([[key, { x: 5, y: 6 }]]));
    expect(merged[0].position).toEqual({ x: 5, y: 6 });
  });

  it('preferPersisted：重载 / version bump 时以服务端为准', () => {
    const previous = [node('model:mdl:model:orders', key, 300, 220)];
    const merged = mergeDerivedNodes(derived, previous, new Map([[key, { x: 5, y: 6 }]]), {
      preferPersisted: true,
    });
    expect(merged[0].position).toEqual({ x: 5, y: 6 });
  });

  it('拖拽中即使 preferPersisted 也强制本地（避免闪回）', () => {
    const previous = [
      node('model:mdl:model:orders', key, 300, 220, { dragging: true }),
    ];
    const merged = mergeDerivedNodes(derived, previous, new Map([[key, { x: 5, y: 6 }]]), {
      preferPersisted: true,
    });
    expect(merged[0].position).toEqual({ x: 300, y: 220 });
    expect(merged[0].dragging).toBe(true);
  });

  it('新节点用派生网格坐标落位', () => {
    const merged = mergeDerivedNodes(derived, [], new Map());
    expect(merged[0].position).toEqual({ x: 40, y: 40 });
  });

  it('继承本地选中/拖拽/量出的尺寸（避免一次轮询把交互态清掉）', () => {
    const previous = [
      node('model:mdl:model:orders', key, 100, 100, {
        selected: true,
        dragging: true,
        measured: { width: 260, height: 120 },
      }),
    ];
    const merged = mergeDerivedNodes(derived, previous, new Map());
    expect(merged[0].selected).toBe(true);
    expect(merged[0].dragging).toBe(true);
    expect(merged[0].measured).toEqual({ width: 260, height: 120 });
  });

  it('catalog 里已消失的节点被丢弃（不留孤儿）', () => {
    const previous = [
      node('model:mdl:model:orders', key, 100, 100),
      node('model:mdl:model:ghost', 'mdl:model:ghost', 500, 500),
    ];
    const merged = mergeDerivedNodes(derived, previous, new Map());
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('model:mdl:model:orders');
  });
});

describe('toLayoutNodes / toLayoutEdges（写回载荷）', () => {
  it('坐标取整 + 用 item_key 作锚点 + 带出量出的尺寸', () => {
    const payload = toLayoutNodes([
      node('model:mdl:model:orders', 'mdl:model:orders', 10.6, 20.2, {
        measured: { width: 259.4, height: 118.5 },
      }),
    ]);
    expect(payload).toEqual([
      { item_key: 'mdl:model:orders', x: 11, y: 20, width: 259, height: 119, collapsed: false },
    ]);
  });

  it('未量出尺寸时不写 width/height（避免 0 宽节点被恢复）', () => {
    const payload = toLayoutNodes([
      node('model:mdl:model:orders', 'mdl:model:orders', 0, 0),
    ]);
    expect(payload[0]).toEqual({ item_key: 'mdl:model:orders', x: 0, y: 0, collapsed: false });
    expect('width' in payload[0]).toBe(false);
  });

  it('边载荷：锚点缺省为 null', () => {
    const edges: Array<Edge<Record<string, unknown>>> = [
      { id: 'e1', source: 'model:a', target: 'model:b' },
    ];
    expect(toLayoutEdges(edges)).toEqual([
      { id: 'e1', source: 'model:a', target: 'model:b', source_handle: null, target_handle: null },
    ]);
  });
});
