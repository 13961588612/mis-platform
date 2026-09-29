/**
 * modeling.ts — 可视化建模台 wire 类型（v1.11 / MR-S1~S4）。
 *
 * <p><b>wire 一律 snake_case</b>：与 BFF / mis-iqd DTO / JSON 响应体对齐
 * （system-design §8.7「类型约定」：DB snake_case ↔ Java camelCase ↔ JSON wire snake_case
 * ↔ TS wire snake_case）。前端内部 camelCase 只出现在 store / 组件局部变量。
 *
 * <p>命名边界（architecture.md §1.5/§10.3）：平台问数域一律 `iqd`；对接外部 WrenAI
 * 才保留 `wren`（如 `wren_ref_id`、`mdl_hash`）。
 *
 * <p>类型来源（权威）：
 * - system-design §3.3 端点契约（入参 / 出参 schema）
 * - system-design §4.3 c 点（新建节点端点族）、§4.4 d 点（layout 存储）
 * - system-design §5 classDiagram（`IqdModelingCreateResponse` / `IqdCatalogSyncStatus` /
 *   `IqdModelLayoutDTO` / `LayoutNode` / `LayoutEdge` / `IqdDependents` / `Dependent`）
 * - V83/V85 DDL（`mcp_status` / `mcp_port` / `mcp_host` / `agent_handle`）+ V71
 *   `iqd_connection.last_health_at` / `last_health_msg`
 *
 * <p><b>T01 仅类型定义，无可执行逻辑</b>。
 */

// ================================================================ 枚举 / 字面量联合

/** 编辑态枚举（派生值，不落库；与 mis-iqd `getCatalogSyncStatus` 一致）。 */
export type IqdCatalogEditStatus =
  | 'EDITED_UNSYNCED'
  | 'SYNCING'
  | 'SYNCED'
  | 'SYNC_FAILED'
  | 'STALE_DRIFT';

/** 画布抽屉种类（modeling-store `drawer` 取值；'closed' 表示未展开）。 */
export type DrawerKind = 'closed' | 'model' | 'cube' | 'calculatedColumn';

/** 关系 join 类型（§3.3 `POST /catalog/relationship`）。 */
export type JoinType = 'inner' | 'left' | 'right' | 'full';

/** 关系基数（§3.3 / §5 `CreateRelationshipRequest`）。 */
export type Cardinality = '1:1' | '1:N' | 'N:1' | 'N:N';

/** 自动布局算法（§3.3 `POST /modeling/layout/{id}/auto-layout`）。 */
export type LayoutAlgorithm = 'dagre';

/** 自动布局方向（A-13 默认 LR，可切 TB）。 */
export type LayoutDirection = 'LR' | 'TB';

/** 表发现导入模式（§3.3 `POST /discovery/import`）。 */
export type DiscoveryImportMode = 'create_or_skip' | 'create_or_update';

/** catalog 节点种类（V71 `iqd_catalog_item.kind` + §8.6 item_key 命名）。 */
export type CatalogKind =
  | 'table'
  | 'column'
  | 'model'
  | 'relationship'
  | 'cube'
  | 'measure'
  | 'dimension'
  | 'view'
  | 'metric';

/** 依赖方种类（§5 `Dependent.kind`）。 */
export type DependentKind =
  | 'model'
  | 'column'
  | 'relationship'
  | 'cube'
  | 'measure'
  | 'dimension'
  | 'view'
  | 'sql_pair'
  | 'knowledge';

// ================================================================ 视口 / 布局

/** 画布视口（`@xyflow/react` Viewport 同形；layout JSONB 内嵌）。 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** 布局节点（§5 `LayoutNode`）：仅视图坐标，不含模型语义。 */
export interface LayoutNode {
  item_key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
}

/** 布局边（§5 `LayoutEdge`）：锚点 handle 可为空（默认锚点）。 */
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  source_handle: string | null;
  target_handle: string | null;
}

/**
 * 布局 DTO（§4.4 d 点 / `GET|PUT /api/v1/iqd/modeling/layout/{connectionId}`）。
 *
 * <p>`version` 为乐观并发基线（PUT 时回传 `base_version`）；`auto_layout_version`
 * 记录最近一次自动布局覆盖版本，供「是否已被自动布局覆盖」判断。
 */
export interface IqdModelLayoutDTO {
  connection_id: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  viewport: Viewport;
  auto_layout_version: number;
  version: number;
}

// ================================================================ 连接（含 multiconn 运行态）

/**
 * 问数连接（`GET /api/v1/iqd/connections`）。
 *
 * <p>multiconn 运行态字段（T01 只消费、不新增迁移）：`mcp_status` / `mcp_port` 见
 * V83；`mcp_host` / `agent_handle` 见 V85；`last_health_at` / `last_health_msg`
 * 为 V71 既有列。**凭证恒不回显明文**（`secret_ref` 为 opaque 引用）。
 */
