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
 *   <li><b>edge</b>：`kind=relationship`（item_key `mdl:relationship:<name>`）→ 解析出
 *       参与的两个模型 + join 语义，映射到 model 节点。**两种落库形态都要认**
 *       （见 {@link parseRelationship}）：① T03 建模台新建 = `expression` 里是 JSON 信封
 *       `{join_type,cardinality,condition,source_model,target_model}`；
 *       ② MDL 同步来源 = `expression`/`description` 直接就是裸条件
 *       `orders.customer_id = customers.id`（`IqdMdlParser` 的既有形态）。
 *       条件无法解析时**不画边**（宁缺勿错，避免拉出错误的 ER 关系）。</li>
 * </ol>
 *
 * <p>所有「启发式/暂缺」都写了显式注释，便于 T02b-2 / T03 收敛。
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Edge, Node } from '@xyflow/react';
import { listIqdCatalog, type IqdCatalogItem } from '@/lib/api/iqd';
// **type-only import**：本文件被纯函数单测直接 import，必须**零 `@xyflow/react` 运行时依赖**
// （否则 node 环境单测要连带加载 @xyflow/react 的全部传递依赖）。故 ① 此处只取类型；
// ② 边类型常量与 marker 简写在本文件里用**字符串**定义（见下方常量注释）。
import type { RelationEdgeData } from '../components/modeling/RelationEdge';
import { iqdKeys } from '../queries/iqd-keys';

/** 画布节点类型（与 `ModelNodeCard` 注册的 nodeTypes key 一致）。 */
export const MODEL_NODE_TYPE = 'iqdModel';
export const TABLE_NODE_TYPE = 'iqdTable';

/**
 * 关系边类型（ReactFlow `edgeTypes` 的 key；派生边与画布注册表共用此常量）。
 *
 * <p>定义在 hooks 层而不是 `RelationEdge.tsx`：让本文件（纯派生逻辑）不被绑上组件的
 * 运行时依赖（`RelationEdge` 会 import `@xyflow/react`）。
 */
export const RELATION_EDGE_TYPE = 'iqdRelation';

/**
 * 箭头 marker 简写（ReactFlow 内建 marker：`'arrow'` / `'arrowclosed'`）。
 *
 * <p>用字符串而不是 `MarkerType.ArrowClosed` 枚举：同上，避免本文件引入
 * `@xyflow/react` 运行时依赖。边对象**必须显式声明 marker**，否则自定义边拿不到
 * marker URL（`EdgeProps.markerEnd` 恒 undefined）→ 箭头画不出来。
 */
export const RELATION_MARKER = 'arrowclosed';

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
  /** 关系边（自定义类型 `iqdRelation`，携带 join 语义供 RelationEdge / 弹窗消费）。 */
  edges: Array<Edge<RelationEdgeData>>;
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
 * <p>覆盖三种落库形态：
 * ① T02a / IqdMdlParser 标准键 {@code <ds>.<schema>.<table>}（后缀匹配）；
 * ② 历史 / 部分同步路径落的**裸表名** {@code <table>}（与 display_name 全等）；
 * ③ item_key 末段等于表名（兜底）。
 *
 * <p>旧实现只认 ①，导致源为 {@code mdl} 且表键为裸名时模型卡片「无字段」、
 * 右栏字段表为空。
 */
export function resolveTableKey(items: IqdCatalogItem[], model: IqdCatalogItem): string | null {
  const table = lower(model.display_name) || lower(lastSegment(model.item_key));
  if (!table) {
    return null;
  }
  const hit =
    items.find(
      (it) => it.kind === 'table' && lower(it.item_key).endsWith(`.${table}`),
    ) ??
    items.find((it) => it.kind === 'table' && lower(it.item_key) === table) ??
    items.find((it) => it.kind === 'table' && lower(lastSegment(it.item_key)) === table);
  return hit?.item_key ?? null;
}

