/**
 * 业务表单注册项 API（对齐后端 `FormDefinitionVO`）。
 *
 * <p>端点来自 BFF `FormDefinitionController`（`@RequestMapping("/api/v1/form-definitions")`）：
 * `GET /tree`、`GET`（列表，可带 `status`、`kind`）、`GET /{id}`、`POST`、`PUT /{id}`、`DELETE /{id}`。
 *
 * ⚠️ **没有 `/form-definitions/list` 这个路径**——列表就是 `GET /api/v1/form-definitions`。
 * 写错路径在 `deny-unmapped:true` 下会落成 403。
 *
 * <p>V131 起 `FormDefinitionVO` 新增 `kind`（CATEGORY / FORM），同一张 `form_definition` 表
 * 同时承载「分类节点」与「表单节点」。`fetchFormDefinitions` / `fetchFormDefinitionTree` 透传
 * `kind` 给后端做服务端过滤；不传则返回全部（含两种 kind）。
 */
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

export const FORM_STATUS_ENABLED = 'ENABLED';
export const FORM_STATUS_DISABLED = 'DISABLED';

/** 节点类型：分类 / 表单（V131 新增）。 */
export type FormKind = 'CATEGORY' | 'FORM';

export const FORM_KIND_CATEGORY: FormKind = 'CATEGORY';
export const FORM_KIND_FORM: FormKind = 'FORM';

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
  /** CATEGORY / FORM（V131 新增）。分类节点与表单节点共用同一张表。 */
  kind: FormKind;
}

function unwrapList(res: { data: ApiResult<FormDefinitionItem[] | null> }): FormDefinitionItem[] {
  if (res.data.code !== 0) throw new Error(res.data.message || '获取表单清单失败');
  return res.data.data ?? [];
}

/**
 * 全量列表（可带 status / kind 过滤）。
 *
 * <p>`status` 为空时后端返回全部（含停用）；`kind` 为空时返回 CATEGORY 与 FORM 两种节点，
 * 由调用方决定（双 Tab 下：分类 Tab 传 `CATEGORY`、表单 Tab 传 `FORM`）。
 */
export async function fetchFormDefinitions(
  tenantId: string,
  status?: string,
  kind?: FormKind,
): Promise<FormDefinitionItem[]> {
  const params: Record<string, unknown> = { tenantId };
  if (status) params.status = status;
  if (kind) params.kind = kind;
  const res = await api.get<ApiResult<FormDefinitionItem[] | null>>('/form-definitions', { params });
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

/**
 * 树接口（嵌套 children）：用于左侧分类树。
 *
 * <p>后端 `GET /api/v1/form-definitions/tree?tenantId=&kind=` 返回整棵分类树，
 * `children` 仅在此接口填充（列表接口为 null）。`kind` 透传时只返回该类型的子树。
 */
export async function fetchFormDefinitionTree(
  tenantId: string,
  kind?: FormKind,
): Promise<FormDefinitionItem[]> {
  const params: Record<string, unknown> = { tenantId };
  if (kind) params.kind = kind;
  const res = await api.get<ApiResult<FormDefinitionItem[] | null>>('/form-definitions/tree', { params });
  if (res.data.code !== 0) throw new Error(res.data.message || '获取表单定义树失败');
  return res.data.data ?? [];
}

/** 单条详情（`GET /api/v1/form-definitions/{id}`）。 */
export async function getFormDefinition(id: string, tenantId: string): Promise<FormDefinitionItem> {
  const res = await api.get<ApiResult<FormDefinitionItem | null>>(`/form-definitions/${id}`, {
    params: { tenantId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '获取表单定义失败');
  if (!res.data.data) throw new Error('表单定义不存在');
  return res.data.data;
}

/** 新建/更新请求体（对齐后端 `UpsertFormDefinitionRequest`）。 */
export interface UpsertFormDefinitionRequest {
  parentId: number | null;
  code: string;
  name: string;
  description: string | null;
  status: 'ENABLED' | 'DISABLED';
  sortOrder: number | null;
  config: string | null;
  /** CATEGORY / FORM（V131 新增）。 */
  kind: FormKind;
}

/** 编码正则：以大写字母开头，仅含大写字母/数字/下划线，长度 2-64。大小写敏感。 */
export const FORM_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/** 校验表单编码是否符合后端正则。 */
export function isValidFormCode(code: string): boolean {
  return FORM_CODE_PATTERN.test(code);
}

/**
 * 新建（`POST /api/v1/form-definitions?tenantId=&operatorId=`），返回新 id。
 *
 * <p>注意：列表/树接口返回的 `id` 是字符串，但请求体的 `parentId` 是 number
 * （后端契约不一致），调用方在拼 body 时需用 `Number(nodeId)` 转换。
 */
export async function createFormDefinition(
  tenantId: string,
  operatorId: string,
  body: UpsertFormDefinitionRequest,
): Promise<string> {
  const res = await api.post<ApiResult<string>>('/form-definitions', body, {
    params: { tenantId, operatorId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '创建表单定义失败');
  return res.data.data as string;
}

/** 更新（`PUT /api/v1/form-definitions/{id}`）。 */
export async function updateFormDefinition(
  id: string,
  tenantId: string,
  body: UpsertFormDefinitionRequest,
): Promise<void> {
  const res = await api.put<ApiResult<null>>(`/form-definitions/${id}`, body, {
    params: { tenantId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '更新表单定义失败');
}

/** 删除（`DELETE /api/v1/form-definitions/{id}`）。 */
export async function deleteFormDefinition(id: string, tenantId: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/form-definitions/${id}`, {
    params: { tenantId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '删除表单定义失败');
}
