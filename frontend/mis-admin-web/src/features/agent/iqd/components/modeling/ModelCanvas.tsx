/**
 * ModelCanvas.tsx — ER 画布（v1.11 MR-S2 / MR-05 / MR-S4；T03b 放开编辑）。
 *
 * <h2>构成</h2>
 * `@xyflow/react@^12` 的 `<ReactFlow>` + `<Background>` + `<MiniMap>` + `<Controls>`；
 * 节点类型 `iqdModel` / `iqdTable`（同一 `ModelNodeCard`，按 `data.kind` 变形）；
 * 边类型 `iqdRelation`（{@link RelationEdge}：基数编码 + 条件 hover）。
 *
 * <h2>性能（A-15：200 节点虚拟化）</h2>
 * `onlyRenderVisibleElements` 打开——只渲染视口内节点。
 *
 * <h2>数据来源与「谁是真值」（Q5）</h2>
 * <ul>
 *   <li><b>catalog 语义</b>（有哪些节点/字段/关系）= TanStack Query 缓存 → `useCatalogNodes` 派生；</li>
 *   <li><b>坐标</b>= `iqd_model_layout`（服务端视图数据）→ {@link useModelLayout} 读一次 + 防抖写回；</li>
 *   <li><b>交互态</b>（拖拽中的位置、选中、量出的尺寸）= ReactFlow 受控模式的**组件本地 state**
 *       （`useNodesState` 的等价手写实现）。</li>
 * </ul>
 * 三者合并规则见 `mergeDerivedNodes`（**本地既有坐标优先于服务端**，否则 catalog 轮询
 * 会把刚拖完还没保存完的节点弹回原位）。**画布不往 zustand 里存 nodes/edges**（Q5 红线）。
 *
 * <h2>编辑能力（T03b 本批）</h2>
 * <ul>
 *   <li>`nodesDraggable` / `nodesConnectable` = `canEdit`（`iqd:modeling:edit`）；</li>
 *   <li>拖拽结束 → 600ms 防抖 PUT 布局（{@link useModelLayout.persist}）；
 *       视口变化（缩放/平移结束）同样落库；**首存 version 0 → 1**；</li>
 *   <li>连线（节点右 Handle → 目标节点）→ 打开 `RelationshipDialog`（预填两端，默认 INNER 1:N）；</li>
 *   <li>点关系边 → 同弹窗的**查看态**（见下方「为什么点边不是编辑」）；</li>
 *   <li>`base_version` 冲突（40900）→ 顶部橙色条 + 「重载布局」按钮，且**暂停自动保存**。</li>
 * </ul>
 *
 * <h2>为什么「点边」是查看而不是编辑（偏离说明）</h2>
 * T03a 的 `POST /catalog/relationship` 是 **create-only 且双幂等**：同 `item_key` 已存在时
 * 直接返回首次结果、**不应用新字段**。若把「查看弹窗」做成可编辑并保存，会出现
 * 「提示保存成功、实际没改」的静默缺陷。修改既有关系应走 `PUT /catalog/node`
 * （T03a 报告「给 T03b 的接口备注 6」），其 UI 属 T03c。故本批点边只做**只读查看**
 * （仍满足 MR-05「点击进关系弹窗」，且不撒谎）。`TODO(后续批次)`：接 `PUT /catalog/node`
 * 后把 `RelationshipDialog` 的 `mode` 扩出 `edit`。
 *
 * <h2>多连接隔离（A-14）</h2>
 * `<ReactFlow key={connectionId}>`：切连接即重挂载，视口/选中/内部状态一并清空。
 *
 * <h2>刻意不做</h2>
 * 本批**不调** `POST /modeling/layout/{id}/auto-layout`：该端点在 T03a 按 A-02 裁决
 * 恒返回 **HTTP 501**（服务端不做 dagre），自动布局按钮（前端算 dagre + PUT）属 T03c。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { IqdCatalogItem } from '@/lib/api/iqd';
import { useIqdModelingPermission } from '../../components/shared/usePermission';
import { useSyncStatus } from '../../components/shared/useSyncStatus';
import {
  MODEL_NODE_TYPE,
  TABLE_NODE_TYPE,
  useCatalogNodes,
  type CatalogNodeData,
} from '../../hooks/useCatalogNodes';
import { useModelLayout, mergeDerivedNodes } from '../../hooks/useModelLayout';
import { iqdKeys } from '../../queries/iqd-keys';
import { useModelingStore } from '../../store/modeling-store';
import { ModelNodeCard } from './ModelNodeCard';
import { RelationEdge, RELATION_EDGE_TYPE } from './RelationEdge';
import { RelationshipDialog, type RelationEndpoint } from './RelationshipDialog';

/** 节点类型注册表（模块级常量：避免每次 render 新建对象导致 ReactFlow 全量重挂）。 */
const NODE_TYPES = {
  [MODEL_NODE_TYPE]: ModelNodeCard,
  [TABLE_NODE_TYPE]: ModelNodeCard,
} as unknown as NodeTypes;

