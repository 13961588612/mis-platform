/**
 * cubeUtils.ts — Cube 相关的**纯函数**（v1.11 MR-06；T03c）。
 *
 * <h2>为什么单独成纯函数层（沿用 T03b `relationUtils` 的做法）</h2>
 * 这些规则的失效方式都是**静默**的：
 * <ul>
 *   <li>{@link buildCubeItemKey}：改名即换 item_key → 幂等去重、引用扫描、`model_ref` 挂靠全部换锚点；</li>
 *   <li>{@link parseCubeChildren}：T03a 把 measures/dimensions 落成**子节点**（`kind=measure`
 *       / `kind=dimension`，`parent_key=<cube item_key>`），回读错就会「打开编辑器看到空的度量」；</li>
 *   <li>{@link describeCubeError}：只读 `message` 会把「哪个字段不存在」丢掉；</li>
 *   <li>{@link validateCubeDraft}：本地预检漏判会让用户提交后才被服务端 42201 打回。</li>
 * </ul>
 * 本文件**零运行时依赖**（只 `import type`），可在 node 环境直接单测 —— 若放进
 * `CubeEditor.tsx`，测试就得连带加载 radix Dialog / CodeMirror 一整套 DOM 依赖。
 *
 * <h2>与后端的分工（不要越权）</h2>
 * {@link validateCubeDraft} 是**提交前本地预检**；字段存在性的权威判定在后端
 * （`POST /catalog/cube` → 42201 + `data.errors`；42200 + `data.field`/`data.model_item_key`）。
 * 前端预检只拦「明显不合法」，不做语法/类型校验（那是 WrenAI build 的事）。
 */
import type { IqdCatalogItem } from '@/lib/api/iqd';
import type { Dimension, Measure } from '../../types/modeling';

/** §8.6 cube 稳定键前缀（与 T03a `IqdCatalogNodeService.CUBE_ITEM_PREFIX` 逐字一致）。 */
export const CUBE_ITEM_PREFIX = 'mdl:cube:';

/** 模型稳定键前缀（`patch.model_ref` 的取值形态）。 */
export const MODEL_ITEM_PREFIX = 'mdl:model:';

/** 度量 / 维度子节点键前缀（与 T03a 的 `MEASURE_ITEM_PREFIX` / `DIMENSION_ITEM_PREFIX` 一致）。 */
export const MEASURE_ITEM_PREFIX = 'mdl:measure:';
export const DIMENSION_ITEM_PREFIX = 'mdl:dimension:';

// ================================================================ item_key

/**
 * 取 item_key 的「名字段」。
 *
 * <p><b>规则：点号在冒号之后就用点号，否则用冒号。</b> 三种键形态都要对：
 * <ul>
 *   <li>`mdl:cube:revenue`（无点）→ `revenue`（**冒号**）</li>
 *   <li>`mdl:measure:revenue.total` / `mdl:dimension:revenue.store_id` → `total` / `store_id`（**点号**）</li>
 *   <li>`pg_main.public.orders.amount`（无冒号）→ `amount`（**点号**）</li>
 * </ul>
 * 只用冒号（T03b `nodeName` 的写法）会把子节点的名字取成 `revenue.total` ——
 * 这正是 T03c 单测抓出来的 bug：`parseCubeChildren` 回读时度量名会变成
 * `revenue.total`，用户在编辑器里看到的是「cube 名 + 点 + 度量名」而不是度量名。
 */
export function keyTail(itemKey: string | null | undefined): string {
  const key = (itemKey ?? '').trim();
  if (key === '') {
    return '';
  }
  const colon = key.lastIndexOf(':');
  const dot = key.lastIndexOf('.');
  if (dot > colon) {
    return key.slice(dot + 1);
  }
  if (colon >= 0 && colon < key.length - 1) {
    return key.slice(colon + 1);
  }
  return key;
}

/**
 * 把展示名压成可用的键段（只保留 `[a-z0-9_]`）。
 *
 * <p>与 `relationUtils.buildRelationshipName` 同一规则：item_key 是**跨端稳定契约**
 * （T03a 的 `item_key` 校验、`expression` 信封、`validateCatalogRefs` 的子串匹配都吃它），
 * 含空格/中文/大写会一路偏。
 */
