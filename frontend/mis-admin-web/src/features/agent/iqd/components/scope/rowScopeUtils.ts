/**
 * rowScopeUtils.ts — 问数范围页「行级维度可视化」的**纯函数层**（v1.11 MR-12；T04c）。
 *
 * <h2>为什么单独成纯函数层（沿用 `propertyEditUtils` / `driftUtils` / `cubeUtils` 做法）</h2>
 * 本批规则一旦写错，失效方式全是**静默**的：
 * <ul>
 *   <li>{@link parseRowScope}：把 `{"dimension","scope"}` 单维度对象与
 *       `{"dimensions":[…]}` 多维度数组任一形态漏解析 → 徽标「消失」，
 *       看着像「该表没配行级范围」，实为解析遗漏（静默漏判）；</li>
 *   <li>{@link buildPredicatePreview} / {@link combinePredicatesAnd}：谓词形态口径错
 *       （`PATH_PREFIX`/`ENUM`）→ 预览与 Worker 实际注入不一致，用户以为配对了；</li>
 *   <li>{@link alignDimensionToCatalogField}：维度注册表用 `column_name`（**列名**）而非
 *       `item_key`，若按「键」对齐则**永远匹配不到**（维度注册表与 catalog 键空间不同）。</li>
 * </ul>
 * 本文件**零运行时依赖**（只 `import type`），可在 node 环境直接单测。
 *
 * <h2>⚠️ 接口事实（T04b 已核实，直接复用）</h2>
 * <ul>
 *   <li>维度注册表 {@link IqdScopeDimension}：`dimension_code` / `column_name` /
 *       `header_name` / `predicate_type`（`PATH_PREFIX` | `ENUM`）/ `param_whitelist` /
 *       `dict_table` / `auto_mode` / `enabled` / `sort`；</li>
 *   <li>`row_scope` 语义 = 维度注册表实例（单维度对象 **或** `dimensions` 数组 AND 叠加）；
 *       `NULL` = 全行可见（向后兼容）；</li>
 *   <li>谓词形态由维度注册表 `predicate_type` 决定（dept = `PATH_PREFIX`，store = `ENUM`）。</li>
 * </ul>
 *
 * <h2>⚠️ 数据可得性（诚实标注，勿过度承诺）</h2>
 * <ul>
 *   <li>后端**无**专用「模拟角色 WHERE 片段」预览端点（`simulate_role_code` 仅随
 *       `POST /iqd/ask` 携带）→ {@link buildSimulatedWherePreview} 返回**降级**片段
 *       （前端按 `row_scope` 模板 + 维度注册表推导），见 {@link SimulatedWherePreview.degraded}
 *       与 `TODO(mr12-simulated-where-endpoint)`；</li>
 *   <li>`row_scope` 存的是**模板**（维度 + 范围语义），真实锚点 `path` / 可见集合由 BFF
 *       在问数时按角色展开 → 无实参时用占位符 {@link ANCHOR_PLACEHOLDER} /
 *       {@link VALUES_PLACEHOLDER} 呈现，并标注「示意」。</li>
 * </ul>
 */
import type { IqdCatalogItem, IqdScopeDimension } from '@/lib/api/iqd';

// ================================================================ 权限码（勿漂移）

/**
 * 范围页维度相关权限码（**与后端 sys_api 逐条对齐**，写错 = 「前端放行、后端 40300」，且静默）。
 *
 * <p>来源：`V73__iqd_w2_menu_api_seed.sql`（sys_api 绑定 → sys_menu.permission）：
 * <ul>
 *   <li>`iqd:dimension:view`：`GET /api/v1/iqd/dimensions`（api 92571 → menu 92517）；</li>
 *   <li>`iqd:dimension:save`：`POST` / `DELETE /api/v1/iqd/dimensions[/{id}]`（92572/92573 → 92518）；</li>
 *   <li>`iqd:scope:sync`：`POST /api/v1/iqd/scope/sync/{dimensionCode}`（92574 → 92519）；</li>
 *   <li>`iqd:scope:view`：`GET /api/v1/iqd/scope/policies` + `GET /api/v1/iqd/scope/dict-sync-status`
 *       （92563/92575 → 92511）。</li>
 * </ul>
 */