export interface Connection {
  id?: number | null;
  name: string;
  base_url?: string | null;
  auth_type?: string;
  secret_ref?: string | null;
  project_id?: string | null;
  default_connector?: string | null;
  timeout_seconds?: number;
  language?: string;
  status?: string;
  last_health_at?: string | null;
  last_health_msg?: string | null;
  enabled?: boolean;
  /** 按连接灰度闸门：是否允许平台写回 MDL（二期 U7/Q4）。 */
  mdl_writeback_enabled?: boolean;
  /** multiconn：WrenAI MCP 进程状态 running/stopped/starting/crashed/unhealthy（V83）。 */
  mcp_status?: string | null;
  /** multiconn：WrenAI MCP 进程监听端口（V83）。 */
  mcp_port?: number | null;
  /** multiconn 跨机器：MCP 数据面可达 host（V85，仅引用不存凭证）。 */
  mcp_host?: string | null;
  /** multiconn 跨机器：WrenMcpAgent 部署句柄（V85）。 */
  agent_handle?: string | null;
  /** 【路线 A】业务库类型（非敏感展示）。 */
  db_type?: string | null;
  /** 【路线 A】业务库 host（非敏感展示）。 */
  db_host?: string | null;
  /** 【路线 A】业务库 port（非敏感展示）。 */
  db_port?: number | null;
  /** 【路线 A】业务库 database（非敏感展示）。 */
  db_database?: string | null;
  /** 【路线 A】业务库账号（非敏感；密码不回）。 */
  db_user?: string | null;
  /** 【路线 A】是否已托管业务库密码（编辑时据此提示是否需重填）。 */
  has_db_password?: boolean | null;
}

/** 连接创建/更新请求体（`POST /api/v1/iqd/connections`）。 */
export interface CreateConnectionRequest {
  name: string;
  base_url?: string | null;
  project_id?: string | null;
  default_connector?: string | null;
  secret_ref?: string | null;
  /**
   * 认证方式（`none` | `basic` | `token`）。
   *
   * <p>注：system-design §3.3 的请求体清单漏列了该字段，但 T02a 后端
   * `IqdModelingController.toConnectionDto` 明确读取 `auth_type`/`authType` 并写入
   * `iqd_connection.auth_type`，故此处补全（T02b-2 修复：原类型缺该字段导致向导无法提交认证方式）。
   */
  auth_type?: string | null;
  timeout_seconds?: number;
  language?: string;
  enabled?: boolean;
  /** 【路线 A】业务库坐标（非敏感；BFF 落 mis-iqd 展示列）。 */
  db_type?: string | null;
  db_host?: string | null;
  db_port?: number | null;
  db_database?: string | null;
  db_user?: string | null;
  /** 【路线 A】业务库密码：**只经 BFF 送 ai-platform vault，绝不落 mis-iqd**。 */
  db_password?: string | null;
}

/**
 * 连接**局部更新**请求体（`PUT /api/v1/iqd/connections/{id}`，system-design §14.1 / T07）。
 *
 * <p><b>局部更新语义（铁律）</b>：后端新建了 `IqdConnectionUpdateRequest`（字段**全 null 默认、
 * 无 `@NotBlank`/`@NotNull`**），控制器按 `containsKey` 填充 —— **缺省 / `null` = 保留原值**。
 * 故前端**只能提交"确实被修改"的字段**：
 * <ul>
 *   <li>提交未修改字段 = 用"当前值"覆盖"当前值"（多数情况下无害，但 `secret_ref` /
 *       `auth_type` 等敏感字段会因前后端默认值口径不同而**静默改写**）；</li>
 *   <li>更危险的是**照抄 `CreateConnectionRequest` 全量字段**：后端 create DTO 带 Java 默认值
 *       （`authType="none"` / `timeoutSeconds=60` / `language="zh-CN"` / `enabled=true`），
 *       一旦复用就会"改名即重置超时/认证方式"——这正是后端**专门新开 DTO** 的原因。</li>
 * </ul>
 * 载荷组装统一走 {@link buildUpdateRequest}（`components/wizard/connectionEditUtils.ts`），
 * **禁止在组件里手写请求体**。
 *
 * <p><b>本端点不支持"清空字段"</b>（§14.1 / §14.10 #2）：wire 上无法区分「未提交」与
 * 「显式置空」，故 uniform 采用「缺省/null = 保留原值」。前端编辑表单里"留空"即等于"保留原值"。
 *
 * <p>`mdl_writeback_enabled` **不在本期**（归 `PUT /config` / config 页，§14.10 #4）。
 */
