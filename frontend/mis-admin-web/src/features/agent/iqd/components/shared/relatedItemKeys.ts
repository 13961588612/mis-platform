/**
 * relatedItemKeys.ts — `related_item_keys` 的 **wire 编解码**（纯函数，跨页共享）。
 *
 * <h2>为什么抽成共享模块（T04e 的取舍）</h2>
 * 该编解码被**两处**消费：
 * <ul>
 *   <li>`iqd-instruction-page.tsx`（T04d，写 `related_item_keys`）；</li>
 *   <li>`iqd-enhance-page.tsx`（T04e，知识 Tab 展示「关联对象」列）。</li>
 * </ul>
 * 若 enhance 页直接 `import` 自 `components/instruction/`，会形成「enhance → instruction」
 * 的**跨页耦合**（两个页面互不相干，却因一个 wire 编解码被绑在一起；将来 instruction 页
 * 若下线/重构，enhance 页会莫名其妙地跟着坏）。而 `related_item_keys` 本质是 **wire 格式**
 * 问题（Java `iqd_knowledge.related_item_keys` 是 jsonb，经 wire 回传为 JSON 字符串），
 * 与页面无关 —— 故下沉到共享位置。
 *
 * <p>`components/instruction/instructionUtils.ts` 仍**再导出**本模块的两个函数，
 * 以保持既有导入路径/单测不变（零回归）。
 *
 * <h2>约定</h2>
 * - wire 形态 = **JSON 字符串数组**（如 `'["mdl:model:orders"]'`）；空 → `null`；
 * - 解析**容错**（null / 空串 / 非法 JSON / 非数组 / 已解析数组）→ `[]`（fail-safe：
 *   视作「无关联」= 全连接通用，宁可多下发也不误裁，与后端 `parse_related_item_keys` 同口径）。
 */

/** `related_item_keys` 摘要（展示用）。 */
export interface RelatedKeysSummary {
  /** 去空白、去空项后的 item_key 列表。 */
  keys: string[];
  /** 条数。 */
  count: number;
  /** 是否「全连接通用」（无关联对象）。 */
  isGlobal: boolean;
}

/**
 * 解析 `related_item_keys`（容错）。
 *
 * @param raw wire 值（JSON 字符串；兜底接受已解析数组 / null）
 * @returns item_key 数组（非法 → `[]`）
 */
export function parseRelatedItemKeys(raw: unknown): string[] {
  if (raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    // 兜底：万一上游回传已解析的数组
    return raw.map((x) => String(x).trim()).filter((x) => x !== '');
  }
  if (typeof raw !== 'string') {
    return [];
  }
  const text = raw.trim();
  if (text === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((x) => String(x).trim()).filter((x) => x !== '');
  } catch {
    return [];
  }
}

/** 序列化 `related_item_keys` 为 wire（空 → `null`；否则去重后的 JSON 字符串数组）。 */
export function serializeRelatedItemKeys(keys: string[]): string | null {
  const cleaned = Array.from(new Set(keys.map((k) => k.trim()).filter((k) => k !== '')));
  if (cleaned.length === 0) {
    return null;
  }
  return JSON.stringify(cleaned);
}

/** `related_item_keys` → 展示摘要（列表「关联对象」列 / 计数）。 */
export function summarizeRelatedItemKeys(raw: unknown): RelatedKeysSummary {
  const keys = parseRelatedItemKeys(raw);
  return { keys, count: keys.length, isGlobal: keys.length === 0 };
}