export const SCOPE_PERMISSIONS = {
  dimensionView: 'iqd:dimension:view',
  dimensionSave: 'iqd:dimension:save',
  scopeSync: 'iqd:scope:sync',
  scopeView: 'iqd:scope:view',
} as const;

// ================================================================ 维度的解析

/**
 * 单条 `row_scope` 维度实例（已归一）。
 *
 * <p>`path` / `values` 是**可选示意实参**：模板一般不落库，若 `row_scope` JSON 恰好带了
 * （或用户在前端填了示意值）则用于生成更直观的预览；缺省走占位符。
 */
export interface RowScopeInstance {
  /** 维度码（引用 `iqd_row_scope_dimension.dimension_code`，如 `dept` / `store`）。 */
  dimension: string;
  /** 覆盖列名（对象级条件列；未写时回落维度全局 column_name）。*/
  column?: string | null;
  /** 范围语义（`dept` | `dept_subtree` | `org` | `self` | `store` | `store_subtree` …）。 */
  scope: string;
  /** 锚点 path（`PATH_PREFIX` 预览用；缺省 `null`）。 */
  path: string | null;
  /** 可见值集合（`ENUM` 预览用；缺省 `null`）。 */
  values: string[] | null;
}

/** `row_scope` 解析结果。 */
export interface RowScopeParse {
  /** 维度实例（保原序）。 */
  instances: RowScopeInstance[];
  /** 解析错误（非法 JSON / 结构无法识别；成功为 `null`）。 */
  error: string | null;
  /** 是否「未配置维度」（`null` / 空串 / 空对象 / 空数组 → `true`，即全行可见）。 */
  empty: boolean;
  /** 原始文本（去首尾空白）。 */
  raw: string;
}

function isInstance(value: RowScopeInstance | null): value is RowScopeInstance {
  return value !== null;
}

/** `unknown` → 去空白字符串（`null`/`undefined` → `''`）。 */
function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

/** `unknown` → 字符串或 `null`（空 → `null`）。 */
function toTextOrNull(value: unknown): string | null {
  const text = toText(value);
  return text === '' ? null : text;
}

/** `unknown` → 非空字符串数组（非数组 / 全空 → `null`）。 */
function toTextArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const list = value.map((item) => toText(item)).filter((item) => item !== '');
  return list.length > 0 ? list : null;
}

/** 把一个对象映射成维度实例（`dimension` 别名兼容 `dimension_code` / `code`）。 */
function toInstance(value: unknown): RowScopeInstance | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const dimension = toText(record.dimension ?? record.dimension_code ?? record.code);
  if (dimension === '') {
    return null;
  }
  const column = toText(record.column);
  return {
    dimension,
    // 仅在有对象级覆盖列时写入，避免污染既有解析结构（缺失 = 回落维度全局列）
    ...(column !== '' ? { column } : {}),
    scope: toText(record.scope ?? record.semantic),
    // 兼容 `path` / `anchor_path` / `anchorPath`；`values` / `store_ids` / `ids`
    path: toTextOrNull(record.path ?? record.anchor_path ?? record.anchorPath),
    values: toTextArray(record.values ?? record.store_ids ?? record.ids),
  };
}

/** 归一 `row_scope` 解析出的 JSON 为实例数组；`ok=false` 表示结构无法识别。 */
function normalizeToInstances(parsed: unknown): { instances: RowScopeInstance[]; ok: boolean } {
  if (Array.isArray(parsed)) {
    return { instances: parsed.map(toInstance).filter(isInstance), ok: true };
  }
  if (parsed !== null && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.dimensions)) {
      return { instances: record.dimensions.map(toInstance).filter(isInstance), ok: true };
    }
    if (Object.keys(record).length === 0) {
      // `{}` = 未配置维度（全行可见）
      return { instances: [], ok: true };
    }
    const single = toInstance(record);
    if (single !== null) {
      return { instances: [single], ok: true };
    }
    return { instances: [], ok: false };
  }
  return { instances: [], ok: false };
}

