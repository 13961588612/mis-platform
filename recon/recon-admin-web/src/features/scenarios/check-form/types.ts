import type { ReconCheck, MatchRule, CompareRule } from '@/types/api';

/* ---------------- 消费模式 ---------------- */

export type ConsumeMode = 'incremental' | 'time_window';

/** Tab A 消费清单行（数据源清单唯一入口；time_field 只读自数据源声明） */
export interface ConsumeRow {
  key: string;          // 本地 uid，新增/删除定位用
  ds_code: string;      // 下拉选择数据源；别名恒 = ds_code（不再手输 alias，杜绝空匹配键）
  mode: ConsumeMode;    // 全 check 一致（A-R2-04），任一行动作同步所有行
  time_field?: string;  // 只读展示：取自 ReconDatasource.time_field（"取自数据源声明"）
}

/* ---------------- 汇总窗口 ---------------- */

export type RelativePreset =
  | 'yesterday'
  | 'today'
  | 'last7d'
  | 'last30d'
  | 'lastMonth'
  | 'monthToDate';

/** 相对窗口快捷预设（落库为相对占位符表达式，与《对账框架V3》§6.3 一致） */
export const RELATIVE_PRESETS: Record<RelativePreset, { label: string; start: string; end: string }> = {
  yesterday:   { label: '昨天全天',     start: '{yesterday_start}', end: '{yesterday_end}' },
  today:       { label: '今天凌晨至今', start: '{trans_date}',       end: '{recon_time}' },
  last7d:      { label: '近 7 天',       start: '{recon_time}-7d',    end: '{recon_time}' },
  last30d:     { label: '近 30 天',      start: '{recon_time}-30d',   end: '{recon_time}' },
  lastMonth:   { label: '上个月',         start: '{last_month_start}', end: '{last_month_end}' },
  monthToDate: { label: '本月至今',       start: '{month_start}',      end: '{recon_time}' },
};

export interface SummaryWindowState {
  kind: 'relative' | 'absolute';
  relative: { preset: RelativePreset; customDays: number };
  absolute: { start: string; end: string }; // yyyy-MM-dd HH:mm:ss
  /** 派生：实时预览，最终落库的 start/end 表达式 */
  startExpr: string;
  endExpr: string;
}

export const EMPTY_SUMMARY: SummaryWindowState = {
  kind: 'relative',
  relative: { preset: 'yesterday', customDays: 0 },
  absolute: { start: '', end: '' },
  startExpr: '',
  endExpr: '',
};

/** 由当前窗口配置派生最终落库的 start/end 表达式 */
export function deriveWindowExpr(w: SummaryWindowState): { startExpr: string; endExpr: string } {
  if (w.kind === 'absolute') {
    return { startExpr: w.absolute.start, endExpr: w.absolute.end };
  }
  if (w.relative.customDays > 0) {
    return {
      startExpr: `{recon_time}-${w.relative.customDays}d`,
      endExpr: '{recon_time}',
    };
  }
  const p = RELATIVE_PRESETS[w.relative.preset];
  return p ? { startExpr: p.start, endExpr: p.end } : { startExpr: '', endExpr: '' };
}

/* ---------------- Tab A 整体状态 ---------------- */

export interface TabAState {
  check_name: string;
  seq_no: string;
  rows: ConsumeRow[];
  window: SummaryWindowState | null; // 存在 time_window 行时非空
}

export const EMPTY_TAB_A: TabAState = {
  check_name: '',
  seq_no: '1',
  rows: [],
  window: null,
};

let uid = 0;
export function nextKey(): string {
  return `row-${++uid}-${Date.now().toString(36)}`;
}

/** 由现有 check 反解析出 Tab A 状态（编辑回显；alias 恒 = ds_code，consume_json 的 key 兼容旧的自定义 alias） */
export function tabAFromCheck(c: ReconCheck): TabAState {
  let rows: ConsumeRow[] = [];
  let window: SummaryWindowState | null = null;
  try {
    const obj = JSON.parse(c.consume_json || '{}') as Record<string, ConsumeRow & { start?: string; end?: string }>;
    rows = Object.entries(obj).map(([, cfg]) => ({
      key: nextKey(),
      ds_code: cfg.ds_code ?? '',
      mode: cfg.mode === 'time_window' ? 'time_window' : 'incremental',
      time_field: cfg.time_field,
    }));
    const tw = rows.find((r) => r.mode === 'time_window');
    if (tw) {
      const twEntry = Object.entries(obj).find(([, cfg]) => cfg.mode === 'time_window');
      const start = twEntry?.[1].start ?? '';
      const end = twEntry?.[1].end ?? '';
      // 已有 start/end 为绝对时间串（无占位符）→ 归为绝对窗口，否则按相对默认
      const isAbsolute = start !== '' && !start.includes('{') && !end.includes('{');
      window = {
        ...EMPTY_SUMMARY,
        kind: isAbsolute ? 'absolute' : 'relative',
        absolute: { start, end },
      };
      Object.assign(window, deriveWindowExpr(window));
    }
  } catch {
    rows = [];
  }
  return { check_name: c.check_name, seq_no: String(c.seq_no ?? 1), rows, window };
}

