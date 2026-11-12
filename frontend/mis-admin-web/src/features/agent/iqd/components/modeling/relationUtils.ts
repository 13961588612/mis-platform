/**
 * relationUtils.ts — 关系相关的**纯函数**（基数视觉编码 / 关系命名 / 条件分析）。
 *
 * <h2>为什么单独成文件（而不是放组件里）</h2>
 * 这四处逻辑的失效方式都是**静默**的，因此必须能单测：
 * <ul>
 *   <li>{@link encodeCardinality}：编码错了只是「画错基数」，不报错 —— 会让建模者
 *       以为配的是 1:N，实际显示成 1:1；</li>
 *   <li>{@link buildRelationshipName}：名字生成规则一变，`item_key` 就变 → 幂等去重
 *       与引用扫描全部换锚点；</li>
 *   <li>{@link analyzeCondition}：纯提示，写错会误报/漏报「字段不存在」。</li>
 * </ul>
 * 而组件文件（`RelationEdge.tsx` / `RelationshipDialog.tsx`）会连带 import
 * `@xyflow/react` / radix 等**运行时重依赖**，把它们放进组件里就等于让单测背上一整套
 * DOM 依赖。本文件**零 import**，可在 node 环境直接测。
 *
 * <h2>与后端的分工（不要越权）</h2>
 * {@link analyzeCondition} 是**前端预检提示**：字段存在性的**权威判定在后端**
 * （`POST /catalog/relationship` → 42200 + `data.unknown_fields`）。前端只提示、不阻断。
 */
import type { Cardinality, JoinType } from '../../types/modeling';

// ================================================================ 基数视觉编码

/** {@link encodeCardinality} 结果：线型 + 两端箭头开关。 */
export interface CardinalityEncoding {
  /** SVG `stroke-dasharray`（undefined = 实线）。 */
  strokeDasharray?: string;
  /** 是否在源端画箭头。 */
  arrowAtSource: boolean;
  /** 是否在目标端画箭头。 */
  arrowAtTarget: boolean;
  /** 归一后的基数文案（未知值回退 `1:N`）。 */
  label: string;
}

/**
 * 基数 → 视觉编码（纯函数；未知/空值按 `1:N` 处理）。
 *
 * <p>编码规则：**箭头表方向、线型表「特殊基数」**（两类信息不挤同一通道，
 * 否则 1:1 与 N:N 都是双箭头会撞车）。
 *
 * <p>按 `1:N` 兜底的理由：这是建模最高频形态，也是弹窗默认值；历史数据
 * （`IqdMdlParser` 同步进来的关系没有 cardinality）画成默认形态比「不画」更不易误导。
 */
export function encodeCardinality(cardinality: string | null | undefined): CardinalityEncoding {
  const normalized = (cardinality ?? '').trim().toUpperCase().replace(/\s+/g, '');
  switch (normalized) {
    case '1:1':
      return { arrowAtSource: true, arrowAtTarget: true, label: '1:1' };
    case 'N:1':
      return { arrowAtSource: true, arrowAtTarget: false, label: 'N:1' };
    case 'N:N':
      return {
        arrowAtSource: true,
        arrowAtTarget: true,
        label: 'N:N',
        // 虚线：多对多语义特殊，必须与 1:1 区分（两者都是双箭头）
        strokeDasharray: '6 3',
      };
    case '1:N':
    default:
      return { arrowAtSource: false, arrowAtTarget: true, label: '1:N' };
  }
}

/** join 类型 → 标签文案（大写；空值回退 `INNER`，与 T03a 后端默认值一致）。 */
export function normalizeJoinType(joinType: string | null | undefined): string {
  const normalized = (joinType ?? '').trim().toUpperCase();
  return normalized === '' ? 'INNER' : normalized;
}

/** 归一 join 类型（回读历史数据用；未知 → `inner`，与后端默认一致）。 */
export function normalizeJoinTypeValue(value: string | null | undefined): JoinType {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'left' || normalized === 'right' || normalized === 'full') {
    return normalized;
  }
  return 'inner';
}

