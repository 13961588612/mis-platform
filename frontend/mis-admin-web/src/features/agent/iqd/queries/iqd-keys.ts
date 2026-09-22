/**
 * iqd-keys.ts — 建模台 TanStack Query keys 集中管理（v1.11 / Q5）。
 *
 * <p><b>为什么集中</b>：Q5 确立「服务端状态 = TanStack Query 单一缓存源（catalog）」，
 * 画布 nodes/edges 由 catalog **selector 派生**、不持第二份真值。因此失效/派生都依赖
 * 稳定的 key 前缀（`invalidateQueries({ queryKey: iqdKeys.catalogs(connId) })`），
 * 散落在各组件里写字符串数组必然漂移（改了前缀漏改失效点 → 画布不刷新）。
 *
 * <p><b>层级约定</b>：所有 key 首段恒为 `'iqd'`（问数域命名边界，architecture.md §1.5），
 * 第二段为资源域（`catalog` / `discovery` / `modeling` / `connections`），其后为维度
 * （connId / schema / page / itemKey / expr）。这样：
 * - 失效整连接：`iqdKeys.catalogs(connId)`（前缀匹配 `['iqd','catalog',connId]`）；
 * - 失效全问数：`['iqd']`（含全部子域）。
 *
 * <p>返回值统一 `as const` —— TanStack Query v5 依赖 key 的**结构可序列化**，
 * 只读元组既能被 `queryKey` 接受，也能避免被就地改写。
 *
 * <p><b>T01 仅 key 定义，不发请求</b>。
 */

/** 建模台 query key 工厂（全量集中于此，禁止在组件内拼字符串数组）。 */
export const iqdKeys = {
  /** 根前缀：`['iqd']`（失效整个问数域时用）。 */
  root: () => ['iqd'] as const,

  // ---------------------------------------------------------------- catalog（服务端单一真值）

  /** 连接级 catalog 全量（画布/树/右栏共用同一缓存）。 */
  catalogs: (connectionId: string | number | null) => ['iqd', 'catalog', connectionId] as const,

  /** 单节点明细（右栏 PropertyPanel 深查）。 */
  catalogNode: (connectionId: string | number | null, itemKey: string) =>
    ['iqd', 'catalog', connectionId, 'node', itemKey] as const,

  /** 编辑同步状态（发布流水线 5000ms 轮询）。 */
  syncStatus: (connectionId: string | number | null) =>
    ['iqd', 'catalog', connectionId, 'sync-status'] as const,

  /** 依赖方清单（删除阻断 / 引用提示区）。 */
  dependencies: (connectionId: string | number | null, itemKey: string) =>
    ['iqd', 'dependencies', connectionId, itemKey] as const,

  // ---------------------------------------------------------------- layout（MR-S4）

  /** 连接级布局（nodes/edges/viewport）。 */
  modelLayout: (connectionId: string | number | null) =>
    ['iqd', 'modeling', 'layout', connectionId] as const,

  // ---------------------------------------------------------------- discovery（表发现，a 点）

  /** schema 列表。 */
  discoverySchemas: (connectionId: string | number | null) =>
    ['iqd', 'discovery', 'schemas', connectionId] as const,

  /** 表清单（分页 + 关键字）。 */
  discoveryTables: (
    connectionId: string | number | null,
    schema: string,
    page: number,
    keyword?: string,
  ) => ['iqd', 'discovery', 'tables', connectionId, schema, page, keyword ?? ''] as const,

  /** 列清单（列预览）。 */
  discoveryColumns: (connectionId: string | number | null, schema: string, table: string) =>
    ['iqd', 'discovery', 'columns', connectionId, schema, table] as const,

  // ---------------------------------------------------------------- connections（连接向导）

  /** 连接列表（多连接 + MCP 状态）。 */
  connections: () => ['iqd', 'connections'] as const,

  // ---------------------------------------------------------------- 校验（A-10 提交前同步校验）

  /** 表达式静态校验结果（按 expr 缓存，避免重复请求）。 */
  validateExpression: (
    connectionId: string | number | null,
    modelItemKey: string,
    expression: string,
  ) => ['iqd', 'modeling', 'validate-expression', connectionId, modelItemKey, expression] as const,
} as const;

/** 建模台 query key 工厂类型（供 T02+ 依赖注入 / mock 用）。 */
export type IqdKeys = typeof iqdKeys;