/** Tab A → 后端 payload 的派生：consume_json + 汇总窗口 + 参与匹配清单（key/alias 一律用 ds_code） */
export function buildTabAPayload(s: TabAState): {
  check_name: string;
  seq_no: number;
  consume_json: string;
  windowStart: string | undefined;
  windowEnd: string | undefined;
  datasets_json: string; // 收敛口径 2.0：匹配清单自动 = 消费清单全量
  } {
  const consume: Record<string, Record<string, string | undefined>> = {};
  for (const r of s.rows) {
    const row: Record<string, string | undefined> = {
      ds_code: r.ds_code,
      mode: r.mode,
      time_field: r.time_field,
    };
    if (r.mode === 'time_window' && s.window) {
      row.start = s.window.startExpr;
      row.end = s.window.endExpr;
    }
    consume[r.ds_code] = row;
  }
  return {
    check_name: s.check_name.trim(),
    seq_no: Number(s.seq_no) || 1,
    consume_json: JSON.stringify(consume),
    windowStart: s.window?.startExpr || undefined,
    windowEnd: s.window?.endExpr || undefined,
    datasets_json: JSON.stringify(s.rows.map((r) => r.ds_code)),
  };
}

/** Tab A 保存校验：sum_check 恰好 1 个；custom 恰好 2 个；custom_check 1~N 个；两两策略恰好 2 个 / ds 唯一 / 窗口必填 + end>start */
export function validateTabA(s: TabAState, strategy?: string): string | null {
  if (strategy === 'sum_check') {
    if (s.rows.length !== 1) return `汇总校验 sum_check 需要恰好 1 个参与数据源（当前 ${s.rows.length} 个）`;
    if (!s.rows[0]?.ds_code) return '参与数据源行必选数据源 ds_code';
    return null;
  }
  if (strategy === 'custom_check') {
    // 整检查自定义：1~N 个参与数据源（整检查上下文入参多数据集，无左右角色）
    if (s.rows.length < 1) return '整检查自定义 custom_check 需要至少 1 个参与数据源';
    if (s.rows.some((r) => !r.ds_code)) return '参与数据源行必选数据源 ds_code';
    return null;
  }
  if (strategy === 'custom') {
    // 自定义匹配：两两匹配范式，恰好 2 个（窗口校验同 exact_key）
    if (s.rows.length !== 2) return `自定义匹配 custom 需要恰好 2 个参与数据源（当前 ${s.rows.length} 个）`;
    if (s.rows.some((r) => !r.ds_code)) return '参与数据源行必选数据源 ds_code';
    const dsCode = s.rows.map((r) => r.ds_code);
    if (new Set(dsCode).size !== dsCode.length) return '同一 check 内不能重复引用同一数据源';
    if (s.window && s.window.kind === 'absolute') {
      if (!s.window.absolute.start || !s.window.absolute.end) {
        return '存在 time_window 数据源时汇总窗口必填（end > start）';
      }
      if (s.window.absolute.end <= s.window.absolute.start) {
        return '汇总窗口 end 必须晚于 start';
      }
    }
    return null;
  }
  if (s.rows.length !== 2) return '当前批次仅支持恰好 2 个参与数据源（链式/汇总为后续形态）';
  if (s.rows.some((r) => !r.ds_code)) return '参与数据源行必选数据源 ds_code';
  const dsCode = s.rows.map((r) => r.ds_code);
  if (new Set(dsCode).size !== dsCode.length) return '同一 check 内不能重复引用同一数据源';
  if (s.window && s.window.kind === 'absolute') {
    if (!s.window.absolute.start || !s.window.absolute.end) {
      return '存在 time_window 数据源时汇总窗口必填（end > start）';
    }
    if (s.window.absolute.end <= s.window.absolute.start) {
      return '汇总窗口 end 必须晚于 start';
    }
  }
  return null;
}

