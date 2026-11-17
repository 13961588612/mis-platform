import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 分转元展示（diff_amount_cent 为分 → 页面显示元，两位小数） */
export function centsToYuan(cents?: number | null): string {
  if (cents == null) return '-';
  return (cents / 100).toFixed(2);
}

/** 格式化 JSON 文本（缩进 2），非法 JSON 原样返回 */
export function prettyJson(raw?: string | null): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** 解析 JSON 文本域（trim 后校验；空 → 返回 null；非法 → 抛错信息） */
export function parseJsonField(raw: string | undefined | null): { value: unknown | null; error?: string } {
  if (!raw || !raw.trim()) return { value: null };
  try {
    return { value: JSON.parse(raw) };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : 'JSON 格式非法' };
  }
}
