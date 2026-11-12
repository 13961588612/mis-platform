/**
 * `form_data` 解析（方案 §3.4 组合表的前置）。
 *
 * ⚠️ `ProcessDetailVO.formData` 是 **String**（JSONB 的字符串形态），
 * 不是 JsonNode。所以前端必须 `JSON.parse`，且**必须容错**：
 * 人���改库写坏、迁移脚本截断都可能产出非法串。
 * 解析失败要降级为「原始数据无法解析」+ 原文展示，**不抛**。
 *
 * 抽成独立纯函数是为了能在 node 环境单测（不牵涉 React）。
 */
import type { FormData } from './types';

export type ParsedFormData =
  /** 解析成功，得到扁平对象。 */
  | { ok: true; data: FormData }
  /** 解析失败。`raw` 为原始文本（可能是 null，表示压根没有数据）。 */
  | { ok: false; raw: string | null };

/**
 * 解析 form_data 字符串。
 *
 * ⚠️ 解析成功但得到非对象（如 `"123"`、`"null"`、`"[1,2]"`）时也判为失败：
 * `form_data` 约定是扁平对象（§2.6），拿到数组说明数据形状不对，
 * 按对象去渲染会渲染出空表单，比明确报错更糟。
 */
export function parseFormData(raw: unknown): ParsedFormData {
  if (raw === null || raw === undefined) {
    return { ok: false, raw: null };
  }
  // 列表/详情偶发直接给出对象（Jackson 把 jsonb 当 JSON 而不是转义字符串）
  if (typeof raw === 'object') {
    if (Array.isArray(raw)) return { ok: false, raw: JSON.stringify(raw) };
    return { ok: true, data: raw as FormData };
  }
  if (typeof raw !== 'string') {
    return { ok: false, raw: String(raw) };
  }
  const text = raw.trim();
  if (text === '') return { ok: false, raw };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, raw };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, raw };
  }

  return { ok: true, data: parsed as FormData };
}

/**
 * 判��「压根没有数据」——对应降级 ③ `empty-data`。
 *
 * ⚠️ 与 `!parsed.ok` **必须区分**，方案 §3.4 组合表对这两种情况给了不同文案：
 * - `form_data` 为 null/空串 → `empty-data`（「已登记但未提交数据」）
 * - `form_data` 是非法 JSON 串 → `bad-json`（「原始数据解析失败」+ 展示原文）
 *
 * 混为一谈会让「数据被人工改库写坏」这种**真数据故障**显示成「没提交数据」，
 * 排查方向完全跑偏。
 */
export function isNoData(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'string') return raw.trim() === '';
  return false;
}

/** 判��是否为「有效但为空」的数据（对应降级 ② empty-data）。 */
export function isEmptyFormData(data: FormData): boolean {
  return Object.keys(data).length === 0;
}
