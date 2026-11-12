/**
 * useModelLayout.ts — 画布坐标持久化（v1.11 MR-S4 / §4.4 d 点；T03b 接入）。
 *
 * <h2>服务端契约（T03a 已落地，逐条对齐）</h2>
 * <ul>
 *   <li>`GET  /api/v1/iqd/modeling/layout/{connId}`（权限 `iqd:modeling:view`）：
 *       **未保存过也返回 200 + 空布局**（不是 404），可直接当初始视口
 *       `{nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},auto_layout_version:0,version:0}`；</li>
 *   <li>`PUT  /api/v1/iqd/modeling/layout/{connId}`（权限 `iqd:modeling:edit`）：
 *       `base_version` **必传**；不符返回 `40900 + data.current_version`；体积上限 1MB（42200）；</li>
 *   <li>首存 `version` 由 0 → 1，其后单调 +1（每次 PUT 都 +1，与「谁赢了」无关）。</li>
 * </ul>
 *
 * <h2>为什么 `base_version` 必须传（不做「可不传」的宽容）</h2>
 * 服务端语义：`base_version == null` → **不校验**（直接覆盖）。画布若图省事不传，
 * 就把「A 拖完、B 拖完」变成「谁后写谁覆盖，且无人察觉」——布局是多人共享的连接级数据，
 * 静默丢失他人排布比报错恶劣得多。故本 hook **始终传**当前已知版本。
 *
 * <h2>防抖策略（写死在这里，不散落到画布）</h2>
 * `onNodeDragStop` / `onMoveEnd` 都是「一次交互一次回调」，但用户会连续拖多个节点：
 * 逐次 PUT 会产生 N 个请求 + N 次 40900 风险。故：
 * <ul>
 *   <li>**600ms 尾部防抖**：同一批连续操作合并为 1 次 PUT；</li>
 *   <li>**只发最后一次快照**：每次调用覆盖待发载荷（不排队，避免「先发旧的后发新的」乱序）；</li>
 *   <li>**冲突后暂停**：收到 40900 后**停止自动保存**（否则每次拖拽都撞一次），
 *       由用户点「重载布局」显式收敛；</li>
 *   <li>**卸载即取消防抖**：避免对已切走的连接发 PUT（A-14 跨连接串扰）。</li>
 * </ul>
 *
 * <h2>与服务端真值的关系（Q5）</h2>
 * 布局是**视图数据**，不是 catalog 真值：本 hook 只做「读一次 + 写回」，坐标的**渲染真值**
 * 仍在画布的 React state（ReactFlow 受控模式），由本 hook 的 `positions` 做**初始/外部**覆盖。
 * 三者关系见 `ModelCanvas` 的合并逻辑（`mergeDerivedNodes`）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Edge, Node } from '@xyflow/react';
import { errorCode, errorData, getModelLayout, saveModelLayout } from '../api/iqd-modeling';
import type { Viewport } from '../types/modeling';
import type { CatalogNodeData } from './useCatalogNodes';
import { iqdKeys } from '../queries/iqd-keys';

/** 尾部防抖窗口（毫秒）：吞掉连续拖拽/缩放。 */
export const LAYOUT_SAVE_DEBOUNCE_MS = 600;

/** 布局节点（wire 形态，与服务端 `layout_json.nodes[]` 逐字对应）。 */
export interface LayoutNodeDto {
  item_key: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  collapsed?: boolean;
}

/** 布局边（wire 形态，与服务端 `layout_json.edges[]` 逐字对应）。 */
export interface LayoutEdgeDto {
  id: string;
  source: string;
  target: string;
  source_handle?: string | null;
  target_handle?: string | null;
}

/** 布局 DTO（wire 形态）。 */
export interface ModelLayoutDto {
  connection_id?: number;
  nodes: LayoutNodeDto[];
  edges: LayoutEdgeDto[];
  viewport: Viewport;
  auto_layout_version: number;
  version: number;
}

/** 空布局（服务端未保存过时的约定值）。 */
export const EMPTY_LAYOUT: ModelLayoutDto = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  auto_layout_version: 0,
  version: 0,
};