/**
 * 解析 `iqd_table_acl.row_scope`（JSONB 字符串）。
 *
 * <p>兼容两种形态：单维度对象（`{"dimension":"dept","scope":"dept_subtree"}`）与
 * 多维度数组（`{"dimensions":[…]}`，AND 叠加）；亦接受裸数组。
 *
 * @param rowScope ACL 的 `row_scope` 原串（`null` / `undefined` / 空串 = 全行可见）
 */
export function parseRowScope(rowScope: string | null | undefined): RowScopeParse {
  const raw = (rowScope ?? '').trim();
  if (raw === '') {
    return { instances: [], error: null, empty: true, raw };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { instances: [], error: 'row_scope 不是合法 JSON', empty: false, raw };
  }
  const { instances, ok } = normalizeToInstances(parsed);
  if (!ok) {
    return {
      instances: [],
      error: 'row_scope 结构无法识别（应为单维度对象或 {dimensions:[…]} 数组）',
      empty: false,
      raw,
    };
  }
  return { instances, error: null, empty: instances.length === 0, raw };
}

// ================================================================ 维度徽标

/** 徽标色调（组件映射到主题变量，**不硬编码颜色**）。 */
export type DimensionTone = 'primary' | 'accent' | 'muted';

/** 维度徽标视图模型。 */
export interface DimensionBadge {
  /** 维度码（`dimension_code`）。 */
  code: string;
  /** 徽标文案（已知维度的中文名；未知维度回退原码）。 */
  label: string;
  /** 色调。 */
  tone: DimensionTone;
}

/**
 * 已内置维度元数据（一期 dept + store 双维度）。
 *
 * <p>**逐字镜像** `V71__iqd_schema.sql` 种子（`dept` / `store`）；不 import 后端代码，
 * 以常量镜像维护（如需单一来源应下沉到共享模块）。
 */
const KNOWN_DIMENSIONS: Record<string, { label: string; tone: DimensionTone }> = {
  dept: { label: '部门', tone: 'primary' },
  store: { label: '门店', tone: 'accent' },
};

/** 维度码 → 徽标（已知维度给中文名 + 色调；未知维度回退原码 + `muted`）。 */
export function dimensionBadge(code: string): DimensionBadge {
  const key = (code ?? '').trim();
  const known = KNOWN_DIMENSIONS[key];
  if (known !== undefined) {
    return { code: key, label: known.label, tone: known.tone };
  }
  return { code: key, label: key === '' ? '未知维度' : key, tone: 'muted' };
}

/** 一张表的行级维度汇总（授权矩阵单元格直接渲染）。 */
export interface RowScopeSummary {
  /** 去重后的维度徽标（保首现序）。 */
  badges: DimensionBadge[];
  /** 是否配了行级维度（`false` = 全行可见）。 */
  hasRowScope: boolean;
  /** 维度实例条数（含同码重复，用于「+N」叠加计数）。 */
  count: number;
  /** 解析错误（非法 JSON 等；成功为 `null`）。 */
  parseError: string | null;
}

/**
 * 汇总一张表（一条 ACL）的行级维度 → 徽标列表。
 *
 * <p>同一维度码只出一枚徽标（去重），但 `count` 保留实例总数，便于展示「多维度 AND 叠加」。
 */
export function summarizeRowScope(rowScope: string | null | undefined): RowScopeSummary {
  const parsed = parseRowScope(rowScope);
  const seen = new Set<string>();
  const badges: DimensionBadge[] = [];
  for (const instance of parsed.instances) {
    const badge = dimensionBadge(instance.dimension);
    if (!seen.has(badge.code)) {
      seen.add(badge.code);
      badges.push(badge);
    }
  }
  return {
    badges,
    hasRowScope: parsed.instances.length > 0,
    count: parsed.instances.length,
    parseError: parsed.error,
  };
}

