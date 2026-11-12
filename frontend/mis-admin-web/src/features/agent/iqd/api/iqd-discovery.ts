/**
 * iqd-discovery.ts — 表发现通道 wire 层（MR-02 / system-design §4.1 a 点）。
 *
 * <p>链路：前端 → BFF `/api/v1/iqd/discovery/**` → ai-platform Worker
 * （MCP `list_models` / `describe_model`）→ 导入写路径再回调 mis-iqd 内部面。
 * **凭证 server-side**，前端只拿 schema/表/列元数据。
 *
 * <h2>硬约束（T02a 实证，改错会直接 422）</h2>
 * <ul>
 *   <li><b>query 参数名必须是 camelCase {@code connectionId}</b>：Worker 侧 FastAPI 用
 *       {@code Query(alias="connectionId")}，写 {@code connection_id} 会 422。</li>
 *   <li>路径固定 {@code /iqd/discovery/{schemas,tables,columns,import}}。</li>
 * </ul>
 *
 * <h2>错误语义（Worker 侧实测）</h2>
 * <ul>
 *   <li>{@code 50201} → **HTTP 502**（MCP 不可达 / profile 未注入 / mock 态 fail-closed）；
 *       注意这是 HTTP 层错误（非 200+code），axios 会 reject，故需从 `error.response` 取码。</li>
 *   <li>{@code 42200} → **HTTP 422**（参数非法 / 待导入清单为空）。</li>
 * </ul>
 * 两者都归一为 {@link IqdDiscoveryApiError}（带 `code` + `status`），便于向导分别呈现
 * 「连接不可达，请检查 profile 注入」与「请至少勾选一张表」。
 */

import axios from 'axios';
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';
import type {
  DiscoveryColumn,
  DiscoverySchema,
  DiscoveryTablePage,
  ImportTablesRequest,
  ImportTablesResult,
} from '../types/modeling';

// ================================================================ 错误类型

/** 表发现 API 错误：带下游业务码（50201/42200/…）与 HTTP 状态。 */
export class IqdDiscoveryApiError extends Error {
  readonly code: number;
  readonly status: number;

  constructor(message: string, code: number, status: number) {
    super(message);
    this.name = 'IqdDiscoveryApiError';
    this.code = code;
    this.status = status;
  }
}

/** 连接不可达 / profile 未注入。 */
export function isDiscoveryUnavailable(err: unknown): boolean {
  return err instanceof IqdDiscoveryApiError && err.code === 50201;
}

/** 入参校验失败（含「空清单」）。 */
export function isDiscoveryValidation(err: unknown): boolean {
  return err instanceof IqdDiscoveryApiError && err.code === 42200;
}

/**
 * 解包表发现响应：Worker 成功走 `{code:0,data}`；失败走 **非 200 HTTP** + `{code,message}`
 * （502/422），axios 会 reject——两种情况都归一为 {@link IqdDiscoveryApiError}。
 */
async function call<T>(fn: () => Promise<{ data: ApiResult<T> }>, fallback: string): Promise<T> {
  try {
    const res = await fn();
    const body = res.data;
    if (body.code !== 0) {
      throw new IqdDiscoveryApiError(body.message || fallback, body.code, 200);
    }
    return body.data as T;
  } catch (err) {
    if (err instanceof IqdDiscoveryApiError) {
      throw err;
    }
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 0;
      const body = err.response?.data as Partial<ApiResult<unknown>> | undefined;
      const code = typeof body?.code === 'number' ? body.code : status;
      throw new IqdDiscoveryApiError(body?.message || fallback, code, status);
    }
    throw err;
  }
}

// ================================================================ 查询参数

/** 表清单查询参数（分页 + 关键字）。 */
export interface ListTablesParams {
  connectionId: number;
  schema: string;
  page?: number;
  keyword?: string;
}

/** 列清单查询参数。 */
export interface ListColumnsParams {
  connectionId: number;
  schema: string;
  table: string;
}

// ================================================================ 只读端点

/**
 * 取 schema 列表。`GET /api/v1/iqd/discovery/schemas?connectionId=`。
 *
 * <p>注意 query 名是 **camelCase** `connectionId`（Worker 侧 alias），见模块头说明。
 */
export async function listSchemas(connectionId: number): Promise<DiscoverySchema[]> {
  const data = await call<{ schemas?: string[]; source?: string }>(
    () =>
      api.get<ApiResult<{ schemas: string[]; source?: string }>>('/iqd/discovery/schemas', {
        params: { connectionId },
      }),
    '获取 schema 列表失败',
  );
  return (data?.schemas ?? []).map((name) => ({ name }));
}

/** 取表清单（分页/搜索）。`GET /api/v1/iqd/discovery/tables`。 */
export async function listTables(params: ListTablesParams): Promise<DiscoveryTablePage> {
  const { connectionId, schema, page = 1, keyword } = params;
  return call(
    () => api.get<ApiResult<DiscoveryTablePage>>('/iqd/discovery/tables', {
      params: { connectionId, schema, page, keyword },
    }),
    '获取表清单失败',
  );
}

/** 取列清单（含主键推断）。`GET /api/v1/iqd/discovery/columns`。 */
export async function listColumns(params: ListColumnsParams): Promise<DiscoveryColumn[]> {
  const { connectionId, schema, table } = params;
  const data = await call<{ columns?: DiscoveryColumn[] }>(
    () =>
      api.get<ApiResult<{ columns: DiscoveryColumn[] }>>('/iqd/discovery/columns', {
        params: { connectionId, schema, table },
      }),
    '获取列清单失败',
  );
  return data?.columns ?? [];
}

// ================================================================ 导入（写路径）

/**
 * 批量导入表（`mode=create_or_skip` 幂等）。`POST /api/v1/iqd/discovery/import`。
 *
 * <p>⚠️ **不要自作主张传 `in_scope: true`**：T02a 已按 PRD §6.3 把服务端默认值回退为
 * `false`（「导入 ≠ 可问」）。是否纳入问数范围由用户在 `/iqd/scope` 勾选决定；
 * 本方法仅在调用方**显式**给出 `in_scope` 时透传。
 */
export async function importTables(body: ImportTablesRequest): Promise<ImportTablesResult> {
  return call(
    () => api.post<ApiResult<ImportTablesResult>>('/iqd/discovery/import', body),
    '导入表失败',
  );
}
