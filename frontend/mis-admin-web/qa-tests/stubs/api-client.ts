/**
 * `@/lib/api/client` 的测试替身（经 tsconfig paths 精确覆盖同名模块）。
 *
 * 目的：让 `src/lib/api/posts.ts` 的**真实源码**（含私有函数 toParams 的序列化逻辑）
 * 在 node 下可执行，只把 axios 实例换成可观测的假实现——被测逻辑本身未被复制或改写。
 */

export interface RecordedCall {
  method: 'get' | 'post' | 'put' | 'delete';
  url: string;
  params?: Record<string, unknown>;
  body?: unknown;
}

const calls: RecordedCall[] = [];

/** 下一次调用返回的 data 载荷（默认空数组，够 listPosts 用）。 */
let nextData: unknown = [];

export function resetStub(data: unknown = []): void {
  calls.length = 0;
  nextData = data;
}

export function lastCall(): RecordedCall {
  if (calls.length === 0) throw new Error('没有捕获到任何 HTTP 调用');
  return calls[calls.length - 1]!;
}

export function allCalls(): RecordedCall[] {
  return [...calls];
}

/**
 * 还原 axios 对 params 的序列化结果，用于断言最终 query string。
 * axios 默认序列化：跳过 undefined/null，数组用重复 key，其余 String(value)。
 */
export function queryStringOf(params?: Record<string, unknown>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${k}[]=${String(item)}`);
    } else {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return parts.join('&');
}

/**
 * 与 axios 一致的响应形状：`T` 是**响应体**类型（调用方传 ApiResult<X>），
 * 故这里返回 `{ data: T }`，T 内部才是 { code, message, data }。
 */
function respond<T>(): Promise<{ data: T }> {
  return Promise.resolve({ data: { code: 0, message: 'ok', data: nextData } as unknown as T });
}

const api = {
  get<T>(url: string, config?: { params?: Record<string, unknown> }) {
    calls.push({ method: 'get', url, params: config?.params });
    return respond<T>();
  },
  post<T>(url: string, body?: unknown) {
    calls.push({ method: 'post', url, body });
    return respond<T>();
  },
  put<T>(url: string, body?: unknown) {
    calls.push({ method: 'put', url, body });
    return respond<T>();
  },
  delete<T>(url: string) {
    calls.push({ method: 'delete', url });
    return respond<T>();
  },
};

export default api;