// ================================================================ 谓词预览

/** 谓词占位符（无实参时的示意值）。 */
export const ANCHOR_PLACEHOLDER = '<锚点path>';
export const VALUES_PLACEHOLDER = '<可见集合>';

/** 单维度注入谓词预览。 */
export interface PredicatePreview {
  /** 维度码。 */
  dimension: string;
  /** 徽标文案。 */
  label: string;
  /** 谓词形态：`PATH_PREFIX` | `ENUM` | `FAIL_CLOSED` | `UNKNOWN`。 */
  predicateType: string;
  /** 作用条件列（业务表列）。 */
  column: string;
  /** SQL 谓词片段。 */
  text: string;
  /** 附加说明（占位符 / 缺注册表 / 不可识别等；无则 `''`）。 */
  note: string;
}

/**
 * 由条件列推导「路径列」——`PATH_PREFIX` 作用于物化 `dept_path` 而非条件列 `dept_id`。
 *
 * <p>约定：`<base>_id` → `<base>_path`（`dept_id` → `dept_path`）；否则 `<col>_path`。
 * 与 architecture §4.2.2 D（物化 `dept_path`，PATH_PREFIX 主路径）一致。
 */
export function pathColumnOf(columnName: string): string {
  const column = (columnName ?? '').trim();
  if (column === '') {
    return '';
  }
  if (column.endsWith('_id')) {
    return `${column.slice(0, -'_id'.length)}_path`;
  }
  return `${column}_path`;
}

/**
 * 归一锚点 path 为「核心」形态（**去尾斜杠**，缺省用占位符）。
 *
 * <p>与 architecture §4.2.2 的谓词形态一致：等值部分 `col = '<core>/'`、前缀部分
 * `col LIKE '<core>/%'`（二者都带 `/`，避免出现 `/0/1/A//%` 这类双斜杠）。
 * `dept_path` 形如 `/0/1/A/`（首尾 `/`）→ 核心 `/0/1/A`。
 */
function anchorCore(path: string | null): string {
  if (path === null) {
    return ANCHOR_PLACEHOLDER;
  }
  const trimmed = path.trim();
  if (trimmed === '') {
    return ANCHOR_PLACEHOLDER;
  }
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailing = withLeading.replace(/\/+$/, '');
  return withoutTrailing === '' ? '/' : withoutTrailing;
}

/**
 * 构造单维度注入谓词预览（形态由维度注册表 `predicate_type` 决定）。
 *
 * <ul>
 *   <li>`PATH_PREFIX` → `dept_path = '<锚点path>/' OR dept_path LIKE '<锚点path>/%'`
 *       （锚点 path 由 BFF 随 `X-Mis-Dept-Scope` 头携带；无实参用占位符）；</li>
 *   <li>`ENUM` → `store_id IN ('S001', 'S002')`（无实参用 `store_id IN (<可见集合>)`）；</li>
 *   <li>`FAIL_CLOSED` → `1 = 0`（兜底，拒绝而非放行）；</li>
 *   <li>缺注册表记录 → 无法确定形态，`text=''` 并在 `note` 标注。</li>
 * </ul>
 *
 * @param instance  `row_scope` 维度实例
 * @param dimension 维度注册表记录（`null` = 未加载 / 未注册）
 */
