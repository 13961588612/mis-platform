/**
 * RelationEdge.tsx — 关系边（v1.11 MR-05：关系可视化）。
 *
 * <h2>为什么自定义边而不是内置 `smoothstep`</h2>
 * T02b-1 画布用的是内置 `smoothstep` + `label`（只有一条线 + 一个名字）。M-G2 要求
 * 「画布连线建 orders-customers 关系」后能**一眼看出基数与方向**（1:N 还是 N:1），
 * 否则建完关系无法自检，只能点开弹窗才知道配错没有。故本组件把 cardinality 编码进
 * **箭头（方向）+ 线型（是否特殊基数）**，见 {@link encodeCardinality}。
 *
 * <h2>编码规则（{@link encodeCardinality}，纯函数、可单测）</h2>
 * <table border="1">
 *   <caption>基数 → 视觉</caption>
 *   <tr><th>基数</th><th>箭头</th><th>线型</th><th>含义</th></tr>
 *   <tr><td>1:1</td><td>两端实心箭头</td><td>实线</td><td>一对一</td></tr>
 *   <tr><td>1:N</td><td>仅目标端箭头</td><td>实线</td><td>源 1 对 目标 多（默认，最常用）</td></tr>
 *   <tr><td>N:1</td><td>仅源端箭头</td><td>实线</td><td>源 多 对 目标 1</td></tr>
 *   <tr><td>N:N</td><td>两端箭头</td><td><b>虚线</b></td><td>多对多（语义特殊）→ 与 1:1 刻意区分</td></tr>
 * </table>
 * 选型理由：**箭头表方向、线型表「特殊基数」**，两类信息不挤同一通道（都用线型会让
 * 1:1 与 N:N 撞车）。
 *
 * <h2>三个易踩的坑（写之前先看）</h2>
 * <ol>
 *   <li><b>marker 不是自动的</b>：自定义边收到的 `markerEnd` / `markerStart` 是
 *       ReactFlow 按**边对象上的 `markerEnd` 字段**解析出来的 URL 字符串。若派生边时
 *       不设该字段，这里拿到的永远是 undefined → 箭头画不出来。故 `useCatalogNodes`
 *       派生关系边时**两个 marker 都设上**，由本组件按基数决定画哪端。</li>
 *   <li><b>细线点不中</b>：1.5px 的线很难点（用户要「点击进关系弹窗」）。用
 *       `BaseEdge` 的 `interactionWidth`（ReactFlow 内建的透明命中层），不要自己
 *       叠一条 path —— 自叠的 path 会参与 `elementsSelectable` 命中，行为更难预测。</li>
 *   <li><b>标签用 EdgeLabelRenderer</b>：`<textPath>` 需要路径有稳定 `id`（各版本
 *       BaseEdge 的内部 id 形态不同），属脆弱依赖；`EdgeLabelRenderer` 是官方 DOM
 *       叠层方案，且能直接吃项目的 Tailwind class。</li>
 * </ol>
 *
 * <h2>交互归属</h2>
 * 本组件**不自己处理点击**：点击开弹窗由 `ModelCanvas` 的 `onEdgeClick` 统一分发
 * （边是 SVG，在边内部挂 onClick 会和 ReactFlow 的选区/框选交互打架）。
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import type { Cardinality } from '../../types/modeling';
import { RELATION_EDGE_TYPE } from '../../hooks/useCatalogNodes';
import { encodeCardinality, normalizeJoinType } from './relationUtils';

/** 关系边 data（由 `useCatalogNodes` 派生时填充；字段全部可选以容忍历史数据）。 */
export interface RelationEdgeData extends Record<string, unknown> {
  /** 关系稳定键（`mdl:relationship:<name>`），点击弹窗按它回查 catalog。 */
  relationshipKey?: string;
  /** join 类型（inner / left / right / full）。 */
  joinType?: string;
  /** 基数。 */
  cardinality?: Cardinality | string;
  /** 完整 join 条件（hover / 弹窗展示）。 */
  condition?: string | null;
}

export { RELATION_EDGE_TYPE };

/** 关系边组件（注册为 `edgeTypes.iqdRelation`）。 */
export function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  markerStart,
  data,
  selected,
}: EdgeProps<Edge<RelationEdgeData>>) {
  const relation = data ?? {};
  const encoding = encodeCardinality(relation.cardinality);
  const joinType = normalizeJoinType(relation.joinType);

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={16}
        markerStart={encoding.arrowAtSource ? markerStart : undefined}
        markerEnd={encoding.arrowAtTarget ? markerEnd : undefined}
        style={{
          stroke: selected ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
          strokeWidth: selected ? 2 : 1.5,
          ...(encoding.strokeDasharray ? { strokeDasharray: encoding.strokeDasharray } : {}),
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="pointer-events-none absolute rounded border border-border/60 bg-background/90 px-1 py-0.5 text-[11px] text-muted-foreground"
          title={relation.condition ?? `${joinType} · ${encoding.label}`}
        >
          {joinType} · {encoding.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default RelationEdge;
