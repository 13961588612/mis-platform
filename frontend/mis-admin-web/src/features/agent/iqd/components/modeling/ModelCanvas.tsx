/**
 * ModelCanvas.tsx — ER 画布（v1.11 MR-S2 / A-15）。
 *
 * <h2>构成</h2>
 * `@xyflow/react@^12`（T01 已装）的 `<ReactFlow>` + `<Background>` + `<MiniMap>` + `<Controls>`；
 * 节点类型注册两态：`iqdModel` / `iqdTable`（同一 `ModelNodeCard` 组件，按 `data.kind` 变形）。
 *
 * <h2>性能（A-15：200 节点虚拟化）</h2>
 * `onlyRenderVisibleElements` 打开——只渲染视口内节点，200 节点下拖拽/缩放保持流畅。
 *
 * <h2>数据来源（Q5）</h2>
 * nodes/edges 全部由 {@link useCatalogNodes} 从 TanStack Query 的 catalog 缓存**派生**；
 * 本组件**不持有节点 state**（不复制真值）。
 *
 * <h2>只读 vs 编辑（本批边界）</h2>
 * 本批画布**恒为只读**（`nodesDraggable=false` / `nodesConnectable=false`）：拖拽后的坐标需要
 * 持久化到 `iqd_model_layout`（A-02/Q6），而该服务端能力属 **T03**；若现在放开拖拽，
 * 任何一次 catalog 刷新（5000ms 轮询/失效重取）都会把节点位置**弹回网格**，属明显 bug。
 * 故此处只把 `canEdit`（`iqd:modeling:edit`）**接好并用于只读提示**，T03 落地 layout PUT 后
 * 只需把两个 `nodesDraggable/nodesConnectable` 改为 `canEdit` 并接 `onNodesChange` 即可。
 *
 * <h2>多连接隔离（A-14）</h2>
 * `<ReactFlow key={connectionId}>`：切连接即重挂载，视口/选中/内部状态一并清空，
 * 不会把 A 连接的画布残留带到 B 连接。
 */
import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '@/lib/utils';
import { useIqdModelingPermission } from '../../components/shared/usePermission';
import { MODEL_NODE_TYPE, TABLE_NODE_TYPE, useCatalogNodes } from '../../hooks/useCatalogNodes';
import { ModelNodeCard } from './ModelNodeCard';

/** 节点类型注册表（模块级常量：避免每次 render 新建对象导致 ReactFlow 全量重挂）。 */
const NODE_TYPES = {
  [MODEL_NODE_TYPE]: ModelNodeCard,
  [TABLE_NODE_TYPE]: ModelNodeCard,
} as unknown as NodeTypes;

/** `ModelCanvas` Props。 */
export interface ModelCanvasProps {
  /** 当前连接 id；null → 空态（由父组件引导去连接向导）。 */
  connectionId: number | null;
}

/** ER 画布。 */
function ModelCanvasInner({ connectionId }: ModelCanvasProps) {
  const { nodes, edges, isLoading, error } = useCatalogNodes(connectionId);
  const { canEdit } = useIqdModelingPermission();

  const isEmpty = !isLoading && !error && nodes.length === 0;
  const viewKey = useMemo(() => `conn-${connectionId ?? 'none'}`, [connectionId]);

  return (
    <div className="relative min-h-0 flex-1 border-x border-border/60">
      {/* 只读提示（无 edit 权限 / 本批未开放拖拽） */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-2">
        {!canEdit && (
          <span className="rounded border border-border/60 bg-background/90 px-1.5 py-0.5 text-[12px] text-muted-foreground">
            只读：无 iqd:modeling:edit 权限
          </span>
        )}
        {canEdit && (
          <span className="rounded border border-border/60 bg-background/90 px-1.5 py-0.5 text-[12px] text-muted-foreground">
            编辑能力（拖拽/连线）将于 T03 随布局持久化开放
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
          正在加载模型…
        </div>
      )}

      {!isLoading && error && (
        <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-destructive">
          加载模型失败：{error}
        </div>
      )}

      {isEmpty && (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-[13px] font-medium">该连接还没有任何模型</p>
          <p className="text-[12px] text-muted-foreground">
            用左侧「表发现」导入物理表，或先执行一次 MDL 同步把库结构拉进 catalog。
          </p>
        </div>
      )}

      {!isLoading && !error && nodes.length > 0 && (
        <ReactFlow
          key={viewKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onlyRenderVisibleElements
          // 本批恒只读（见模块头「只读 vs 编辑」）；T03 改为 canEdit 并接 onNodesChange
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          elementsSelectable
          fitView
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className={cn('bg-muted/20')}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <MiniMap pannable zoomable className="!bg-background" />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
    </div>
  );
}

/**
 * 画布出口：包一层 {@link ReactFlowProvider}。
 *
 * <p>理由：`ReactFlow` 的 `useReactFlow()`（T03 自动布局 / fitView 复位）必须在 Provider 内调用；
 * 现在就把 Provider 立在画布边界，T03 无需再改父组件结构。
 */
export function ModelCanvas(props: ModelCanvasProps) {
  return (
    <ReactFlowProvider>
      <ModelCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export default ModelCanvas;
