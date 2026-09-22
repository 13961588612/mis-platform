/**
 * useCatalogNodes.ts — 画布数据派生（v1.11 MR-S2 / Q5）。
 *
 * <h2>红线（Q5，务必守住）</h2>
 * **服务端状态 = TanStack Query 的 catalog 缓存（唯一真值）；画布 nodes/edges 是「视图」，
 * 由 selector 派生，绝不复制缓存、绝不放进 zustand。** 因此本 hook：
 * <ul>
 *   <li>不持有任何 `useState`（派生结果每次 render 由 `useMemo` 从同一份缓存算出）；</li>
 *   <li>失效/刷新走 Query（`refetch`），画布自动跟随；</li>
 *   <li>布局坐标暂由**确定性网格**生成（A-02：dagre 前端算；坐标持久化属 T03
 *       `iqd_model_layout`），T03 接入后仅需把 `positionOf` 换成 layout 数据源。</li>
 * </ul>
 *
 * <h2>派生规则（与 T02a 落库形态严格对齐）</h2>
 * <ol>
 *   <li><b>model 节点</b>：`kind=model`（item_key `mdl:model:<name>`）。它的字段 = 同连接下
 *       `kind=column` 且 `parent_key` 等于「该模型对应物理表的 tableKey」
 *       （T02a/`IqdMdlParser` 的既有约定：`column.parent_key = <datasource>.<schema>.<table>`），
 *       **外加** `parent_key = <模型 item_key>` 的计算列（T03 §4.3 约定）。</li>
 *   <li><b>table 节点</b>：`kind=table` 且**没有**对应 model（未建模的物理表）→ 浅灰虚线卡
 *       （见 `ModelNodeCard`）。已建模的表不单独成节点，避免与 model 节点重复。</li>
 *   <li><b>cube 不单独成节点</b>（避免节点爆炸）：以「指标」角标挂在所属 model 上；
 *       cube→model 的归属目前**只能是启发式**（见 {@link attachMeasures} 注释）。</li>
 *   <li><b>edge</b>：`kind=relationship`（item_key `mdl:relationship:<name>`，
 *       `expression` 存 join 条件，见 `IqdMdlParser`）→ 解析 `a.x = b.y` 的左右限定名，
 *       映射到 model 节点；条件无法解析时不画边（宁缺勿错，避免拉出错误的 ER 关系）。</li>
 * </ol>
 *
 * <p>所有「启发式/暂缺」都写了显式注释，便于 T02b-2 / T03 收敛。
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Edge, Node } from '@xyflow/react';
import { listIqdCatalog, type IqdCatalogItem } from '@/lib/api/iqd';
import { iqdKeys } from '../queries/iqd-keys';

/** 画布节点类型（与 `ModelNodeCard` 注册的 nodeTypes key 一致）。 */
export const MODEL_NODE_TYPE = 'iqdModel';
export const TABLE_NODE_TYPE = 'iqdTable';

/** 模型卡宽（像素）；高度由卡片按可见字段数自适应，仅供布局估算。 */
export const MODEL_NODE_WIDTH = 260;

/** 网格布局参数（T03 接入持久化布局前的确定性兜底）。 */
const GRID_COLUMNS = 3;
const GRID_X_GAP = 340;
const GRID_Y_GAP = 300;
const GRID_ORIGIN_X = 40;
const GRID_ORIGIN_Y = 40;

/** 画布节点数据（ReactFlow v12 要求 data 可索引）。 */
export interface CatalogNodeData extends Record<string, unknown> {
  itemKey: string;
  /** `model` = 已建模；`table` = 未建模的物理表（虚线卡）。 */
  kind: 'model' | 'table';
  displayName: string;
  /** 字段清单（模型卡「默认只显示前 8 列」，由卡片裁剪）。 */
  columns: IqdCatalogItem[];
  /** 挂在本模型上的 Cube 名（「指标」角标）。 */
  measureNames: string[];
  description?: string | null;
  inScope: boolean;
  source: string;
}