export type UpdateConnectionRequest = Partial<CreateConnectionRequest>;

/** 连通性自检出参（`POST /api/v1/iqd/connections/{id}/test`）。 */
export interface ConnectionTestResult {
  ok: boolean;
  latency_ms?: number | null;
  version?: string | null;
  message?: string | null;
}

// ================================================================ 新建节点请求（§4.3 c 点）

/** 源表引用（from-table 路径）。 */
export interface SourceTableRef {
  schema: string;
  name: string;
}

/** `POST /api/v1/iqd/catalog/model/from-table` 入参。 */
export interface CreateModelFromTableRequest {
  connection_id: number;
  source_table: SourceTableRef;
  /**
   * 目标模型稳定键（如 `mdl:model:orders`）。
   *
   * <p>**可选**：T02a `IqdCatalogNodeService.createModelFromTable` 在缺省/空白时按
   * `mdl:model:<source_table.name>` 兜底（见 `:172-174`），故前端可省略。
   * 显式传值更利于自解释。
   */
  model_item_key?: string;
  /**
   * 乐观并发基线。
   *
   * <p>**可选**：服务端仅在**非 null** 时才比对（T02a `:215-219`，不符 → 40900 + `current_edit_revision`）。
   * 「由物理表**生成**模型」是 create 语义（不覆盖既有节点字段；同 key 已存在时服务端按
   * 幂等返回首次结果），故本入口**不传** base_revision，避免用 0/过期值换来假冲突。
   * 若调用方确有版本基线需求，传连接当前 `current_edit_revision` 即可启用该保护。
   */
  base_revision?: number;
  idempotency_key?: string;
  ref_sql?: string | null;
}

/** `POST /api/v1/iqd/catalog/model`（blank 模型）入参。 */
export interface CreateModelRequest {
  connection_id: number;
  item_key: string;
  patch: {
    display_name?: string | null;
    description?: string | null;
    primary_keys?: string[];
    is_time_dimension?: Record<string, boolean>;
    is_email?: Record<string, boolean>;
    ref_sql?: string | null;
  };
  /**
   * 乐观并发基线。
   *
   * <p>**可选**：T03a `IqdCatalogNodeService.createModel` 仅在**非 null** 时才比对
   * （不符 → 40900 + `current_edit_revision`）。调用方拿不到「连接当前编辑版本」
   * （如 `GET /catalog/sync-status` 尚未返回）时应**省略**，而不是填 0 ——
   * 填 0 在 revision ≥ 1 的连接上必然 40900；省略则退化为「不校验」。
   */
  base_revision?: number;
  idempotency_key: string;
}

/** `POST /api/v1/iqd/catalog/relationship` 入参。 */
export interface CreateRelationshipRequest {
  connection_id: number;
  item_key: string;
  kind: 'relationship';
  patch: {
    join_type: JoinType;
    cardinality: Cardinality;
    condition: string;
    source_model: string;
    target_model: string;
  };
  /** 同 {@link CreateModelRequest.base_revision}：可选，省略 = 服务端不校验。 */
  base_revision?: number;
  idempotency_key: string;
}

/** `DELETE /api/v1/iqd/catalog/relationship/{itemKey}` 返回（T03c 删除路径）。 */
export interface DeleteRelationshipResponse {
  edit_revision: number;
  edit_status: IqdCatalogEditStatus;
  deleted_item_key: string;
}

/** `DELETE /api/v1/iqd/catalog/cube/{itemKey}` 返回（T03c 删除路径）。 */
export interface DeleteCubeResponse {
  edit_revision: number;
  edit_status: IqdCatalogEditStatus;
  deleted_item_key: string;
  deleted_children: number;
}

/** Cube 度量（§5 `Measure`）。 */
export interface Measure {
  name: string;
  expression: string;
  format?: string | null;
}

/** Cube 维度（§5 `Dimension`）。 */
export interface Dimension {
  name: string;
  ref_model_field: string;
}

/** `POST /api/v1/iqd/catalog/cube` 入参。 */
export interface CreateCubeRequest {
  connection_id: number;
  item_key: string;
  kind: 'cube';
  patch: {
    display_name?: string | null;
    model_ref: string;
    measures: Measure[];
    dimensions: Dimension[];
  };
  /** 同 {@link CreateModelRequest.base_revision}：可选，省略 = 服务端不校验。 */
  base_revision?: number;
  idempotency_key: string;
}

/** `POST /api/v1/iqd/catalog/calculated-column` 入参。 */
export interface CreateCalculatedColumnRequest {
  connection_id: number;
  model_item_key: string;
  column_name: string;
  expression: string;
  base_revision: number;
  idempotency_key: string;
}