/* ---------------- 匹配规则（Tab B 结构化） ---------------- */

export type TransformType = 'prefix_remove' | 'prefix_add' | 'regex_replace';
/** 同键多行处理：reject=转异常 / aggregate=数值字段求和 / latest=取末行 */
export type MultiRowMode = 'reject' | 'aggregate' | 'latest';

export interface KeyTemplateRow {
  key: string;
  alias: string;
  template: string;    // 模板表达式，如 {order_no}_{channel}（兼容旧数据 / 兜底）
  fields: string[];    // 勾选的匹配键字段（有序，拼接顺序）；template 由此生成
  sep: string;         // 复合键分隔符 '_' / '-' / ''，两侧须一致
}

/** 匹配键配置器一侧：绑定的数据集（取自 Tab A 消费清单第 1/2 行） */
export interface KeySide {
  alias: string;
  label: string;   // 显示名：alias（ds_code）
  fields: string[]; // 候选字段（数据源 fields_json 的 source 字段，有序去重）
}

/** "{a}_{b}" → {fields, sep}（与数据源 record_key 解析口径一致） */
export function templateToParts(template?: string | null): { fields: string[]; sep: string } {
  const t = template ?? '';
  const m = t.match(/\{([^}]+)\}/g);
  const fields = m ? m.map((s) => s.slice(1, -1).trim()).filter(Boolean) : [];
  const sepM = t.match(/\}\s*(.)\s*\{/);
  return { fields, sep: fields.length > 1 ? (sepM ? sepM[1] : '_') : '_' };
}

/** fields + sep → 模板表达式，如 ['order_no','channel'] + '_' → '{order_no}_{channel}' */
export function partsToTemplate(fields: string[], sep: string): string {
  if (!fields.length) return '';
  return fields.map((f) => `{${f}}`).join(sep || '_');
}

