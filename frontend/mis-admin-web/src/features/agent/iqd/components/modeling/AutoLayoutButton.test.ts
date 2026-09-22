/**
 * AutoLayoutButton.test.ts — 自动布局纯函数单测（T03d）。
 *
 * <p>三处**静默出错**的点被钉在这里：
 * <ol>
 *   <li><b>中心 → 左上角的换算</b>：dagre 返回节点**中心**，ReactFlow 要**左上角**。
 *       忘了减去半宽半高，整张图只是「右下偏了半张卡片」—— 看起来只是"有点歪"，
 *       不会报错，也很难在 review 里看出来。</li>
 *   <li><b>方向</b>：`rankdir=LR` 必须让下游节点在**右侧**（x 递增）。方向反了整张图
 *       读起来就"逆流"，但依然"长得像张图"。</li>
 *   <li><b>悬空/自环边</b>：源或目标不在节点集里的边若照样 `setEdge`，dagre 会隐式
 *       造出**无尺寸**节点，把整张图拉歪；自环同理。</li>
 * </ol>
 */
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { MODEL_NODE_WIDTH, type CatalogNodeData } from '../../hooks/useCatalogNodes';
import { applyPositions, computeDagreLayout, estimateNodeSize } from './AutoLayoutButton';

/** 造一个画布节点（`columnCount` 决定估算高度）。 */
function node(id: string, columnCount = 3): Node<CatalogNodeData> {
  return {
    id,
    type: 'iqdModel',
    position: { x: 0, y: 0 },
    data: {
      itemKey: `mdl:model:${id}`,
      kind: 'model',
      displayName: id,
      columns: Array.from({ length: columnCount }, (_, index) => ({
        item_key: `mdl:model:${id}.col_${index}`,
        kind: 'column',
        display_name: `col_${index}`,
      })) as CatalogNodeData['columns'],
      measureNames: [],
      inScope: false,
      source: 'mdl',
    },
  };
}

/** 造一条边。 */
function edge(source: string, target: string): Edge<Record<string, unknown>> {
  return { id: `${source}->${target}`, source, target };
}

describe('estimateNodeSize（dagre 只吃相对尺寸，故用估算）', () => {
  it('宽度固定 = 画布卡片宽；高度随行数增长', () => {
    const one = estimateNodeSize(1);
    const three = estimateNodeSize(3);
    expect(one.width).toBe(MODEL_NODE_WIDTH);
    expect(three.width).toBe(MODEL_NODE_WIDTH);
    expect(three.height).toBeGreaterThan(one.height);
  });

  it('字段数为 0 也按 1 行算（不留 0 高节点）', () => {
    expect(estimateNodeSize(0).height).toBe(estimateNodeSize(1).height);
  });

  it('超过可见行上限（8）后高度封顶 + 多一行「显示全部」按钮', () => {
    const capped = estimateNodeSize(8);
    const withFooter = estimateNodeSize(20);
    expect(withFooter.height).toBe(capped.height + 22);
  });
});

describe('computeDagreLayout（坐标计算）', () => {
  it('空节点集 → 空 Map（不抛）', () => {
    expect(computeDagreLayout([], []).size).toBe(0);
  });

  it('★ rankdir=LR：下游节点在右侧（x 严格递增）', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const positions = computeDagreLayout(nodes, [edge('a', 'b'), edge('b', 'c')], 'LR');

    const a = positions.get('a');
    const b = positions.get('b');
    const c = positions.get('c');
    expect(a && b && c).toBeTruthy();
    expect(b!.x).toBeGreaterThan(a!.x);
    expect(c!.x).toBeGreaterThan(b!.x);
  });

  it('★ rankdir=TB：下游节点在下方（y 严格递增）', () => {
    const nodes = [node('a'), node('b')];
    const positions = computeDagreLayout(nodes, [edge('a', 'b')], 'TB');
    expect(positions.get('b')!.y).toBeGreaterThan(positions.get('a')!.y);
  });

  it('★ 中心→左上角：坐标等于 dagre 中心减去半宽半高（估算尺寸）', () => {
    const nodes = [node('a', 3)];
    const size = estimateNodeSize(3);
    const positions = computeDagreLayout(nodes, [], 'LR');
    const pos = positions.get('a');
    expect(pos).toBeTruthy();
    // 单节点：中心 x = marginx + width/2 → 左上角应回到 marginx 附近。
    // 若**漏减半宽半高**，x 会落在 154 左右（≈ marginx + 130），远超下面的上界 → 用例会失败。
    expect(pos!.x).toBeGreaterThanOrEqual(0);
    expect(pos!.x).toBeLessThanOrEqual(2 * 24);
    expect(pos!.y).toBeGreaterThanOrEqual(0);
    expect(pos!.y).toBeLessThan(size.height);
  });

  it('不相连的两个节点不重叠（LR 下同 rank 通常纵向排开）', () => {
    const nodes = [node('a'), node('b')];
    const positions = computeDagreLayout(nodes, [], 'LR');
    const [first, second] = [...positions.values()];
    const size = estimateNodeSize(3);
    // 不重叠 = 横向拉开一个卡宽 **或** 纵向拉开一个卡高（LR 下 nodesep 走纵向）
    const separated =
      Math.abs(first.x - second.x) >= MODEL_NODE_WIDTH ||
      Math.abs(first.y - second.y) >= size.height;
    expect(separated).toBe(true);
  });

  it('★ 悬空边（端点不在节点集里）被忽略：不抛、真实节点仍有坐标', () => {
    const nodes = [node('a'), node('b')];
    const positions = computeDagreLayout(nodes, [edge('a', 'ghost'), edge('ghost', 'b')], 'LR');
    expect(positions.size).toBe(2);
    expect(positions.get('a')).toBeTruthy();
    expect(positions.get('b')).toBeTruthy();
  });

  it('★ 自环边被忽略（不让 dagre 造出重复节点）', () => {
    const nodes = [node('a')];
    const positions = computeDagreLayout(nodes, [edge('a', 'a')], 'LR');
    expect(positions.size).toBe(1);
  });
});

describe('applyPositions（套用坐标，不改原数组）', () => {
  it('命中则替换 position，未命中保持原样', () => {
    const nodes = [node('a'), node('b')];
    const before = JSON.stringify(nodes);
    const next = applyPositions(nodes, new Map([['a', { x: 100, y: 200 }]]));

    expect(next[0].position).toEqual({ x: 100, y: 200 });
    expect(next[1].position).toEqual({ x: 0, y: 0 });
    expect(JSON.stringify(nodes)).toBe(before); // 原数组未被就地修改
  });
});