/** 默认视口（与后端空态一致）。 */
function defaultViewport(): Viewport {
  return { x: 0, y: 0, zoom: 1 };
}

/** 宽松取数（wire 是 `Record<string, unknown>`，历史/脏数据不能让画布崩）。 */
function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * 归一服务端返回的布局（**防御式**：字段缺失/类型不符一律回退默认值）。
 *
 * <p>为什么不直接 `as ModelLayoutDto`：布局是 JSONB，服务端不校验结构，
 * 任何历史脏数据都会一路流进画布 → `ReactFlow` 直接白屏。这里把「结构风险」
 * 收敛在一个纯函数里，便于单测。
 */
export function normalizeLayout(raw: Record<string, unknown> | null | undefined): ModelLayoutDto {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_LAYOUT, viewport: defaultViewport() };
  }
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const rawViewport =
    raw.viewport && typeof raw.viewport === 'object' ? (raw.viewport as Record<string, unknown>) : null;

  const nodes: LayoutNodeDto[] = [];
  for (const item of rawNodes) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const node = item as Record<string, unknown>;
    const itemKey = typeof node.item_key === 'string' ? node.item_key : '';
    if (itemKey === '') {
      continue; // 没有 item_key 的节点无法与 catalog 对齐 → 丢弃（宁缺勿错）
    }
    const width = asNumber(node.width, 0);
    const height = asNumber(node.height, 0);
    nodes.push({
      item_key: itemKey,
      x: asNumber(node.x, 0),
      y: asNumber(node.y, 0),
      ...(width > 0 ? { width } : {}),
      ...(height > 0 ? { height } : {}),
      ...(node.collapsed === true ? { collapsed: true } : {}),
    });
  }

  const edges: LayoutEdgeDto[] = [];
  for (const item of rawEdges) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const edge = item as Record<string, unknown>;
    const id = typeof edge.id === 'string' ? edge.id : '';
    const source = typeof edge.source === 'string' ? edge.source : '';
    const target = typeof edge.target === 'string' ? edge.target : '';
    if (id === '' || source === '' || target === '') {
      continue;
    }
    edges.push({
      id,
      source,
      target,
      source_handle: typeof edge.source_handle === 'string' ? edge.source_handle : null,
      target_handle: typeof edge.target_handle === 'string' ? edge.target_handle : null,
    });
  }

  return {
    connection_id: typeof raw.connection_id === 'number' ? raw.connection_id : undefined,
    nodes,
    edges,
    viewport: rawViewport
      ? {
          x: asNumber(rawViewport.x, 0),
          y: asNumber(rawViewport.y, 0),
          zoom: asNumber(rawViewport.zoom, 1) || 1,
        }
      : defaultViewport(),
    auto_layout_version: asNumber(raw.auto_layout_version, 0),
    version: asNumber(raw.version, 0),
  };
}

/**
 * 布局坐标表：`item_key` → `{x,y}`（画布按 **catalog 的 item_key** 对齐，而不是 ReactFlow 节点 id）。
 *
 * <p>用 item_key 而不是节点 id 的理由：节点 id 形如 `model:mdl:model:orders`，是**前端
 * 视图层的派生标识**；一旦派生规则变了（如 T03c 改成分组节点），历史布局会整片失配。
 * item_key 是跨端稳定契约（§8.6），是唯一该进持久化的锚点。
 */
export function layoutPositions(layout: ModelLayoutDto): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of layout.nodes) {
    positions.set(node.item_key, { x: node.x, y: node.y });
  }
  return positions;
}

/**
 * 合并「catalog 派生节点」与「本地交互态 + 已持久化坐标」。
 *
 * <p>合并规则（顺序即优先级）：
 * <ol>
 *   <li>坐标：若节点正在 {@code dragging} → **强制本地**（拖拽中绝不用服务端坐标覆盖，
 *       否则 catalog / layout 任一重算都会「闪回」）；</li>
 *   <li>其余：默认 **本地既有** > **已持久化** > 派生网格；
 *       仅当调用方显式 {@code preferPersisted}（首载 / 冲突重载 / 本端保存成功后 version bump）
 *       时改为 **已持久化** > 本地 > 网格；</li>
 *   <li>交互态（`selected` / `dragging` / `measured`）从本地既有节点继承 —— 否则一次
 *       catalog 轮询就会把用户的选中态和刚量出的尺寸清掉（表现为「选中闪一下」）；</li>
 *   <li>catalog 里已消失的节点直接丢弃（不保留孤儿节点）；</li>
 *   <li>新增节点用网格坐标落位（`derived` 已算好）。</li>
 * </ol>
 *
 * <p><b>为什么默认本地既有优先于服务端</b>：拖拽结束 → 防抖 600ms → PUT 完成，
 * 这段窗口内若发生 catalog 轮询（5s 一次）或 layout 重取，服务端坐标**还没有新位置**，
 * 若盲目以服务端为准就会把节点**弹回原位**。
 */