/** `POST /api/v1/iqd/catalog/calculated-column` 出参（含静态校验结果）。 */
export interface CreateCalculatedColumnResponse extends IqdModelingCreateResponse {
  item_key: string;
  validated: boolean;
  errors?: string[];
}

// ================================================================ 新建节点出参（§5）

/**
 * 新建节点统一出参（§5 `IqdModelingCreateResponse`）。
 *
 * <p>`edit_status` 为派生编辑态；`edit_revision` 为本次落库后的连接版本
 * （幂等命中时返回**首次**结果，不二次 bump）。
 */
export interface IqdModelingCreateResponse {
  edit_revision: number;
  edit_status: IqdCatalogEditStatus | string;
  wren_ref_id?: string | null;
}

/** from-table 出参（§3.3 额外携带 item_key / column_mapping）。 */
export interface IqdModelFromTableResponse extends IqdModelingCreateResponse {
  item_key: string;
  column_mapping?: Record<string, string>;
}

// ================================================================ 同步状态（§5）

/**
 * catalog 编辑同步状态（§5 `IqdCatalogSyncStatus` / `GET /catalog/sync-status`）。
 *
 * <p>相对 `@/lib/api/iqd` 同名接口的**超集**：补齐 §5 列出的 `build_error` /
 * `index_error` / `action`（selfheal 二/四期）。两处保持结构兼容，T02 起以本类型为准。
 */
export interface IqdCatalogSyncStatus {
  connection_id?: number;
  current_edit_revision?: number;
  built_edit_revision?: number;
  build_status?: string;
  index_status?: string;
  edit_status?: IqdCatalogEditStatus | string;
  mdl_hash?: string | null;
  build_error?: string | null;
  index_error?: string | null;
  stale_drift?: boolean;
  /** selfheal 二/四期：最近动作 force_rebuild | reindex | validate。 */
  action?: string | null;
}

// ================================================================ 依赖方（§5）

/** 直接引用方（§5 `Dependent`）。 */
export interface Dependent {
  item_key: string;
  kind: DependentKind | string;
}

/** 依赖方清单（§5 `IqdDependents` / `GET /api/v1/iqd/dependencies`）。 */
export interface IqdDependents {
  dependents: Dependent[];
  total: number;
}

/** 表达式静态校验出参（`GET /catalog/validate-expression`）。 */
export interface ValidateExpressionResult {
  valid: boolean;
  errors: string[];
}

// ================================================================ 表发现（§4.1 a 点）

/** schema（`GET /api/v1/iqd/discovery/schemas`）。 */
export interface DiscoverySchema {
  name: string;
}

/** 表（`GET /api/v1/iqd/discovery/tables` 元素）。 */
export interface DiscoveryTable {
  name: string;
  comment?: string | null;
  row_count_estimate?: number | null;
}

/** 列（`GET /api/v1/iqd/discovery/columns` 元素）。 */
export interface DiscoveryColumn {
  name: string;
  type: string;
  comment?: string | null;
  is_pk_inferred?: boolean;
  nullable?: boolean;
}

/** 分页表清单出参。 */
export interface DiscoveryTablePage {
  tables: DiscoveryTable[];
  total: number;
  page: number;
}

/** `POST /api/v1/iqd/discovery/import` 入参。 */
export interface ImportTablesRequest {
  connection_id: number;
  tables: SourceTableRef[];
  mode: DiscoveryImportMode;
  in_scope?: boolean;
}

/** `POST /api/v1/iqd/discovery/import` 出参。 */
export interface ImportTablesResult {
  imported: string[];
  skipped: string[];
}

// ================================================================ store 内部（非 wire）

/**
 * 编辑草稿（§5 `ItemDraft`）：draft vs server 的差量单元。
 *
 * <p>**不参与 wire 传输**（wire 用 `patch` + `base_revision` + `idempotency_key`），
 * 仅供 zustand `ModelingStore.dirtyDrafts` 做脏标记与提交载荷组装。
 */
export interface ItemDraft {
  /** 节点稳定键（§8.6 `mdl:model:orders` 等）。 */
  itemKey: string;
  /** 节点种类（`iqd_catalog_item.kind`）。 */
  kind: CatalogKind | string;
  /** 服务端基线值（打开抽屉时快照）。 */
  baseValues: Record<string, unknown>;
  /** 当前草稿值。 */
  draftValues: Record<string, unknown>;
  /** 打开抽屉时的连接版本（提交时作为 `base_revision`）。 */
  baseRevision: number;
  /** 幂等键（§8.4 模板 `{connId}:{kind}:{action}:{uuid}`）。 */
  idempotencyKey: string;
}