/** 归一基数（回读历史数据用；未知 → `1:N`）。 */
export function normalizeCardinalityValue(value: string | null | undefined): Cardinality {
  const normalized = (value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (normalized === '1:1' || normalized === '1:N' || normalized === 'N:1' || normalized === 'N:N') {
    return normalized;
  }
  return '1:N';
}

// ================================================================ 关系命名

/**
 * 生成关系名（`mdl:relationship:<name>` 的 `<name>` 段）。
 *
 * <p>只保留 `[a-z0-9_]`：`item_key` 是跨端稳定契约，含空格/中文/大写会一路影响
 * T03a 的 `expression` 信封、catalog 检索与 `validateCatalogRefs` 的子串匹配。
 */
export function buildRelationshipName(
  sourceName: string | null | undefined,
  targetName: string | null | undefined,
): string {
  const part = (value: string | null | undefined): string =>
    (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
  return `${part(sourceName) || 'source'}_${part(targetName) || 'target'}`;
}

// ================================================================ 条件分析（本地提示）

/** 关系一端（模型）的字段信息（分析与补全都只需要这三样）。 */
export interface ConditionEndpoint {
  displayName: string;
  fields: string[];
}

/** 条件引用分析结果（本地**提示**，非权威）。 */
export interface ConditionAnalysis {
  /** `a = b` 形式的等值对（用于引用预览）。 */
  pairs: Array<{ left: string; right: string }>;
  /** 疑似引用不到的 token（展示用；**不阻断保存**）。 */
  unknownTokens: string[];
}

/** 本地预检用的 SQL 关键字（**只用于「不像字段就跳过提示」**，不是语法校验）。 */
const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'in', 'like', 'between', 'case',
  'when', 'then', 'else', 'end', 'as', 'distinct', 'on', 'join', 'left', 'right', 'inner', 'outer',
  'full', 'using', 'cast', 'true', 'false', 'coalesce', 'nullif', 'upper', 'lower', 'trim', 'abs',
  'round', 'count', 'sum', 'avg', 'min', 'max', 'date_trunc', 'now', 'current_date', 'interval',
]);

/**
 * 本地分析 join 条件：抽出等值对 + 疑似引用不到的 token。
 *
 * <p>判定规则：token 的**末段**命中两端任一字段名即通过（画布节点携带的是**全量字段**，
 * 不是卡片上渲染的前 8 列）；其余 token 一律列为「可能不存在」。
 *
 * <p>**它只是提示**：T03a 的 42200 才是权威（`data.unknown_fields`）。前端不据此阻断保存。
 */
export function analyzeCondition(
  condition: string | null | undefined,
  source: ConditionEndpoint | null,
  target: ConditionEndpoint | null,
): ConditionAnalysis {
  const text = (condition ?? '').trim();
  if (text === '' || !source || !target) {
    return { pairs: [], unknownTokens: [] };
  }
  const withoutLiterals = text.replace(/'([^']|'')*'/g, "''");

  const pairs: Array<{ left: string; right: string }> = [];
  for (const clause of withoutLiterals.split(/\s+and\s+/i)) {
    const [left, right] = clause.split('=');
    if (left && right) {
      pairs.push({ left: left.trim(), right: right.trim() });
    }
  }

  const knownFields = new Set([...source.fields, ...target.fields].map((f) => f.toLowerCase()));
  const unknownTokens: string[] = [];
  const seen = new Set<string>();
  const matcher = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
  for (const match of withoutLiterals.matchAll(matcher)) {
    const token = match[0];
    const lower = token.toLowerCase();
    if (seen.has(lower) || SQL_KEYWORDS.has(lower)) {
      continue;
    }
    seen.add(lower);
    const segments = lower.split('.');
    const field = segments[segments.length - 1];
    // 字段名命中两端任一 → 通过（画布节点的 columns 是**全量**字段，不是「只渲染前 8 列」那份）
    if (knownFields.has(field)) {
      continue;
    }
    // 其余（含限定名不是这两端的、裸列名未知的）都提示 —— 但**只提示，不阻断保存**
    unknownTokens.push(token);
  }
  return { pairs, unknownTokens };
}
