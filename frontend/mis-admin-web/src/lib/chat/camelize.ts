/**
 * snake_case → camelCase 递归转换（chat-core / A2UI 渲染层共用）。
 *
 * <p>后端 wire 为 snake_case（tool_name / skill_id / error_code），前端统一
 * camelCase 消费（02 文档 §4 命名口径：后端 snake_case → 前端 camelCase）。
 */

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** 递归转换对象 / 数组 / 原语。 */
export function camelizeKeys<T = unknown>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => camelizeKeys(item)) as unknown as T;
  }
  if (typeof obj === 'object' && obj instanceof Object) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = snakeToCamel(key);
      result[camelKey] = camelizeKeys(value);
    }
    return result as T;
  }
  return obj as T;
}