/**
 * cube → model 归属。
 *
 * <p>**优先用 `model_ref`**（T03a 起后端 `iqd_catalog_item.model_ref` 由 `POST /catalog/cube`
 * 写入，并已通过 `GET /catalog` 的 VO 回传）：这是**精确键**，不再依赖名字巧合。
 *
 * <p>回退启发式（`expression` / `display_name` 里出现模型名）只服务**历史数据**
 * ——MDL 同步来源的 cube 没有 `model_ref`（V89 可空、无回填），其归属暂由
 * `expression`/`baseObject` 兜底。**宁可漏挂也不乱挂**（乱挂会误导建模者）。
 */
function attachMeasures(model: IqdCatalogItem, cubes: IqdCatalogItem[]): string[] {
  const modelName = lower(model.display_name) || lower(lastSegment(model.item_key));
  const names: string[] = [];
  for (const cube of cubes) {
    const ref = lower(cube.model_ref);
    const matched = ref
      ? ref === lower(model.item_key)
      : Boolean(modelName) &&
        `${lower(cube.expression)} ${lower(cube.display_name)} ${lower(cube.item_key)}`.includes(
          modelName,
        );
    if (matched) {
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

/**
 * 关系条目 → join 语义（**两种落库形态都认**）。
 *
 * <p>形态 ①（T03 建模台新建，权威）：`expression` 是 JSON 信封
 * `{join_type,cardinality,condition,source_model,target_model}` —— 这些字段在
 * `iqd_catalog_item` 里没有专属列，故由 T03a 的 `createRelationship` 打包进 `expression`。
 * 此时**必须优先解信封**：直接把整串 JSON 丢给 {@link parseJoinModels} 会因为
 * 左侧限定名被 JSON 前缀污染（`{"join_type":…"orders.customer_id`）而**匹配不到模型
 * → 关系边静默消失**（本项目最容易漏的一处跨批集成点）。
 *
 * <p>形态 ②（MDL 同步来源，历史）：`expression`/`description` 就是裸条件
 * `orders.customer_id = customers.id` → 走 {@link parseJoinModels}。
 */
export interface ParsedRelationship {
  /** join 类型（形态 ② 为 null，由边组件回退 `INNER`）。 */
  joinType: string | null;
  /** 基数（形态 ② 为 null，由边组件回退 `1:N`）。 */
  cardinality: string | null;
  /** 完整 join 条件（用于 hover 提示与弹窗回填）。 */
  condition: string | null;
  /** 参与模型对（`1:1` 形态下通常一对；AND 复合条件可能多对）。 */
  pairs: Array<[string, string]>;
}

/** 关系信封 JSON 的字段（与 T03a `IqdCatalogItemService.relationshipEnvelope` 逐字对应）。 */
interface RelationshipEnvelope {
  join_type?: string;
  cardinality?: string;
  condition?: string;
  source_model?: string;
  target_model?: string;
}

/** 语义键末段（`mdl:model:orders` → `orders`；`orders` → `orders`）。 */
function semanticTail(value: string | null | undefined): string {
  const key = (value ?? '').trim();
  if (key === '') {
    return '';
  }
  const colon = key.lastIndexOf(':');
  return colon >= 0 && colon < key.length - 1 ? key.slice(colon + 1) : key;
}

/** 尝试把 `expression` 解为关系信封（失败 / 非对象 → null）。 */
function parseEnvelope(raw: string | null | undefined): RelationshipEnvelope | null {
  const text = (raw ?? '').trim();
  if (!text.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as RelationshipEnvelope) : null;
  } catch {
    return null;
  }
}

/**
 * 解析一条 relationship 条目（见 {@link ParsedRelationship}）。
 *
 * @param relationship catalog 里的 `kind=relationship` 条目
 * @returns join 语义 + 参与模型对（无法解析出模型对时 `pairs` 为空 → 调用方不画边）
 */
export function parseRelationship(relationship: IqdCatalogItem): ParsedRelationship {
  const envelope = parseEnvelope(relationship.expression);
  if (envelope && typeof envelope.condition === 'string') {
    const condition = envelope.condition;
    const source = semanticTail(envelope.source_model);
    const target = semanticTail(envelope.target_model);
    // 信封里的 source/target 是权威（精确键），condition 仅兜底补充额外的 AND 对
    const pairs: Array<[string, string]> = [];
    if (source && target) {
      pairs.push([source, target]);
    } else {
      pairs.push(...parseJoinModels(condition));
    }
    return {
      joinType: envelope.join_type ?? null,
      cardinality: envelope.cardinality ?? null,
      condition,
      pairs,
    };
  }

  const condition = relationship.expression ?? relationship.description ?? null;
  return {
    joinType: null,
    cardinality: null,
    condition,
    pairs: parseJoinModels(condition),
  };
}

/** 网格坐标（确定性：同一 catalog 每次得到同一布局，避免画布「跳」；坐标持久化后由 layout 覆盖）。 */
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
      return { nodes: [] as Node<CatalogNodeData>[], edges: [] as Array<Edge<RelationEdgeData>> };
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

    /** 按物理表 key 取列；兼容 parent_key 为全限定名 / 裸表名两种落库形态。 */
    const columnsForTable = (tableKey: string | null, tableName: string): IqdCatalogItem[] => {
      if (!tableKey && !tableName) {
        return [];
      }
      const seen = new Set<string>();
      const out: IqdCatalogItem[] = [];
      const pushAll = (list: IqdCatalogItem[] | undefined) => {
        for (const col of list ?? []) {
          if (seen.has(col.item_key)) {
            continue;
          }
          seen.add(col.item_key);
          out.push(col);
        }
      };
      if (tableKey) {
        pushAll(columnsByParent.get(tableKey));
      }
      // 兜底：parent_key 末段 / 全等表名（与 resolveTableKey 对称）
      const name = lower(tableName);
      if (name) {
        for (const [parent, list] of columnsByParent) {
          if (lower(parent) === name || lower(lastSegment(parent)) === name) {
            pushAll(list);
          }
        }
      }
      return out;
    };

    const derivedNodes: Node<CatalogNodeData>[] = [];
    const modelIndex = new Map<string, string>(); // 归一模型名 → node id

    // ---- model 节点（已建模） ----
    models.forEach((model, index) => {
      const tableKey = resolveTableKey(catalog, model);
      const tableName = model.display_name ?? lastSegment(model.item_key);
      const modelColumns = [
        ...columnsForTable(tableKey, tableName),
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
            columns: columnsForTable(table.item_key, displayName),
            measureNames: [],
            description: table.description,
            inScope: table.in_scope === true,
            source: table.source ?? 'mdl',
          },
          style: { width: MODEL_NODE_WIDTH },
        });
      });

    // ---- edge（关系：解 join 语义 + 映射模型名 → 节点；解析不出不画） ----
    const derivedEdges: Array<Edge<RelationEdgeData>> = [];
    for (const rel of relationships) {
      const parsed = parseRelationship(rel);
      for (const [leftName, rightName] of parsed.pairs) {
        const source = modelIndex.get(lower(leftName));
        const target = modelIndex.get(lower(rightName));
        if (!source || !target) {
          continue;
        }
        derivedEdges.push({
          id: `${rel.item_key}:${source}->${target}`,
          source,
          target,
          type: RELATION_EDGE_TYPE,
          data: {
            relationshipKey: rel.item_key,
            joinType: parsed.joinType ?? undefined,
            cardinality: parsed.cardinality ?? undefined,
            condition: parsed.condition,
          },
          // 两个 marker 都挂上：由 RelationEdge 按 cardinality 决定画哪端
          // （自定义边拿不到未在边对象上声明的 marker —— 见 RELATION_MARKER 注释）
          markerStart: RELATION_MARKER,
          markerEnd: RELATION_MARKER,
          label: rel.display_name ?? lastSegment(rel.item_key),
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
