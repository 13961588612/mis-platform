/**
 * AutoLayoutButton.tsx — 一键整理画布（dagre；v1.11 A-02 / T03d）。
 *
 * <h2>为什么 dagre 跑在**浏览器侧**（A-02 裁决的落地）</h2>
 * T03a 已按 A-02 把服务端 `POST /modeling/layout/{connId}/auto-layout` 定为
 * **恒返回 HTTP 501**（mis-iqd 无任何图布局库；`@dagrejs/dagre` 本就是前端依赖）：
 * <ul>
 *   <li>布局是**纯视图数据**（Q6：x/y 不入 catalog），算在浏览器可即时反馈（200 节点 ≤2s）；</li>
 *   <li>落库**完全复用** `PUT /modeling/layout/{connId}`（`useModelLayout.persist`），不新增写路径；</li>
 *   <li>⚠️ **不要**改去调 auto-layout 端点：它恒 501，axios 会直接 reject（T03a 报告备注 2）。</li>
 * </ul>
 *
 * <h2>与画布的关系（本组件不碰画布）</h2>
 * 本组件**不**接收画布的节点 state；它自己用 {@link useCatalogNodes} 派生同一份
 * nodes/edges（同一 Query 缓存 = 同一真值），算出坐标后经 {@link useModelLayout.persist}
 * 写回。画布下一次合并时（`mergeDerivedNodes`：**已持久化坐标优先**）即套用新坐标 ——
 * 所以「整理」不需要画布配合，也不会破坏「本地既有 > 服务端」的防弹回规则。
 *
 * <h2>两处必须说清的实现细节</h2>
 * <ol>
 *   <li><b>尺寸用估算值</b>：dagre 需要每个节点的 width/height 才能算间距，而**真实高度**
 *       由画布的 `ModelNodeCard` 渲染后才知道（`measured` 在画布 state 里）。这里用
 *       「卡片宽 260 + 行高估算」—— 布局只需要**相对**尺寸，估错只影响疏密，不影响正确性。
 *       节点画布上量到的真实尺寸会在用户下一次拖拽落库时被写回。</li>
 *   <li><b>冲突（40900）自持</b>：本组件用的是**自己那份** `useModelLayout` 实例，其
 *       `conflict/saving` 与画布那份互相独立（瞬时态在实例内，跨组件读不到）。所以这里
 *       自带一个极简冲突提示 + 「重载」，而不是依赖画布的橙色条
 *       （画布那份仍只反映拖拽写回；两者都源于同一服务端版本，不会互相说谎）。
 *       `TODO(后续批次)`：把布局瞬时态收进 store（或把 hook 提到页面）后即可统一到顶栏。</li>
 * </ol>
 */
import { useCallback, useState } from 'react';
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import { Loader2, RotateCcw, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MODEL_NODE_WIDTH, useCatalogNodes, type CatalogNodeData } from '../../hooks/useCatalogNodes';
import { useModelLayout } from '../../hooks/useModelLayout';

/** dagre 布局方向（A-02：ER 语义的阅读方向是左→右）。 */
export type LayoutDirection = 'LR' | 'TB';

/** dagre 布局参数（收敛在此，便于单测与后续调参）。 */
export const DAGRE_OPTIONS = {
  rankdir: 'LR' as LayoutDirection,
  nodesep: 48,
  ranksep: 120,
  marginx: 24,
  marginy: 24,
} as const;

/** 卡片高度估算参数（头部 + 每行 + 折叠按钮）。 */
const CARD_HEADER_HEIGHT = 34;
const CARD_ROW_HEIGHT = 22;
/** 折叠时最多展示的列数（与 `ModelNodeCard` 的 `COLLAPSED_COLUMN_LIMIT` 对齐）。 */
const VISIBLE_ROW_LIMIT = 8;

/** 布局用节点尺寸（估算，见模块头细节 1）。 */
export interface NodeBoxSize {
  width: number;
  height: number;
}

/**
 * 估算节点尺寸（dagre 只吃相对尺寸；真实高度要等卡片渲染后由画布量出）。
 *
 * @param columnCount 该节点的字段数（决定行数）
 */
export function estimateNodeSize(columnCount: number): NodeBoxSize {
  const rows = Math.min(Math.max(columnCount, 1), VISIBLE_ROW_LIMIT);
  return {
    width: MODEL_NODE_WIDTH,
    height: CARD_HEADER_HEIGHT + rows * CARD_ROW_HEIGHT + (columnCount > VISIBLE_ROW_LIMIT ? 22 : 0),
  };
}