/** 数据源 fields_json [{name,source,annotation}] → 候选 source 字段 */
export function parseKeySideFields(fieldsJson?: string | null): string[] {
  if (!fieldsJson) return [];
  try {
    const arr = JSON.parse(fieldsJson);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.map((x) => String(x?.source ?? x?.name ?? '').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}
export interface TransformRow {
  key: string;
  dataset: string;
  field: string;
  type: TransformType;
  pattern: string;     // prefix_remove/prefix_add 为前缀；regex_replace 为正则
  replacement: string; // 仅 regex_replace 生效
}
export interface MultiRowModeRow {
  key: string;
  alias: string;
  mode: MultiRowMode;
}

export interface TabBState {
  strategy: 'exact_key' | 'composite_key' | 'sum_check' | 'custom' | 'custom_check';
  keyTemplates: KeyTemplateRow[];
  transforms: TransformRow[];
  multiRows: MultiRowModeRow[];
  /** 空匹配键跳过：勾选的数据集别名（落库 config_json → empty_key_skip） */
  emptyKeySkip: string[];
  /** 自定义类全限定类名（strategy=custom / custom_check 必填，落库 custom_class） */
  customClass: string;
  /** 自定义参数 JSON 原文（可选；除 class 外的键值原样传入实现类，落库 config_json） */
  configJson: string;
}

export const EMPTY_TAB_B: TabBState = {
  strategy: 'exact_key',
  keyTemplates: [],
  transforms: [],
  multiRows: [],
  emptyKeySkip: [],
  customClass: '',
  configJson: '',
};

/** MatchRule → Tab B 状态（编辑回显；match_rule 可能缺失/为空） */
export function tabBFromMatch(m?: MatchRule | null): TabBState {
  if (!m) {
    return { strategy: 'exact_key', keyTemplates: [], transforms: [], multiRows: [], emptyKeySkip: [], customClass: '', configJson: '' };
  }
  const customClass = m.custom_class ?? '';
  const configJson = m.config_json ?? '';
  let keyTemplates: KeyTemplateRow[] = [];
  try {
    const o = JSON.parse(m.key_fields_json || '{}') as Record<string, string>;
    keyTemplates = Object.entries(o).map(([alias, t]) => {
      const { fields, sep } = templateToParts(t);
      return { key: nextKey(), alias, template: t ?? '', fields, sep };
    });
  } catch {
    keyTemplates = [];
  }
  let transforms: TransformRow[] = [];
  try {
    const a = JSON.parse(m.field_transform_json || '[]') as any[];
    transforms = (Array.isArray(a) ? a : []).map((t) => ({
      key: nextKey(),
      dataset: t.dataset ?? '',
      field: t.field ?? '',
      type: ['prefix_remove', 'prefix_add', 'regex_replace'].includes(t.type) ? t.type : 'regex_replace',
      pattern: t.pattern ?? '',
      replacement: t.replacement ?? '',
    }));
  } catch {
    transforms = [];
  }
  let multiRows: MultiRowModeRow[] = [];
  try {
    const o = JSON.parse(m.multi_row_json || '{}') as Record<string, string>;
    multiRows = Object.entries(o).map(([alias, mode]) => ({
      key: nextKey(),
      alias,
      mode: mode === 'aggregate' || mode === 'latest' ? mode : 'reject',
    }));
  } catch {
    multiRows = [];
  }
  let emptyKeySkip: string[] = [];
  try {
    const o = JSON.parse(m.config_json || '{}') as { empty_key_skip?: unknown };
    if (Array.isArray(o.empty_key_skip)) {
      emptyKeySkip = o.empty_key_skip.map(String);
    } else if (o.empty_key_skip === true) {
      // 全局跳过 → 展开为当前 keyTemplates 全部别名（编辑回显等价）
      emptyKeySkip = keyTemplates.map((r) => r.alias);
    }
  } catch {
    emptyKeySkip = [];
  }
  return {
    strategy: (['exact_key', 'composite_key', 'sum_check', 'custom', 'custom_check'].includes(m.strategy) ? m.strategy : 'exact_key'),
    keyTemplates,
    transforms,
    multiRows,
    emptyKeySkip,
    customClass,
    configJson,
  };
}

export function serializeKeyTemplates(rows: KeyTemplateRow[]): string {
  const o: Record<string, string> = {};
  for (const r of rows) {
    if (!r.alias.trim()) continue;
    const tpl = (r.fields && r.fields.length) ? partsToTemplate(r.fields, r.sep) : (r.template ?? '').trim();
    if (tpl) o[r.alias.trim()] = tpl;
  }
  return JSON.stringify(o);
}
export function serializeTransforms(rows: TransformRow[]): string | undefined {
  const arr = rows
    .filter((r) => r.dataset.trim() && r.field.trim())
    .map((r) => ({
      dataset: r.dataset.trim(),
      field: r.field.trim(),
      type: r.type,
      pattern: r.pattern.trim() || undefined,
      replacement: r.type === 'regex_replace' ? r.replacement.trim() || undefined : undefined,
    }));
  return arr.length ? JSON.stringify(arr) : undefined;
}
export function serializeMultiRows(rows: MultiRowModeRow[]): string | undefined {
  const o: Record<string, string> = {};
  for (const r of rows) if (r.alias.trim()) o[r.alias.trim()] = r.mode;
  return Object.keys(o).length ? JSON.stringify(o) : undefined;
}

/** Tab B 状态 → 合并回 MatchRule（datasets_json 沿用 Tab A 派生，不在此改） */
export function buildTabBPayload(s: TabBState, current: MatchRule): MatchRule {
  /* custom / custom_check：匹配整体自定义，不产生 key_fields / field_transform / multi_row（需求 §3.7） */
  if (s.strategy === 'custom' || s.strategy === 'custom_check') {
    const cfg: Record<string, unknown> = {};
    if (s.configJson.trim()) {
      try {
        const parsed = JSON.parse(s.configJson) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          Object.assign(cfg, parsed);
        }
      } catch {
        /* 非法 JSON 由保存校验拦截，此处兜底忽略 */
      }
    }
    cfg.class = s.customClass.trim(); // class 键与 custom_class 一致（需求 §3.7）
    const match: MatchRule = {
      strategy: s.strategy,
      datasets_json: current.datasets_json,
      custom_class: s.customClass.trim() || undefined,
      config_json: JSON.stringify(cfg),
    };
    return match;
  }

  const match: MatchRule = {
    strategy: s.strategy,
    datasets_json: current.datasets_json,
    key_fields_json: serializeKeyTemplates(s.keyTemplates),
    ...(serializeTransforms(s.transforms) ? { field_transform_json: serializeTransforms(s.transforms) } : {}),
    ...(serializeMultiRows(s.multiRows) ? { multi_row_json: serializeMultiRows(s.multiRows) } : {}),
  };
  const cfg: Record<string, unknown> = {};
  if (s.emptyKeySkip.length) cfg.empty_key_skip = s.emptyKeySkip;
  if (Object.keys(cfg).length) match.config_json = JSON.stringify(cfg);
  return match;
}

/* ---------------- 比较规则（Tab C 结构化） ---------------- */

export type CompareMode = 'equal' | 'custom' | 'string' | 'lte' | 'gte' | 'lt' | 'gt' | 'contains' | 'regex';
export type TolType = 'null' | 'absolute' | 'percentage' | 'both';
export type ValueTransform = 'none' | 'trim_comma' | 'trim' | 'uppercase' | 'trim_space' | 'lower' | 'abs';

export interface CompareRuleRow {
  key: string;
  name: string;
  left_field: string;  // 格式：数据集别名.字段名
  right_field: string; // 格式：数据集别名.字段名
  compare_mode: CompareMode;
  tolerance_type: TolType;
  tolerance_value: string;
  is_amount: boolean;
  value_transform: ValueTransform;
  zero_unmatched_skip: boolean;
  diff_unit: 'none' | 'point'; // point=积分差额写入 diff_point（V5），与 is_amount 独立
  /** 比较器全限定类名（compare_mode=custom 必填，实现 CustomComparator；行级落库 comparator_class） */
  comparator_class: string;
  /** 行级比较器参数 JSON 原文（可选，落库 comparator_params） */
  comparator_params: string;
}

/* ---------------- sum_check 勾稽表达式（Tab C sum_check 形态） ---------------- */

export interface SumRuleRow {
  key: string;
  name: string;
  left_expr: string;   // 如 orders.total_amount（单数据源内部勾稽）
  right_expr: string;  // 如 orders.a + orders.b - orders.c（支持 + - * / ( )）
  tolerance_type: TolType;
  tolerance_value: string;
  is_amount: boolean;
}

/**
 * 勾稽表达式语法校验（对齐原型 v5.7 R41 口径，与引擎 ExpressionEvaluator 语法同源）：
 * 引用 alias.field / 数字 / + - * / ( )；括号配对 + 运算符结构。空表达式返回 null（由保存必填兜底）。
 */
export function parseSumExpr(expr: string): string | null {
  const e = expr.trim();
  if (!e) return null;
  if (!/^[A-Za-z0-9_.,+\-*/()]+$/.test(e.replace(/\s+/g, ''))) return '含非法字符（仅支持 alias.field 引用、数字与 + - * / ( )）';
  const tokens = e.match(/[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[+\-*/()]/g) ?? [];
  if (!tokens.length) return '表达式为空';
  let depth = 0;
  for (const t of tokens) {
    if (t === '(') depth++;
    else if (t === ')') {
      depth--;
      if (depth < 0) return '括号不配对';
    }
  }
  if (depth !== 0) return '括号不配对';
  const head = tokens[0];
  const tail = tokens[tokens.length - 1];
  if (head && ['+', '-', '*', '/'].includes(head)) return '不能以运算符开头';
  if (tail && ['+', '-', '*', '/'].includes(tail)) return '不能以运算符结尾';
  return null;
}

/** 引用级校验：引用格式 alias.field、前缀必须 = 当前单源 alias、字段须在数据源字段映射中 */
export function validateSumExpr(expr: string, alias: string, fields: string[]): string | null {
  const e = expr.trim();
  if (!e) return null; // 空表达式不实时标红，保存时必填兜底（原型 R41 同口径）
  const syntax = parseSumExpr(e);
  if (syntax) return syntax;
  const refs = e.match(/[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const ref of refs) {
    const [a = '', f = ''] = ref.split('.');
    if (a !== alias) return `引用前缀必须为当前单源 ${alias}：${ref}`;
    if (fields.length && !fields.includes(f)) return `字段不存在：${ref}`;
  }
  return null;
}

/** 勾稽表达式 → 落库 rules_json（行结构 {name,left_expr,right_expr,tolerance,is_amount}，与方案 §十二 一致） */
export function serializeSumRules(rows: SumRuleRow[]): string {
  const arr = rows
    .filter((r) => r.left_expr.trim() && r.right_expr.trim())
    .map((r) => {
      const rule: Record<string, unknown> = {
        name: r.name.trim(),
        left_expr: r.left_expr.trim(),
        right_expr: r.right_expr.trim(),
        is_amount: r.is_amount,
      };
      if (r.tolerance_type !== 'null') {
        rule.tolerance = { type: r.tolerance_type, value: Number(r.tolerance_value) || 0 };
      }
      return rule;
    });
  return JSON.stringify(arr);
}

export interface TabCState {
  rules: CompareRuleRow[];
  /** sum_check 勾稽表达式规则（策略为 sum_check 时使用，与 rules 互斥） */
  sumRules: SumRuleRow[];
}

export const EMPTY_TAB_C: TabCState = { rules: [], sumRules: [] };

/** 比较规则 json → Tab C 状态（编辑回显；compare_rule 可能缺失/为空；按行结构自适应 sum_check/两两） */
export function tabCFromCompare(c?: CompareRule | null): TabCState {
  let rules: CompareRuleRow[] = [];
  let sumRules: SumRuleRow[] = [];
  if (!c?.rules_json) return { rules, sumRules };
  try {
    const a = JSON.parse(c.rules_json || '[]') as any[];
    (Array.isArray(a) ? a : []).forEach((r) => {
      const tol = r.tolerance && typeof r.tolerance === 'object' ? r.tolerance : {};
      const tolType: TolType = ['null', 'absolute', 'percentage', 'both'].includes(tol.type) ? tol.type : 'null';
      // sum_check 勾稽表达式行：以 left_expr/right_expr 为标志
      if (r && typeof r === 'object' && (r.left_expr !== undefined || r.right_expr !== undefined)) {
        sumRules.push({
          key: nextKey(),
          name: r.name ?? '',
          left_expr: r.left_expr ?? '',
          right_expr: r.right_expr ?? '',
          tolerance_type: tolType,
          tolerance_value: tolType !== 'null' && tol.value != null ? String(tol.value) : '',
          is_amount: !!r.is_amount,
        });
        return;
      }
      rules.push({
        key: nextKey(),
        name: r.name ?? '',
        left_field: r.left_field ?? '',
        right_field: r.right_field ?? '',
        compare_mode: (['equal', 'custom', 'string', 'lte', 'gte', 'lt', 'gt', 'contains', 'regex'].includes(r.compare_mode)
          ? r.compare_mode : 'equal'),
        tolerance_type: tolType,
        tolerance_value: tolType !== 'null' && tol.value != null ? String(tol.value) : '',
        is_amount: !!r.is_amount,
        value_transform: (['none', 'trim_comma', 'trim', 'uppercase', 'trim_space', 'lower', 'abs'].includes(r.value_transform)
          ? r.value_transform : 'none') as ValueTransform,
        zero_unmatched_skip: !!r.zero_unmatched_skip,
        diff_unit: r.diff_unit === 'point' ? 'point' : 'none',
        comparator_class: r.comparator_class ?? '',
        comparator_params: r.comparator_params ?? '',
      });
    });
  } catch {
    rules = [];
  }
  return { rules, sumRules };
}

export function serializeRules(rows: CompareRuleRow[]): string {
  const arr = rows
    .filter((r) => {
      if (!r.name.trim()) return false;
      // custom 行：匹配整体交给比较器，无需左右字段；内置行需左右字段
      return r.compare_mode === 'custom' ? r.comparator_class.trim().length > 0 : !!(r.left_field.trim() && r.right_field.trim());
    })
    .map((r) => {
      const rule: Record<string, unknown> = {
        name: r.name.trim(),
        left_field: r.left_field.trim(),
        right_field: r.right_field.trim(),
        compare_mode: r.compare_mode,
        is_amount: r.is_amount,
      };
      if (r.compare_mode === 'custom') {
        rule.comparator_class = r.comparator_class.trim();
        if (r.comparator_params.trim()) rule.comparator_params = r.comparator_params.trim();
        return rule;
      }
      if (r.tolerance_type !== 'null') {
        rule.tolerance = { type: r.tolerance_type, value: Number(r.tolerance_value) || 0 };
      }
      if (r.value_transform !== 'none') rule.value_transform = r.value_transform;
      if (r.zero_unmatched_skip) rule.zero_unmatched_skip = true;
      if (r.diff_unit === 'point') rule.diff_unit = 'point';
      return rule;
    });
  return JSON.stringify(arr);
}

/** JSON 文本合法性校验：空串返回 null（可选）；非法返回错误描述（保存拦截用） */
export function validateJsonText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  try {
    JSON.parse(t);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : '非法 JSON';
  }
}

/** JSON 文本是否解析为普通对象（config_json / comparator_params 落库形态要求，§3.6/§3.7） */
export function isJsonObject(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  try {
    const v = JSON.parse(t);
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
}