export function keySegment(displayName: string | null | undefined): string {
  return (displayName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** 展示名 → Cube 稳定键（`revenue` → `mdl:cube:revenue`；空名回退 `cube`）。 */
export function buildCubeItemKey(displayName: string | null | undefined): string {
  return `${CUBE_ITEM_PREFIX}${keySegment(displayName) || 'cube'}`;
}

/** Cube 稳定键 → 名字段（用于子节点键拼装）；非 cube 键原样取末段。 */
export function cubeNameOf(itemKey: string | null | undefined): string {
  return keyTail(itemKey);
}

/** 度量子节点键（与 T03a `mdl:measure:<cube>.<name>` 一致）。 */
export function measureItemKey(cubeName: string, measureName: string): string {
  return `${MEASURE_ITEM_PREFIX}${cubeName}.${measureName}`;
}

/** 维度子节点键（与 T03a `mdl:dimension:<cube>.<name>` 一致）。 */
export function dimensionItemKey(cubeName: string, dimensionName: string): string {
  return `${DIMENSION_ITEM_PREFIX}${cubeName}.${dimensionName}`;
}

/** 归一模型引用：`orders` / `mdl:model:orders` → `mdl:model:orders`；空 → `''`。 */
export function normalizeModelRef(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (v === '') {
    return '';
  }
  return v.startsWith(MODEL_ITEM_PREFIX) ? v : `${MODEL_ITEM_PREFIX}${keySegment(v) || v}`;
}

/**
 * 推断 cube 的挂靠模型（**只服务历史数据**）。
 *
 * <p>优先 `model_ref`（T03a 起由 `createCube` 写入 V89 列）；历史 MDL 同步来源的 cube
 * 没有该列（V89 可空、无回填），其 model 名残留在 `expression`（`IqdMdlParser` 把
 * `baseObject` 兜底写进了 expression —— 见 T03a 报告事实 2）。
 * 两处都取不到 → 返回 `''`，由用户在弹窗里显式选择（**不猜**：猜错会把 cube 挂到别的模型上）。
 */
export function inferModelRef(
  cube: Pick<IqdCatalogItem, 'model_ref' | 'expression'> | null,
  modelItemKeys: string[],
): string {
  if (!cube) {
    return '';
  }
  const explicit = normalizeModelRef(cube.model_ref ?? '');
  if (explicit !== '') {
    return explicit;
  }
  const expression = (cube.expression ?? '').trim().toLowerCase();
  if (expression === '') {
    return '';
  }
  // expression 可能是「模型名」或含模型名的定义文本：只在**精确命中**已知模型时才采用
  for (const itemKey of modelItemKeys) {
    const name = keyTail(itemKey).toLowerCase();
    if (name !== '' && (expression === name || expression === itemKey.toLowerCase())) {
      return itemKey;
    }
  }
  return '';
}

// ================================================================ 子节点回读

/** 度量行（UI 态：多一个 `rowId` 供 React key 稳定 —— 用 name 当 key 会在改名时重挂编辑器）。 */
export interface MeasureRow {
  rowId: string;
  name: string;
  expression: string;
  format: string;
}

/** 维度行（UI 态）。 */
export interface DimensionRow {
  rowId: string;
  name: string;
  refModelField: string;
}

/** 生成行 id（与 `useDirtyState` 的 uuid 兜底同策略；此处自带以保持本文件零依赖）。 */
export function newRowId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 空度量行。 */
export function emptyMeasureRow(): MeasureRow {
  return { rowId: newRowId(), name: '', expression: '', format: '' };
}

/** 空维度行。 */
export function emptyDimensionRow(): DimensionRow {
  return { rowId: newRowId(), name: '', refModelField: '' };
}

/** wire 度量 → 行（`format` 空值归一为 `''`，便于受控 Input）。 */
export function toMeasureRows(measures: Measure[]): MeasureRow[] {
  return measures.map((measure) => ({
    rowId: newRowId(),
    name: measure.name,
    expression: measure.expression,
    format: measure.format ?? '',
  }));
}

/** wire 维度 → 行。 */
export function toDimensionRows(dimensions: Dimension[]): DimensionRow[] {
  return dimensions.map((dimension) => ({
    rowId: newRowId(),
    name: dimension.name,
    refModelField: dimension.ref_model_field,
  }));
}

/** 行 → wire 度量（**剥掉 `rowId`**；`format` 空串送 `null`）。 */
export function toMeasures(rows: MeasureRow[]): Measure[] {
  return rows.map((row) => {
    const format = row.format.trim();
    return {
      name: row.name.trim(),
      expression: row.expression.trim(),
      ...(format === '' ? {} : { format }),
    };
  });
}

/** 行 → wire 维度。 */
export function toDimensions(rows: DimensionRow[]): Dimension[] {
  return rows.map((row) => ({
    name: row.name.trim(),
    ref_model_field: row.refModelField.trim(),
  }));
}

/**
 * Cube 草稿 → 提交 patch（T04b；新建 `POST` 与更新 `PUT` 共用）。
 *
 * <h2>⚠️ 为什么必须抽成函数（而不是在提交处内联手写）</h2>
 * `PUT /catalog/cube` 是**全量替换**语义：服务端按 `item_key` 与传入集合求差，
 * **本次未出现的既有子节点会被物理删除**（孤儿清理）。因此提交 patch **永远**要带上
 * 完整的 `measures` / `dimensions` 列表 —— 一旦某人「优化」成「只传变更项」或在某条路径上
 * 漏传，就会**静默清空**用户的度量/维度（且服务端返回成功）。抽成唯一的
 * {@link buildCubePatch} 把这条约束收敛到一个可单测的点。
 *
 * <p>`measures` / `dimensions` 为**空数组**时也会显式传出（= 目标态为空，符合 PUT 语义），
 * 而不是省略字段 —— 省略同样会清空，且更难排查。
 *
 * @param draft Cube 草稿（含 UI 态行）
 * @returns wire patch（`{display_name, model_ref, measures[], dimensions[]}`；三键恒存在）
 */
export function buildCubePatch(draft: CubeDraftValues): {
  display_name: string;
  model_ref: string;
  measures: Measure[];
  dimensions: Dimension[];
} {
  return {
    display_name: draft.displayName.trim(),
    // ★ 挂靠真值：传**全键**（后端也会归一，但全键最不容易出歧义）
    model_ref: draft.modelRef,
    // ★ 全量替换：始终带完整列表（空也带），防孤儿清理误删（见函数头）
    measures: toMeasures(draft.measures),
    dimensions: toDimensions(draft.dimensions),
  };
}

/**
 * 从 catalog 回读 cube 的 measures / dimensions（T03a 落库形态：**子节点**）。
 *
 * <p>测度取 `expression` + `data_type`(format)；维度取 `expression`(ref_model_field)。
 * 子节点按名字排序，保证「打开编辑器两次看到同样的顺序」（否则每次 render 顺序抖动）。
 */
export function parseCubeChildren(
  catalog: IqdCatalogItem[],
  cubeItemKey: string,
): { measures: Measure[]; dimensions: Dimension[] } {
  const children = catalog.filter((item) => item.parent_key === cubeItemKey);
  const measures: Measure[] = children
    .filter((item) => item.kind === 'measure')
    .map((item) => ({
      name: item.display_name ?? keyTail(item.item_key),
      expression: item.expression ?? '',
      ...(item.data_type ? { format: item.data_type } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const dimensions: Dimension[] = children
    .filter((item) => item.kind === 'dimension')
    .map((item) => ({
      name: item.display_name ?? keyTail(item.item_key),
      ref_model_field: item.expression ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { measures, dimensions };
}

// ================================================================ 提交前本地预检

/**
 * Cube 草稿（UI 态；提交时用 {@link toMeasures}/{@link toDimensions} 转 wire）。
 *
 * <p><b>必须用 `type` 而非 `interface`</b>：`useDirtyState<TDraft extends Record<string, unknown>>`
 * 的约束要求实参带**隐式索引签名** —— 对象字面量类型别名有，`interface` 没有
 * （改成 interface 会得到 TS2344；T03b 的 `RelationshipDraft` 同理用了 type）。
 */
export type CubeDraftValues = {
  displayName: string;
  /** 挂靠模型 item_key（`mdl:model:<name>`）。 */
  modelRef: string;
  measures: MeasureRow[];
  dimensions: DimensionRow[];
};

/**
 * 提交前本地预检（返回人话错误列表；空 = 可提交）。
 *
 * <p><b>只拦「明显不合法」</b>，权威判定仍在后端（42201/42200）。字段存在性检查在
 * `fieldOptions` 为空时**跳过**（模型字段未加载时不该误判，否则用户被前端挡住、后端却没问题）。
 *
 * @param draft      当前草稿
 * @param fieldOptions 所选模型的字段清单（限定名 `orders.amount`；补全/维度下拉同源）
 */
export function validateCubeDraft(draft: CubeDraftValues, fieldOptions: string[]): string[] {
  const errors: string[] = [];
  if (draft.displayName.trim() === '') {
    errors.push('Cube 名称不能为空');
  }
  if (draft.modelRef.trim() === '') {
    errors.push('必须选择挂靠模型（model_ref）');
  }
  if (draft.measures.length === 0) {
    errors.push('至少需要一个度量（measure），否则 Cube 无法聚合');
  }

  const measureNames = new Set<string>();
  draft.measures.forEach((row, index) => {
    const label = `第 ${index + 1} 个度量`;
    const name = row.name.trim();
    if (name === '') {
      errors.push(`${label}：名称不能为空`);
    } else if (measureNames.has(name.toLowerCase())) {
      errors.push(`${label}：度量名重复（${name}）`);
    } else {
      measureNames.add(name.toLowerCase());
    }
    if (row.expression.trim() === '') {
      errors.push(`${label}：聚合表达式不能为空`);
    }
  });

  const knownFields = new Set(fieldOptions.map((field) => field.toLowerCase()));
  const knownTails = new Set(fieldOptions.map((field) => keyTail(field).toLowerCase()));
  const dimensionNames = new Set<string>();
  draft.dimensions.forEach((row, index) => {
    const label = `第 ${index + 1} 个维度`;
    const name = row.name.trim();
    if (name === '') {
      errors.push(`${label}：名称不能为空`);
    } else if (dimensionNames.has(name.toLowerCase())) {
      errors.push(`${label}：维度名重复（${name}）`);
    } else {
      dimensionNames.add(name.toLowerCase());
    }
    const ref = row.refModelField.trim();
    if (ref === '') {
      errors.push(`${label}：必须引用一个模型字段`);
    } else if (knownFields.size > 0) {
      // 末段命中即可（`orders.amount` 与 `amount` 都算命中）—— 与后端 matchesAny 同口径
      const lower = ref.toLowerCase();
      if (!knownFields.has(lower) && !knownTails.has(keyTail(lower))) {
        errors.push(`${label}：引用了模型里不存在的字段（${ref}）`);
      }
    }
  });

  return errors;
}

// ================================================================ 错误码分流

/**
 * 业务码 → 人话（**逐个读 `data` 明细**；抄 T03a 报告「给 T03b/T03c 的接口备注 4」）。
 *
 * <p>纯函数签名的理由：便于单测（不依赖 axios/Error 实例），组件只负责把
 * `errorCode(err)` / `errorData(err)` / `message` 传进来。
 *
 * @param code    业务码（非建模台错误为 null）
 * @param data    下游 `data` 明细
 * @param message 下游 message（兜底）
 */
export function describeCubeError(
  code: number | null,
  data: Record<string, unknown> | null,
  message: string,
): string {
  const asStringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => String(item)) : [];

  if (code === 42201) {
    const errors = asStringList(data?.errors);
    const modelRef = typeof data?.model_ref === 'string' ? data.model_ref : null;
    const detail = errors.length > 0 ? errors.join('；') : message;
    return `[${code}] ${detail}${modelRef ? `（挂靠模型：${modelRef}）` : ''}`;
  }
  if (code === 42200) {
    const field = typeof data?.field === 'string' ? data.field : null;
    const modelKey = typeof data?.model_item_key === 'string' ? data.model_item_key : null;
    const dependents = asStringList(data?.dependents);
    const parts: string[] = ['参数校验未通过'];
    if (field) {
      parts.push(`字段 ${field} 指向的模型不存在${modelKey ? `（${modelKey}）` : ''}`);
    }
    if (dependents.length > 0) {
      parts.push(`被以下节点引用：${dependents.join('、')}`);
    }
    if (!field && dependents.length === 0) {
      parts.push(message);
    }
    return `[${code}] ${parts.join('；')}`;
  }
  if (code === 40900) {
    const current = data?.current_edit_revision;
    return `[${code}] 版本已变更（当前 ${String(current ?? '?')}），请刷新后重试`;
  }
  if (code === 40901) {
    return `[${code}] 该提交已被处理（幂等键重复），已为你换新提交号，可直接重试`;
  }
  if (code === 40300) {
    return `[${code}] 该连接未开启 MDL 写回（mdl_writeback_enabled=false），请联系管理员`;
  }
  if (code === 50300) {
    return `[${code}] Cube 创建接口尚未就绪`;
  }
  return code != null ? `[${code}] ${message}` : message;
}