/** `useCatalogNodes` 返回值。 */
export interface UseCatalogNodesResult {
  nodes: Node<CatalogNodeData>[];
  edges: Edge[];
  /** 原始 catalog（右栏 PropertyPanel / 后续树组件复用同一份缓存数据）。 */
  catalog: IqdCatalogItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// ================================================================ 内部工具

/** 小写化（item_key 比较统一走它，避免大小写差异导致字段挂错模型）。 */
function lower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

/** 取 item_key 末段（`a.b.c` → `c`）。 */
function lastSegment(itemKey: string | null | undefined): string {
  const key = itemKey ?? '';
  const dot = key.lastIndexOf('.');
  return dot >= 0 ? key.slice(dot + 1) : key;
}

/**
 * 在 catalog 里找模型对应的物理表 tableKey。
 *
 * <p>两种形态都覆盖：① T02a from-table 落的 `kind=table` 行
 * （`<ds>.<schema>.<table>`，与模型 display_name 同名）；② 仅靠模型名兜底。
 */
function resolveTableKey(items: IqdCatalogItem[], model: IqdCatalogItem): string | null {
  const table = lower(model.display_name) || lower(lastSegment(model.item_key));
  if (!table) {
    return null;
  }
  const hit = items.find(
    (it) => it.kind === 'table' && lower(it.item_key).endsWith(`.${table}`),
  );
  return hit?.item_key ?? null;
}

/**
 * cube → model 归属（**启发式，T03 需替换为持久化关联**）。
 *
 * <p>T02a 落库时 cube 尚未记录 `model_ref`（`iqd_catalog_item` 无该列，§4.3 的
 * `patch.model_ref` 只在请求体里，落库进 `expression`）。这里退化为「expression /
 * display_name 里出现模型名」才挂——**宁可漏挂也不乱挂**（乱挂会误导建模者）。
 * T03 落地 cube 创建后，应改为读 `model_ref` 关联。
 */
function attachMeasures(model: IqdCatalogItem, cubes: IqdCatalogItem[]): string[] {
  const modelName = lower(model.display_name) || lower(lastSegment(model.item_key));
  if (!modelName) {
    return [];
  }
  const names: string[] = [];
  for (const cube of cubes) {
    const haystack = `${lower(cube.expression)} ${lower(cube.display_name)} ${lower(cube.item_key)}`;
    if (haystack.includes(modelName)) {
      names.push(cube.display_name ?? lastSegment(cube.item_key));
    }
  }
  return names;
}

/**
 * 从 relationship 的 join 条件解析参与的两个模型名。
 *
 * <p>形态示例：`orders.customer_id = customers.id`（`IqdMdlParser` 把 `condition` 同时写入
 * description 与 expression）。支持 `AND` 连接的复合条件。
 *
 * <p>限定名取**倒数第二段**作为表名：`orders.customer_id` → `orders`；
 * `public.orders.customer_id` → `orders`（三段+schema 前缀也正确；取首段会把 `public`
 * 当成模型名，导致永远查不到节点、边静默丢失）。解析不出（无 `=` / 无限定名）→ 返回空数组，
 * **不画边**（宁缺勿错）。
 */
export function parseJoinModels(condition: string | null | undefined): Array<[string, string]> {
  if (!condition || !condition.includes('=')) {
    return [];
  }
  const modelOf = (qualified: string): string | null => {
    const segments = qualified.trim().split('.').filter((part) => part.length > 0);
    if (segments.length < 2) {
      return null; // 无表限定（只有列名）→ 无法定位模型
    }
    return segments[segments.length - 2]?.trim() || null;
  };
  const pairs: Array<[string, string]> = [];
  for (const clause of condition.split(/\s+and\s+/i)) {
    const [left, right] = clause.split('=');
    if (!left || !right) {
      continue;
    }
    const leftModel = modelOf(left);
    const rightModel = modelOf(right);
    if (leftModel && rightModel && leftModel.toLowerCase() !== rightModel.toLowerCase()) {
      pairs.push([leftModel, rightModel]);
    }
  }
  return pairs;
}

/** 网格坐标（确定性：同一 catalog 每次得到同一布局，避免画布「跳」。T03 由 layout 数据源替换）。 */
function gridPosition(index: number): { x: number; y: number } {
  const col = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  return {
    x: GRID_ORIGIN_X + col * GRID_X_GAP,
    y: GRID_ORIGIN_Y + row * GRID_Y_GAP,
  };
}

// ================================================================ hook

/**
 * 从 catalog 缓存派生画布 nodes/edges。
 *
 * @param connectionId 当前连接 id（null → 不发请求、不派生）；**缓存与派生均按 connId 隔离**
 *                     （A-14：多连接不串扰——不同 connId 是不同 queryKey，天然分桶）。
 */
export function useCatalogNodes(connectionId: number | null): UseCatalogNodesResult {
  const query = useQuery({
    queryKey: iqdKeys.catalogs(connectionId),
    queryFn: () => listIqdCatalog(connectionId as number),
    enabled: connectionId != null,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const catalog = useMemo(() => query.data ?? [], [query.data]);

  const { nodes, edges } = useMemo(() => {
    if (catalog.length === 0) {
      return { nodes: [] as Node<CatalogNodeData>[], edges: [] as Edge[] };
    }

    const models = catalog.filter((it) => it.kind === 'model');
    const tables = catalog.filter((it) => it.kind === 'table');
    const columns = catalog.filter((it) => it.kind === 'column');
    const cubes = catalog.filter((it) => it.kind === 'cube');
    const relationships = catalog.filter((it) => it.kind === 'relationship');

    const columnsByParent = new Map<string, IqdCatalogItem[]>();
    for (const col of columns) {
      const parent = col.parent_key ?? '';
      const bucket = columnsByParent.get(parent);
      if (bucket) {
        bucket.push(col);
      } else {
        columnsByParent.set(parent, [col]);
      }
    }

    const derivedNodes: Node<CatalogNodeData>[] = [];
    const modelIndex = new Map<string, string>(); // 归一模型名 → node id

    // ---- model 节点（已建模） ----
    models.forEach((model, index) => {
      const tableKey = resolveTableKey(catalog, model);
      const modelColumns = [
        ...(tableKey ? columnsByParent.get(tableKey) ?? [] : []),
        // 计算列：T03 约定 parent_key = 模型 item_key
        ...(columnsByParent.get(model.item_key) ?? []),
      ];
      const displayName = model.display_name ?? lastSegment(model.item_key);
      const nodeId = `model:${model.item_key}`;
      derivedNodes.push({
        id: nodeId,
        type: MODEL_NODE_TYPE,
        position: gridPosition(index),
        data: {
          itemKey: model.item_key,
          kind: 'model',
          displayName,
          columns: modelColumns,
          measureNames: attachMeasures(model, cubes),
          description: model.description,
          inScope: model.in_scope === true,
          source: model.source ?? 'mdl',
        },
        style: { width: MODEL_NODE_WIDTH },
      });
      modelIndex.set(lower(displayName), nodeId);
      modelIndex.set(lower(lastSegment(model.item_key)), nodeId);
    });

    // ---- table 节点（未建模的物理表；已建模的不重复成节点） ----
    const modeledTables = new Set(
      models.map((m) => lower(m.display_name) || lower(lastSegment(m.item_key))),
    );
    tables
      .filter((t) => !modeledTables.has(lower(t.display_name) || lower(lastSegment(t.item_key))))
      .forEach((table, offset) => {
        const index = models.length + offset;
        const displayName = table.display_name ?? lastSegment(table.item_key);
        derivedNodes.push({
          id: `table:${table.item_key}`,
          type: TABLE_NODE_TYPE,
          position: gridPosition(index),
          data: {
            itemKey: table.item_key,
            kind: 'table',
            displayName,
            columns: columnsByParent.get(table.item_key) ?? [],
            measureNames: [],
            description: table.description,
            inScope: table.in_scope === true,
            source: table.source ?? 'mdl',
          },
          style: { width: MODEL_NODE_WIDTH },
        });
      });

    // ---- edge（关系：解析 join 条件里的左右模型名；解析不出不画） ----
    const derivedEdges: Edge[] = [];
    for (const rel of relationships) {
      const pairs = parseJoinModels(rel.expression ?? rel.description);
      for (const [leftName, rightName] of pairs) {
        const source = modelIndex.get(lower(leftName));
        const target = modelIndex.get(lower(rightName));
        if (!source || !target) {
          continue;
        }
        derivedEdges.push({
          id: `${rel.item_key}:${source}->${target}`,
          source,
          target,
          label: rel.display_name ?? lastSegment(rel.item_key),
          animated: false,
          // 关系边样式交默认（T02b-2 可加 cardinality 标注）
          type: 'smoothstep',
        });
      }
    }

    return { nodes: derivedNodes, edges: derivedEdges };
  }, [catalog]);

  return {
    nodes,
    edges,
    catalog,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
