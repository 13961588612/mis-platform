/**
 * 「AI 对话创建」Tab(C) 共享工具。
 *
 * <p>本文件是 C 功能回填链路的**唯一权威实现点**，A/B/C 三 Tab 共用：
 *   - {@link extractSkillMd}：从 AI 文本抽取 ```SKILL.md 代码块（前端唯一入口；
 *     取最外层围栏，避免正文内 ```json 截断）；
 *   - {@link applyParsedSkill}：把 parseSkill 解析出的 metadata/body 写回表单与正文，
 *     空值不覆盖已有字段（沿用粘贴 Tab 的 onParse 语义）；
 *   - {@link diffHighlight}：回填前后六字段浅比较，差异键供 P1-3 高亮。
 *
 * <p>硬约束：禁止为 C 另写任何 SKILL.md 解析逻辑；解析入口只有 `parseSkill`
 * （粘贴 Tab 同一函数）。本文件只做「抽取 + 回填 + 差异」，不解析 YAML。
 */
import type { SkillFormValues } from './agent-skill-form-dialog';

/**
 * 统计全文 ``` 围栏次数（开/闭都算一次）。
 * 正文里的 ```json 示例会额外贡献 2 次；外层未闭合时总数为奇数。
 */
function countFences(src: string): number {
  let n = 0;
  let i = 0;
  while (i < src.length) {
    const found = src.indexOf('```', i);
    if (found < 0) break;
    n += 1;
    i = found + 3;
  }
  return n;
}

/**
 * 围栏同行的 info string（``` 与换行之间）。空串 = 闭合围栏或裸 ```。
 */
function fenceInfo(src: string, fencePos: number): string {
  const after = fencePos + 3;
  const nl = src.indexOf('\n', after);
  const lineEnd = nl < 0 ? src.length : nl;
  return src.slice(after, lineEnd).trim();
}

/**
 * 消息预览用：剥除代码块首行 info string 标签（SKILL.md / markdown / md / skill /
 * text 等单行标签），避免与抽取逻辑各写各的（QA MINOR-3）。仅用于展示，不影响回填。
 */
export const CODE_FENCE_LABEL_RE = /^(?:[a-zA-Z0-9._+-]+)?\s*\n/;

/** 从 metadata 取字符串值（缺省为空串），兼容非字符串脏数据。 */
export function metaStr(meta: Record<string, unknown>, key: string): string {
  const v = meta[key];
  return typeof v === 'string' ? v : '';
}

/** metadata.tags 可能为字符串数组或字符串，统一摊平成逗号分隔文本。 */
export function metaTags(meta: Record<string, unknown>): string {
  const v = meta['tags'];
  if (Array.isArray(v)) {
    return v.filter((t) => typeof t === 'string').join(', ');
  }
  return typeof v === 'string' ? v : '';
}

/**
 * 从 AI 回复文本中抽取 SKILL.md 正文（本文件唯一抽取入口）。
 *
 * <p>取「第一个围栏开」到「最后一个围栏闭」，与后端 `_strip_code_fence`（rfind）
 * 对齐。非贪婪正则会在正文第一个 ```json 处截断，自动回填只剩半截。
 * 围栏数为奇数、或最后一个围栏带 info string（如生成被截断、外层未闭合）时，
 * 取到文末，避免丢掉已生成的后半段。
 *
 * @param text AI 回复全文
 * @returns 代码块内的 SKILL.md 文本（已 trim）；无代码块时返回 `null`
 *   （调用方应整段兜底，把原文当作 SKILL.md 尝试 parseSkill）。
 */
export function extractSkillMd(text: string): string | null {
  const src = text ?? '';
  const open = src.indexOf('```');
  if (open < 0) return null;
  const nl = src.indexOf('\n', open + 3);
  if (nl < 0) return null;

  const n = countFences(src);
  const close = src.lastIndexOf('```');
  const lastLooksLikeOpener = fenceInfo(src, close).length > 0;
  const takeToEof = n % 2 === 1 || lastLooksLikeOpener || close <= nl;
  const inner = (takeToEof ? src.slice(nl + 1) : src.slice(nl + 1, close)).trim();
  return inner.length > 0 ? inner : null;
}

/**
 * 回填：把 parseSkill 的结果写回表单与正文。
 *
 * <p>空值不覆盖已有字段（被覆盖会清空用户手填内容）；body 直接落盘正文（可继续编辑）。
 * 纯函数：返回新的 form 与 body，由调用方 setState，便于同时计算高亮差异。
 *
 * @param meta  parseSkill 返回的 metadata
 * @param body  parseSkill 返回的 body（Markdown 正文）
 * @param current 回填前的表单值
 * @returns 回填后的 `{ form, body }`
 */
export function applyParsedSkill(
  meta: Record<string, unknown>,
  body: string,
  current: SkillFormValues,
): { form: SkillFormValues; body: string } {
  return {
    form: {
      ...current,
      name: metaStr(meta, 'name') || current.name,
      description: metaStr(meta, 'description') || current.description,
      category: metaStr(meta, 'category') || current.category,
      tags: metaTags(meta) || current.tags,
      handler: metaStr(meta, 'handler') || current.handler,
    },
    body: body ?? '',
  };
}

/** 参与高亮比较的六个元数据字段（与 SkillFormValues 对齐）。 */
const HIGHLIGHT_KEYS: Array<keyof SkillFormValues> = [
  'id',
  'name',
  'description',
  'category',
  'tags',
  'handler',
];

/**
 * 回填前后浅比较六个字段，返回发生变化的键集合（供 P1-3 高亮变更字段）。
 *
 * @param before 回填前表单
 * @param after  回填后表单
 * @returns 差异键集合（无差异则为空 Set）
 */
export function diffHighlight(
  before: SkillFormValues,
  after: SkillFormValues,
): Set<string> {
  const diff = new Set<string>();
  for (const key of HIGHLIGHT_KEYS) {
    if ((before[key] ?? '') !== (after[key] ?? '')) {
      diff.add(key);
    }
  }
  return diff;
}