export function buildPredicatePreview(
  instance: RowScopeInstance,
  dimension: IqdScopeDimension | null,
): PredicatePreview {
  const code = (instance.dimension ?? '').trim();
  const badge = dimensionBadge(code);
  const predicateType = (dimension?.predicate_type ?? '').trim().toUpperCase();
  const column = (dimension?.column_name ?? '').trim();

  if (predicateType === 'PATH_PREFIX') {
    const pathColumn = pathColumnOf(column || code);
    const hasAnchor = instance.path !== null && instance.path.trim() !== '';
    const core = anchorCore(instance.path);
    return {
      dimension: code,
      label: badge.label,
      predicateType,
      column: pathColumn,
      text: `${pathColumn} = '${core}/' OR ${pathColumn} LIKE '${core}/%'`,
      note: hasAnchor ? '' : '锚点 path 由 BFF 按角色展开，此处为示意占位',
    };
  }

  if (predicateType === 'ENUM') {
    const targetColumn = column || code;
    const values = instance.values !== null ? instance.values : null;
    const text =
      values !== null
        ? `${targetColumn} IN (${values.map((value) => `'${value}'`).join(', ')})`
        : `${targetColumn} IN (${VALUES_PLACEHOLDER})`;
    return {
      dimension: code,
      label: badge.label,
      predicateType,
      column: targetColumn,
      text,
      note: values !== null ? '' : '可见集合由 BFF 按角色展开，此处为示意占位',
    };
  }

  if (predicateType === 'FAIL_CLOSED') {
    return {
      dimension: code,
      label: badge.label,
      predicateType,
      column: column || code,
      text: `1 = 0  -- FAIL_CLOSED（维度集合不可得/超阈值，拒绝而非放行）`,
      note: '覆盖性校验失败时的兜底形态',
    };
  }

  return {
    dimension: code,
    label: badge.label,
    predicateType: predicateType === '' ? 'UNKNOWN' : predicateType,
    column: column || code,
    text: '',
    note: `维度「${code}」未在维度注册表找到（predicate_type / column_name 缺失），无法生成谓词预览`,
  };
}

/**
 * 多维度谓词按 `AND` 叠加拼接（v1.9：一表可多维度，逐维度追加 AND）。
 *
 * <p>每个子谓词**整体加括号**（`PATH_PREFIX` 含 `OR`，不加括号会破坏运算优先级）。
 */
export function combinePredicatesAnd(previews: PredicatePreview[]): string {
  const parts = previews.map((preview) => preview.text).filter((text) => text.trim() !== '');
  if (parts.length === 0) {
    return '';
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return parts.map((text) => `(${text})`).join(' AND ');
}

/**
 * 「模拟角色 WHERE 片段」前端示意拼接（**已被后端真端点取代**，保留仅为兼容/单测）。
 *
 * <p>⚠️ 2026-09-28 起，范围页改走后端
 * `POST /api/v1/iqd/scope/preview`（`ScopeResolver.preview_row_scope`）：谓词真实形态由
 * 引擎 `_build_authorized_predicate` 决定（PATH_PREFIX → 字典表 EXISTS；ENUM → IN），
 * 与注入逐字一致。本函数仅按模板拼形态，**与真实注入不一定一致**，
 * 新代码不应再接入；已标 `@deprecated`。
 *
 * @deprecated 改用 {@link previewIqdRowScope}（`@/lib/api/iqd`）调后端真端点。
 */
export interface SimulatedWherePreview {
  /** AND 拼接后的 WHERE 片段（无维度 → `''`）。 */
  text: string;
  /** 是否降级（当前恒 `true`）。 */
  degraded: boolean;
  /** 降级说明。 */
  note: string;
}

export function buildSimulatedWherePreview(previews: PredicatePreview[]): SimulatedWherePreview {
  const text = combinePredicatesAnd(previews);
  return {
    text,
    degraded: true,
    note:
      '已废弃：请改用后端真端点 POST /iqd/scope/preview（与注入同源）。' +
      '此处仅按 row_scope 模板拼示意形态，与真实注入不一定一致。',
  };
}

// ================================================================ catalog 对齐（列名，非键）

/** 取 catalog 项的**列名末段**（`pg.public.orders.dept_id` → `dept_id`）。 */
export function catalogColumnName(item: { item_key: string }): string {
  const key = (item.item_key ?? '').trim();
  if (key === '') {
    return '';
  }
  const dot = key.lastIndexOf('.');
  return dot >= 0 ? key.slice(dot + 1) : key;
}

/**
 * 按**列名**把维度注册表 `column_name` 对齐到 catalog 字段（`kind='column'`）。
 *
 * <p>⚠️ 维度注册表用 `column_name`（如 `dept_id`），与 catalog 的 `item_key`
 * （如 `pg.public.orders.dept_id`）**不是同一键空间** —— 必须按列名（末段）做**名字对齐**，
 * 不能按键对齐（按键对齐恒为空）。
 *
 * @param columnName 维度注册表 `column_name`
 * @param catalog    catalog 全量（`useCatalogNodes().catalog`）
 * @returns 命中的 `kind='column'` catalog 项；无则 `null`
 */
export function alignDimensionToCatalogField(
  columnName: string,
  catalog: IqdCatalogItem[],
): IqdCatalogItem | null {
  const target = (columnName ?? '').trim().toLowerCase();
  if (target === '') {
    return null;
  }
  return (
    catalog.find(
      (item) => item.kind === 'column' && catalogColumnName(item).toLowerCase() === target,
    ) ?? null
  );
}

// ================================================================ 错误码分流（读 data，不读 message）

/**
 * 从任意异常里抽取业务码 / 明细 / 消息。
 *
 * <p>后端业务错误走 HTTP 200 + `body.code`（BFF 保留 `code` + `data`）；axios 网络错误则带
 * `error.response.data`。二者均能从 `response.data` 取到 `code` / `data`，**不要只读 `message`**。
 */
export function readApiError(err: unknown): {
  code: number | null;
  data: Record<string, unknown> | null;
  message: string;
} {
  if (err !== null && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: unknown } }).response;
    const body = response?.data;
    if (body !== null && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const rawData = record.data;
      return {
        code: typeof record.code === 'number' ? record.code : null,
        data: rawData !== null && typeof rawData === 'object' ? (rawData as Record<string, unknown>) : null,
        message: typeof record.message === 'string' ? record.message : '请求失败',
      };
    }
  }
  return { code: null, data: null, message: err instanceof Error ? err.message : '请求失败' };
}