export function mergeDerivedNodes(
  derived: Array<Node<CatalogNodeData>>,
  previous: Array<Node<CatalogNodeData>>,
  positions: Map<string, { x: number; y: number }>,
  options?: { preferPersisted?: boolean },
): Array<Node<CatalogNodeData>> {
  const preferPersisted = options?.preferPersisted === true;
  const prevById = new Map(previous.map((node) => [node.id, node]));
  return derived.map((node) => {
    const prev = prevById.get(node.id);
    const persisted = positions.get(node.data.itemKey);
    let position = node.position;
    if (prev?.dragging) {
      position = prev.position;
    } else if (preferPersisted) {
      position = persisted ?? prev?.position ?? node.position;
    } else {
      position = prev?.position ?? persisted ?? node.position;
    }
    if (!prev) {
      return { ...node, position };
    }
    return {
      ...node,
      position,
      selected: prev.selected,
      dragging: prev.dragging,
      measured: prev.measured,
    };
  });
}

/** 画布节点 → 布局节点（只保留视图坐标，不落任何模型语义）。 */
export function toLayoutNodes(nodes: Array<Node<CatalogNodeData>>): LayoutNodeDto[] {
  return nodes.map((node) => {
    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    return {
      item_key: node.data.itemKey,
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      ...(width > 0 ? { width: Math.round(width) } : {}),
      ...(height > 0 ? { height: Math.round(height) } : {}),
      // TODO(后续批次)：折叠态目前是 ModelNodeCard 的本地 state（未进 catalog/store），
      // 故这里恒 false；T03c 把折叠态收敛到 store 后再写入真实值。
      collapsed: false,
    };
  });
}

/** 画布边 → 布局边（锚点暂为 null：`ModelNodeCard` 用左右默认 Handle）。 */
export function toLayoutEdges(edges: Array<Edge<Record<string, unknown>>>): LayoutEdgeDto[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    source_handle: edge.sourceHandle ?? null,
    target_handle: edge.targetHandle ?? null,
  }));
}

/** `useModelLayout` 入参。 */
export interface UseModelLayoutOptions {
  connectionId: number | null;
  /** 是否允许写回（`iqd:modeling:edit`）；false → 只读，不发 PUT。 */
  enabled: boolean;
}

/** `useModelLayout` 返回值。 */
export interface UseModelLayoutResult {
  /** 布局坐标（item_key → {x,y}）；空 Map = 从未保存过。 */
  positions: Map<string, { x: number; y: number }>;
  /** 已持久化视口（未保存过时为默认值 `{0,0,1}`）。 */
  viewport: Viewport;
  /** 持久化版本（PUT 的 `base_version` 来源）。 */
  version: number;
  /** 布局拉取中。 */
  isLoading: boolean;
  /** 布局拉取失败（非致命：画布退回网格布局，不阻塞编辑）。 */
  loadError: string | null;
  /** 保存中（画布可显示「保存中…」）。 */
  saving: boolean;
  /** 非 40900 的保存失败消息。 */
  saveError: string | null;
  /** 乐观并发冲突（非 null → 暂停自动保存，提示用户重载）。 */
  conflict: { currentVersion: number } | null;
  /** 提交快照（内部 600ms 防抖）。 */
  persist: (
    nodes: Array<Node<CatalogNodeData>>,
    edges: Array<Edge<Record<string, unknown>>>,
    viewport: Viewport,
  ) => void;
  /** 重载布局（丢弃本地未保存坐标）并清冲突。 */
  reload: () => Promise<void>;
}

