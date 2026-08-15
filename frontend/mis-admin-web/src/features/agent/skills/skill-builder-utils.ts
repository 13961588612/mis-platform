/**
 * 「AI 对话创建」Tab(C) 共享工具。
 *
 * <p>本文件是 C 功能回填链路的**唯一权威实现点**，A/B/C 三 Tab 共用：
 *   - {@link extractSkillMd}：从 AI 文本抽取 ```SKILL.md 代码块（前端唯一正则）；
 *   - {@link applyParsedSkill}：把 parseSkill 解析出的 metadata/body 写回表单与正文，
 *     空值不覆盖已有字段（沿用粘贴 Tab 的 onParse 语义）；
 *   - {@link diffHighlight}：回填前后六字段浅比较，差异键供 P1-3 高亮。
 *
 * <p>硬约束：禁止为 C 另写任何 SKILL.md 解析逻辑；解析入口只有 `parseSkill`
 * （粘贴 Tab 同一函数）。本文件只做「抽取 + 回填 + 差异」，不解析 YAML。
 */
import type { SkillFormValues } from './agent-skill-form-dialog';

/**
 * 唯一权威正则：抽取任意 info string（```SKILL.md / ```skill.md / ```markdown /
 * ```md / ```skill / ```text / 裸围栏 ``` 等）代码块内容。
 *
 * info string 放宽为「同行任意非换行字符」（`[^\n]*`），一次性覆盖提示词强制的
 * `SKILL.md` 主路径——此前白名单漏了它，导致主路径抽取失败、表单零回填（QA BUG-1）。
 * 仍只有这一处正则，保持「唯一权威」约束不变。
 */
const SKILL_MD_RE = /```[^\n]*\n([\s\S]*?)```/;

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
 * 从 AI 回复文本中抽取 SKILL.md 正文。
 *
 * @param text AI 回复全文
 * @returns 代码块内的 SKILL.md 文本（已 trim）；无代码块时返回 `null`
 *   （调用方应整段兜底，把原文当作 SKILL.md 尝试 parseSkill）。
 */
export function extractSkillMd(text: string): string | null {
  const match = SKILL_MD_RE.exec(text);
  if (!match) return null;
  const inner = (match[1] ?? '').trim();
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
