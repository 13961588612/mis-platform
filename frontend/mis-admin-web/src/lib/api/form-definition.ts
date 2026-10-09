/**
 * 业务表单注册项 API（对齐后端 `FormDefinitionVO`）。
 *
 * <p>端点来自 BFF `FormDefinitionController`（`@RequestMapping("/api/v1/form-definitions")`）：
 * `GET /tree`、`GET`（列表，可带 `status`）、`GET /{id}`、`POST`、`PUT /{id}`、`DELETE /{id}`。
 *
 * ⚠️ **没有 `/form-definitions/list` 这个路径**——列表就是 `GET /api/v1/form-definitions`。
 * 写错路径在 `deny-unmapped:true` 下会落成 403。
 */
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

export const FORM_STATUS_ENABLED = 'ENABLED';
export const FORM_STATUS_DISABLED = 'DISABLED';

export interface FormDefinitionItem {
  id: string;
  tenantId: string;
  parentId: number | null;
  /** = 前端注册表 / 加载表的 key，大小写敏感。 */
  code: string;
  name: string;
  description: string | null;
  /** ENABLED / DISABLED。 */
  status: string;
  sortOrder: number | null;
  config: string | null;
  /** 仅树接口填充；列表接口为 null。 */
  children: FormDefinitionItem[] | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function unwrapList(res: { data: ApiResult<FormDefinitionItem[] | null> }): FormDefinitionItem[] {
  if (res.data.code !== 0) throw new Error(res.data.message || '获取表单清单失败');
  return res.data.data ?? [];
}

/** 全量列表（可带 status 过滤）。`status` 为空时后端返回全部（含停用）。 */
export async function fetchFormDefinitions(
  tenantId: string,
  status?: string,
): Promise<FormDefinitionItem[]> {
  const res = await api.get<ApiResult<FormDefinitionItem[] | null>>('/form-definitions', {
    params: { tenantId, status },
  });
  return unwrapList(res);
}

/**
 * 编排弹窗的候选项来源：只要启用中的。
 *
 * ⚠️ 失败时**不吞异常**，由调用方降级——让调用方决定「后端不可用」时该怎么办，
 * 比在这里返回空数组更能避免「下拉空白但没有任何提示」的静默失败。
 */
export async function fetchEnabledFormDefinitions(tenantId: string): Promise<FormDefinitionItem[]> {
  return fetchFormDefinitions(tenantId, FORM_STATUS_ENABLED);
}