/** 边类型注册表。 */
const EDGE_TYPES = {
  [RELATION_EDGE_TYPE]: RelationEdge,
} as unknown as EdgeTypes;

/** 关系边的 data 形状（与 `RelationEdgeData` 一致，此处只需读到 key）。 */
interface CanvasEdgeData extends Record<string, unknown> {
  relationshipKey?: string;
}

/** `ModelCanvas` Props。 */
export interface ModelCanvasProps {
  /** 当前连接 id；null → 空态（由父组件引导去连接向导）。 */
  connectionId: number | null;
}

/** 画布内部（在 `ReactFlowProvider` 之内，可用 `useReactFlow`）。 */
function ModelCanvasInner({ connectionId }: ModelCanvasProps) {
  const { nodes: derivedNodes, edges: derivedEdges, catalog, isLoading, error } = useCatalogNodes(connectionId);
  const { canEdit } = useIqdModelingPermission();
  const queryClient = useQueryClient();
  const { setViewport: applyReactFlowViewport } = useReactFlow();
  const sync = useSyncStatus(connectionId);
  const setSelected = useModelingStore((state) => state.setSelected);

  const layout = useModelLayout({ connectionId, enabled: canEdit });

  /** ReactFlow 受控节点/边（交互态本地持有；语义仍来自 catalog 派生）。 */
  const [nodes, setNodes] = useState<Array<Node<CatalogNodeData>>>([]);
  const [edges, setEdges] = useState<Array<Edge<CanvasEdgeData>>>([]);
  const viewportRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  /** 最新 nodes/edges：拖拽结束闭包里读它，避免 persist 到「上一帧」坐标。 */
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  /**
   * 已套用过的 layout 版本戳。version 变化（首载 / 本端保存成功 / 冲突重载）时
   * 才 `preferPersisted`；平常 catalog 轮询只合语义、不抢坐标。
   */
  const appliedLayoutVersionRef = useRef<string>('');

  /** 关系弹窗状态：create = 拖拽连线；view = 点击既有边。 */
  const [dialog, setDialog] = useState<{
    mode: 'create' | 'view';
    source: RelationEndpoint | null;
    target: RelationEndpoint | null;
    existing: IqdCatalogItem | null;
  } | null>(null);

  const isEmpty = !isLoading && !error && derivedNodes.length === 0;
  const viewKey = useMemo(() => `conn-${connectionId ?? 'none'}`, [connectionId]);

  // ---------------------------------------------------------------- catalog 派生 → 本地节点（合并）
  useEffect(() => {
    if (connectionId == null) {
      appliedLayoutVersionRef.current = '';
      setNodes([]);
      return;
    }
    if (layout.isLoading) {
      return;
    }
    const versionKey = `${connectionId}:${layout.version}`;
    const sameConnection = appliedLayoutVersionRef.current.startsWith(`${connectionId}:`);
    const force = forceViewportReloadRef.current;
    // 与视口同口径：仅首载 / 强制重载吃服务端坐标；本端保存 version bump 不抢本地
    const preferPersisted =
      appliedLayoutVersionRef.current !== versionKey && (!sameConnection || force);
    if (appliedLayoutVersionRef.current !== versionKey) {
      appliedLayoutVersionRef.current = versionKey;
    }
    setNodes((prev) =>
      mergeDerivedNodes(derivedNodes, prev, layout.positions, { preferPersisted }),
    );
  }, [connectionId, derivedNodes, layout.positions, layout.version, layout.isLoading]);

  useEffect(() => {
    setEdges((prev) => mergeEdges(derivedEdges, prev));
  }, [derivedEdges]);

  /**
   * 服务端视口：只在「本连接首次加载」或「强制重载」时套用一次。
   *
   * <p>旧逻辑在每次 layout.version 变化（含本端缩放/拖拽保存成功）都 `setViewport`，
   * 会把用户刚滚轮缩放到一半的视口拽回保存前的旧值 → 「放大缩小闪回」。
   * 同连接下 version 自增只更新戳，不抢 ReactFlow 当前视口；冲突「重载布局」会清空戳强制再套。
   */
  const appliedViewportRef = useRef<string>('');
  const forceViewportReloadRef = useRef(false);

  useEffect(() => {
    // 切连接：下次 effect 视为首次
    appliedLayoutVersionRef.current = '';
    appliedViewportRef.current = '';
    forceViewportReloadRef.current = false;
  }, [connectionId]);

  useEffect(() => {
    if (connectionId == null || layout.isLoading) {
      return;
    }
    const stamp = `${connectionId}:${layout.version}`;
    if (appliedViewportRef.current === stamp) {
      return;
    }

    const sameConnection = appliedViewportRef.current.startsWith(`${connectionId}:`);
    const force = forceViewportReloadRef.current;
    forceViewportReloadRef.current = false;

    // 同连接、非强制重载：本端保存导致的 version bump → 不覆盖用户正在操作的视口
    if (sameConnection && !force) {
      appliedViewportRef.current = stamp;
      return;
    }

    appliedViewportRef.current = stamp;
    const { viewport } = layout;
    if (viewport) {
      applyReactFlowViewport(viewport);
      viewportRef.current = viewport;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, layout.isLoading, layout.version, applyReactFlowViewport]);

  const handleReloadLayout = useCallback(() => {
    // 强制套用服务端节点坐标与视口（等 isLoading 结束后由 effect 消费 force 标志）
    appliedLayoutVersionRef.current = '';
    forceViewportReloadRef.current = true;
    void layout.reload();
  }, [layout]);

  // ---------------------------------------------------------------- 交互
  const onNodesChange = useCallback((changes: Array<NodeChange<Node<CatalogNodeData>>>) => {
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, []);

  /**
   * 边变更：**过滤掉 `remove`**。
   *
   * <p>RELATION 的删除要落 catalog（并在后端做引用阻断），属 T03c 的删除路径；
   * 若这里默默把边从画布移除，用户会以为「关系删了」，刷新后又回来 —— 比不支持删除更糟。
   */
  const onEdgesChange = useCallback((changes: Array<EdgeChange<Edge<CanvasEdgeData>>>) => {
    const kept = changes.filter((change) => change.type !== 'remove');
    if (kept.length === 0) {
      return;
    }
    setEdges((prev) => applyEdgeChanges(kept, prev));
  }, []);

  /**
   * 画布选中 → 同步右栏 PropertyPanel（store.selectedItemKey）。
   *
   * <p>此前只有左树 `ModelTree` 调 `setSelected`，点画布节点时右栏一直停在
   * 「未选中」——看起来像属性面板坏了。多选时取第一个节点。
   */
  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Array<Node<CatalogNodeData>> }) => {
      const first = selectedNodes[0];
      setSelected(first?.data?.itemKey ?? null);
    },
    [setSelected],
  );

  /** 拖拽结束 → 防抖写回坐标（读 ref，避免闭包停在拖拽前一帧）。 */
  const onNodeDragStop = useCallback(() => {
    layout.persist(nodesRef.current, edgesRef.current, viewportRef.current);
  }, [layout]);

  /** 缩放/平移结束 → 落视口（与节点共用同一防抖窗口）。 */
  const onMoveEnd = useCallback(
    (_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
      viewportRef.current = viewport;
      layout.persist(nodesRef.current, edgesRef.current, viewport);
    },
    [layout],
  );

  /** 连线创建关系：**不开临时边**（真假值只认 catalog；保存成功后失效缓存自动出现）。 */
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!canEdit || connection.source == null || connection.target == null) {
        return;
      }
      const source = endpointOf(nodes, connection.source);
      const target = endpointOf(nodes, connection.target);
      if (!source || !target || source.itemKey === target.itemKey) {
        return; // 自连接无意义（后端也不允许源=目标）
      }
      setDialog({ mode: 'create', source, target, existing: null });
    },
    [canEdit, nodes],
  );

  /** 点击关系边 → 查看态弹窗。 */
  const onEdgeClick = useCallback(
    (_event: unknown, edge: Edge) => {
      const { relationshipKey } = (edge.data ?? {}) as CanvasEdgeData;
      const existing = relationshipKey
        ? catalog.find((item) => item.item_key === relationshipKey) ?? null
        : null;
      const source = endpointOf(nodes, edge.source);
      const target = endpointOf(nodes, edge.target);
      setDialog({ mode: 'view', source, target, existing });
    },
    [catalog, nodes],
  );

  const closeDialog = useCallback(() => setDialog(null), []);

  const handleSaved = useCallback(() => {
    setDialog(null);
    // 关系落库后失效 catalog 缓存 → 画布重新派生（新的关系边出现）
    void queryClient.invalidateQueries({ queryKey: iqdKeys.catalogs(connectionId) });
  }, [queryClient, connectionId]);

  const baseRevision = sync.status?.current_edit_revision ?? null;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col border-x border-border/60">
      {/* 左上角状态区：权限 / 保存 / 冲突 */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-2">
        {!canEdit && (
          <span className="rounded border border-border/60 bg-background/90 px-1.5 py-0.5 text-[12px] text-muted-foreground">
            只读：无 iqd:modeling:edit 权限
          </span>
        )}
        {canEdit && (
          <span className="rounded border border-border/60 bg-background/90 px-1.5 py-0.5 text-[12px] text-muted-foreground">
            可拖拽节点 · 从右侧圆点拖到目标节点即可建关系
          </span>
        )}
        {layout.saving && (
          <span className="flex items-center gap-1 rounded border border-border/60 bg-background/90 px-1.5 py-0.5 text-[12px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            保存布局…
          </span>
        )}
        {layout.saveError && (
          <span className="rounded border border-destructive/40 bg-background/90 px-1.5 py-0.5 text-[12px] text-destructive">
            布局保存失败：{layout.saveError}
          </span>
        )}
        {layout.loadError && (
          <span className="rounded border border-border/60 bg-background/90 px-1.5 py-0.5 text-[12px] text-muted-foreground">
            布局加载失败（已用网格排布）：{layout.loadError}
          </span>
        )}
      </div>

      {/* 乐观并发冲突：暂停自动保存 + 显式重载（拖拽不会丢，但不会写回） */}
      {layout.conflict && (
        <div className="absolute inset-x-2 top-10 z-10 flex items-center justify-between gap-3 rounded border border-amber-500/50 bg-amber-50/95 px-2 py-1.5 text-[12px] text-amber-900">
          <span>
            布局已被他人修改（服务端版本 {layout.conflict.currentVersion}）。本地拖拽已暂停保存，
            请重载后重排，或忽略此提示继续本地查看。
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 gap-1 px-2 text-[12px]"
            onClick={handleReloadLayout}
          >
            <RotateCcw className="h-3 w-3" />
            重载布局
          </Button>
        </div>
      )}

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

      {!isLoading && !error && derivedNodes.length > 0 && (
        <ReactFlow
          key={viewKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onlyRenderVisibleElements
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          edgesFocusable={canEdit}
          elementsSelectable
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          onNodeDragStop={canEdit ? onNodeDragStop : undefined}
          onMoveEnd={canEdit ? onMoveEnd : undefined}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          // 无持久化布局时首屏 fitView；勿在缩放过程中因 positions 短暂为空反复 fit
          fitView={layout.positions.size === 0 && !layout.isLoading}
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

      <RelationshipDialog
        open={dialog != null}
        mode={dialog?.mode ?? 'create'}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        connectionId={connectionId}
        source={dialog?.source ?? null}
        target={dialog?.target ?? null}
        existing={dialog?.existing ?? null}
        baseRevision={baseRevision}
        onSaved={handleSaved}
      />
    </div>
  );
}

/** 节点 id → 关系端点（`model:<item_key>` → itemKey + 显示名 + 字段名）。 */
function endpointOf(
  nodes: Array<Node<CatalogNodeData>>,
  nodeId: string | null | undefined,
): RelationEndpoint | null {
  if (!nodeId) {
    return null;
  }
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) {
    return null;
  }
  return {
    itemKey: node.data.itemKey,
    displayName: node.data.displayName,
    fields: (node.data.columns ?? [])
      .map((column) => column.display_name ?? column.item_key)
      .filter((name): name is string => Boolean(name)),
  };
}

/**
 * 合并边：派生边为准，保留本地选中态（`remove` 已在 `onEdgesChange` 过滤）。
 */
function mergeEdges(
  derived: Array<Edge<CanvasEdgeData>>,
  previous: Array<Edge<CanvasEdgeData>>,
): Array<Edge<CanvasEdgeData>> {
  const prevById = new Map(previous.map((edge) => [edge.id, edge]));
  return derived.map((edge) => {
    const prev = prevById.get(edge.id);
    return prev ? { ...edge, selected: prev.selected } : edge;
  });
}

export function ModelCanvas(props: ModelCanvasProps) {
  return (
    <ReactFlowProvider>
      <ModelCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export default ModelCanvas;
