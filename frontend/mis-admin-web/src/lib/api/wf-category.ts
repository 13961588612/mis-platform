/**
 * 流程分类（wf_category）API（对齐后端 `WfCategoryVO`）。
 *
 * <p>端点来自 BFF `WfCategoryController`（`@RequestMapping("/api/v1/workflow/categories")`）：
 * `GET /tree`（嵌套 children）、`GET`（扁平列表）、`GET /{id}`、`POST`、`PUT /{id}`、`DELETE /{id}`。
 *
 * <p>⚠️ **路径逐字对齐**：BFF 在 `deny-unmapped:true` 下每个对外路径都必须在 `sys_api` 登记，
 * 路径写错一处（比如误写成 `/workflow/category`）就会落成 403。本文件严格沿用
 * `WfCategoryController` 的 `@RequestMapping` + 各 `@*Mapping` 片段。
 *
 * <p>字段对照（`WfCategoryVO` 是 `record`）：
 * `id`(String) / `tenantId`(String) / `parentId`(Long) / `code`(String) / `name`(String) /
 * `description`(String) / `sortOrder`(Integer) / `config`(String) / `children` / `createdAt` / `updatedAt`。
 *
 * <p>⚠️ `id` 是后端 `String`（注意与 `WfDefinition.categoryId` 的 `Long/number` 不一致——
 * 比对时用 `String()` 归一化）。`parentId` 为 `null` 表示根节点。
 */
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

export interface WfCategoryItem {
  id: string;
  tenantId: string;
  parentId: number | null;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number | null;
  config: string | null;
  /** 仅树接口填充；列表接口为 null。 */
  children: WfCategoryItem[] | null;
  createdAt: string;
  updatedAt: string;
}

/** 新建/更新请求体（对齐后端 `UpsertWfCategoryRequest`）。`parentId=null` 表示根节点。 */
export interface UpsertWfCategoryRequest {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number | null;
  parentId: number | null;
  config: string | null;
}

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

/** 树接口（嵌套 children）：用于分类管理树。 */
export async function fetchWfCategoryTree(tenantId: string): Promise<WfCategoryItem[]> {
  const res = await api.get<ApiResult<WfCategoryItem[] | null>>('/workflow/categories/tree', {
    params: { tenantId },
  });
  return unwrap(res, '获取流程分类树失败') ?? [];
}

/** 扁平列表接口（无 children）：用于下拉候选、引用计数等。 */
export async function fetchWfCategories(tenantId: string): Promise<WfCategoryItem[]> {
  const res = await api.get<ApiResult<WfCategoryItem[] | null>>('/workflow/categories', {
    params: { tenantId },
  });
  return unwrap(res, '获取流程分类列表失败') ?? [];
}

/** 单条详情（`GET /api/v1/workflow/categories/{id}`）。 */
export async function getWfCategory(id: string, tenantId: string): Promise<WfCategoryItem> {
  const res = await api.get<ApiResult<WfCategoryItem>>(`/workflow/categories/${id}`, {
    params: { tenantId },
  });
  return unwrap(res, '获取流程分类失败');
}

/**
 * 新建（`POST /api/v1/workflow/categories?tenantId=&operatorId=`），返回新 id（number）。
 *
 * <p>⚠️ BFF `create` 比 `update` 多收一个 `operatorId` 参数（与表单定义一致），
 * 调用方须传入，否则后端 `TaskflowIdentity.tenantId` 兜底可能落空。
 */
export async function createWfCategory(
  tenantId: string,
  operatorId: string,
  body: UpsertWfCategoryRequest,
): Promise<number> {
  const res = await api.post<ApiResult<number>>('/workflow/categories', body, {
    params: { tenantId, operatorId },
  });
  return unwrap(res, '创建流程分类失败');
}

/** 更新（`PUT /api/v1/workflow/categories/{id}?tenantId=`）。 */
export async function updateWfCategory(
  id: string,
  tenantId: string,
  body: UpsertWfCategoryRequest,
): Promise<void> {
  const res = await api.put<ApiResult<null>>(`/workflow/categories/${id}`, body, {
    params: { tenantId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '更新流程分类失败');
}

/** 删除（`DELETE /api/v1/workflow/categories/{id}?tenantId=`）。 */
export async function deleteWfCategory(id: string, tenantId: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/workflow/categories/${id}`, {
    params: { tenantId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '删除流程分类失败');
}