/**
 * 画布布局读写 hook（读取 + 防抖写回 + 乐观并发冲突处理）。
 */
export function useModelLayout(options: UseModelLayoutOptions): UseModelLayoutResult {
  const { connectionId, enabled } = options;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: iqdKeys.modelLayout(connectionId),
    queryFn: () => getModelLayout(connectionId as number),
    enabled: connectionId != null,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const layout = useMemo(() => normalizeLayout(query.data ?? null), [query.data]);
  const positions = useMemo(() => layoutPositions(layout), [layout]);

  /** 版本基线：用 ref 避免「保存成功后 version 变化 → 依赖重建 → 重复保存」的循环。 */
  const versionRef = useRef<number>(layout.version);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conflictRef = useRef(false);
  const connectionRef = useRef<number | null>(connectionId);
  connectionRef.current = connectionId;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ currentVersion: number } | null>(null);

  /** 服务端布局变化（首次加载 / reload / 外部改动）→ 刷新版本基线。 */
  useEffect(() => {
    versionRef.current = layout.version;
  }, [layout.version]);

  /** 连接切换：清所有瞬时状态（A-14：不把 A 连接的冲突/错误带到 B）。 */
  useEffect(() => {
    conflictRef.current = false;
    setConflict(null);
    setSaveError(null);
    setSaving(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [connectionId]);

  /** 卸载取消防抖：不对已卸载/已切走的连接发 PUT。 */
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  const doSave = useCallback(
    async (
      nodes: Array<Node<CatalogNodeData>>,
      edges: Array<Edge<Record<string, unknown>>>,
      viewport: Viewport,
      targetConnectionId: number,
    ) => {
      setSaving(true);
      try {
        const saved = await saveModelLayout(
          targetConnectionId,
          {
            nodes: toLayoutNodes(nodes),
            edges: toLayoutEdges(edges),
            viewport,
          },
          versionRef.current,
        );
        const savedVersion = saved ? asNumber(saved.version, versionRef.current + 1) : versionRef.current + 1;
        versionRef.current = savedVersion;
        // 写回缓存：让 `positions` 与服务端一致。
        // **必须做**：否则缓存里仍是 RPC 之前的旧坐标，下一次 catalog 轮询触发的合并会
        // 用**旧的服务端坐标**覆盖用户刚拖好的位置 → 节点「弹回原位」（最难查的一类抖动）。
        if (saved) {
          queryClient.setQueryData(iqdKeys.modelLayout(targetConnectionId), saved);
        }
        conflictRef.current = false;
        setConflict(null);
        setSaveError(null);
      } catch (err) {
        const code = errorCode(err);
        if (code === 40900) {
          // 乐观并发冲突：服务端已有更新版本（他人拖拽过）。暂停自动保存，等用户决定。
          const currentVersion = asNumber(errorData(err)?.current_version, versionRef.current);
          conflictRef.current = true;
          setConflict({ currentVersion });
        } else {
          setSaveError(err instanceof Error ? err.message : '保存布局失败');
        }
      } finally {
        setSaving(false);
      }
    },
    [queryClient],
  );

  const persist = useCallback(
    (
      nodes: Array<Node<CatalogNodeData>>,
      edges: Array<Edge<Record<string, unknown>>>,
      viewport: Viewport,
    ) => {
      const targetConnectionId = connectionRef.current;
      if (!enabled || targetConnectionId == null) {
        return;
      }
      if (conflictRef.current) {
        // 冲突未收敛前不再自动保存（否则每次拖拽都撞 40900，且刷屏提示）
        return;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void doSave(nodes, edges, viewport, targetConnectionId);
      }, LAYOUT_SAVE_DEBOUNCE_MS);
    },
    [enabled, doSave],
  );

  const reload = useCallback(async () => {
    conflictRef.current = false;
    setConflict(null);
    setSaveError(null);
    await query.refetch();
  }, [query]);

  return {
    positions,
    viewport: layout.viewport,
    version: layout.version,
    isLoading: query.isLoading,
    loadError:
      query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    saving,
    saveError,
    conflict,
    persist,
    reload,
  };
}

export default useModelLayout;