/** 业务码 → 人话（逐个读 `data` 明细；纯函数便于单测）。 */
export function describeScopeError(
  code: number | null,
  data: Record<string, unknown> | null,
  message: string,
): string {
  if (code === 40300) {
    return '[40300] 无权限（需 iqd:scope:view / iqd:dimension:view），请联系管理员';
  }
  if (code === 40400) {
    return '[40400] 目标不存在（连接 / 维度 / ACL 已被删除）';
  }
  if (code === 42200) {
    const field = typeof data?.field === 'string' ? data.field : null;
    return `[42200] 参数校验未通过${field ? `（${field}）` : ''}：${message}`;
  }
  if (code === 45204) {
    return '[45204] 维度字典不可得（fail-closed）：同步任务未完成或字典表缺失';
  }
  if (code === 50000) {
    return `[50000] 系统错误：${message}`;
  }
  return code !== null ? `[${code}] ${message}` : message;
}


// ================================================================ row_scope 构造（对象级列覆盖）

/**
 * 把一个对象的维度实例构造回 `row_scope` JSON 字符串。
 *
 * <p>每个维度实例可带对象级覆盖列 `column`；未写（空）则回落维度全局 `column_name`
 * （后端语义）。全部为空 → 返回 `null`（表示全行可见）。
 *
 * @param instances 维度实例（含可选 `column`）
 * @returns 紧凑 JSON（`{"dimensions":[...]}`）；无有效维度 → `null`
 */
export function buildRowScope(
  instances: Array<{ dimension: string; column?: string | null; scope?: string | null }>,
): string | null {
  const dims = (instances ?? [])
    .map((inst) => {
      const dimension = (inst.dimension ?? '').trim();
      if (dimension === '') {
        return null;
      }
      const out: Record<string, string> = { dimension };
      const column = (inst.column ?? '').trim();
      if (column !== '') {
        out.column = column;
      }
      const scope = (inst.scope ?? '').trim();
      if (scope !== '') {
        out.scope = scope;
      }
      return out;
    })
    .filter((x): x is Record<string, string> => x !== null);
  if (dims.length === 0) {
    return null;
  }
  return JSON.stringify({ dimensions: dims });
}