/**
 * 用 dagre 计算节点左上角坐标（**纯函数**：同样输入必得同样输出，可单测）。
 *
 * <p>dagre 返回的是**节点中心**坐标，ReactFlow 要的是**左上角** → 需减去半宽/半高
 * （这一步漏掉会让整张图右下偏移半个卡片，且看起来"只是有点歪"，不易发现）。
 *
 * @param nodes ReactFlow 节点（只用 id / data.columns 估尺寸）
 * @param edges ReactFlow 边（只用 source / target）
 * @param direction `LR`（默认，左→右）或 `TB`
 * @returns `id → {x, y}`（左上角，已就近取整）
 */
export function computeDagreLayout(
  nodes: Array<Node<CatalogNodeData>>,
  edges: Array<Edge<Record<string, unknown>>>,
  direction: LayoutDirection = DAGRE_OPTIONS.rankdir,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) {
    return positions;
  }

  const graph = new graphlib.Graph();
  graph.setGraph({
    rankdir: direction,
    nodesep: DAGRE_OPTIONS.nodesep,
    ranksep: DAGRE_OPTIONS.ranksep,
    marginx: DAGRE_OPTIONS.marginx,
    marginy: DAGRE_OPTIONS.marginy,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, NodeBoxSize>();
  for (const node of nodes) {
    const size = estimateNodeSize(node.data.columns?.length ?? 0);
    sizes.set(node.id, size);
    graph.setNode(node.id, { width: size.width, height: size.height });
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    // 只连两端都在图里的边（悬空边会让 dagre 隐式造出无尺寸节点 → 整张图被拉歪）
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagreLayout(graph);

  for (const node of nodes) {
    const laid: { x?: number; y?: number } = graph.node(node.id);
    const size = sizes.get(node.id) ?? estimateNodeSize(0);
    if (typeof laid.x !== 'number' || typeof laid.y !== 'number') {
      continue; // dagre 没给出坐标（理论上不会）→ 跳过，交给画布的网格兜底
    }
    positions.set(node.id, {
      x: Math.round(laid.x - size.width / 2),
      y: Math.round(laid.y - size.height / 2),
    });
  }
  return positions;
}

/** 把坐标套回节点（返回新数组；不改原节点）。 */
export function applyPositions(
  nodes: Array<Node<CatalogNodeData>>,
  positions: Map<string, { x: number; y: number }>,
): Array<Node<CatalogNodeData>> {
  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, position } : node;
  });
}

/** `AutoLayoutButton` Props。 */
export interface AutoLayoutButtonProps {
  connectionId: number | null;
  /** 是否允许写回（`iqd:modeling:edit`）；false → 按钮不渲染。 */
  canEdit: boolean;
  /** 布局方向（默认 LR）。 */
  direction?: LayoutDirection;
}

/**
 * 一键整理按钮（dagre 算坐标 → `saveModelLayout` 落库）。
 */
export function AutoLayoutButton({
  connectionId,
  canEdit,
  direction = DAGRE_OPTIONS.rankdir,
}: AutoLayoutButtonProps) {
  const { nodes, edges, isLoading } = useCatalogNodes(connectionId);
  const layout = useModelLayout({ connectionId, enabled: canEdit });
  const [localError, setLocalError] = useState<string | null>(null);

  const disabled = !canEdit || connectionId == null || isLoading || nodes.length === 0;

  const arrange = useCallback(() => {
    if (disabled) {
      return;
    }
    setLocalError(null);
    try {
      const positions = computeDagreLayout(nodes, edges, direction);
      if (positions.size === 0) {
        setLocalError('没有可整理的节点');
        return;
      }
      // 复用统一写路径：600ms 尾部防抖 + base_version 乐观并发 + 成功回写缓存
      layout.persist(applyPositions(nodes, positions), edges, layout.viewport);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '自动布局计算失败');
    }
  }, [disabled, nodes, edges, direction, layout]);

  if (!canEdit) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1 text-[13px]"
        disabled={disabled || layout.saving}
        title={
          disabled
            ? nodes.length === 0
              ? '画布暂无节点'
              : '画布加载中…'
            : '按依赖方向一键整理（dagre）'
        }
        onClick={arrange}
      >
        {layout.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
        一键整理
      </Button>
      {/* 冲突（40900）：本组件实例自持（见模块头细节 2）——只给「重载」这一条出口 */}
      {layout.conflict && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 text-[12px] text-amber-700"
          title={`布局已被他人修改（服务端版本 ${layout.conflict.currentVersion}）。重载后本地未落盘的排布会丢失。`}
          onClick={() => void layout.reload()}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重载布局
        </Button>
      )}
      {(localError || layout.saveError) && (
        <span className="text-[12px] text-destructive">{localError ?? layout.saveError}</span>
      )}
    </div>
  );
}

export default AutoLayoutButton;
