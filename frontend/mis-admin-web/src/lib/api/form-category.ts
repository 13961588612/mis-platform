/**
 * 表单分类（form_category）API（对齐后端 `FormCategoryVO`）。
 *
 * <p>端点来自 BFF `FormCategoryController`（`@RequestMapping("/api/v1/form-categories")`）：
 * `GET /tree`（嵌套 children）、`GET`（扁平列表）、`GET /{id}`、`POST`、`PUT /{id}`、`DELETE /{id}`。
 *
 * <p>⚠️ **路径逐字对齐**：BFF 在 `deny-unmapped:true` 下每个对外路径都必须在 `sys_api` 登记，
 * 路径写错一处（比如误写成 `/form-category`）就会落成 403。本文件严格沿用
 * `FormCategoryController` 的 `@RequestMapping` + 各 `@*Mapping` 片段。
 *
 * <p>字段对照（`FormCategoryVO` 是 `record`）：
 * `id`(String) / `tenantId`(String) / `parentId`(Long) / `code`(String) / `name`(String) /
 * `description`(String) / `sortOrder`(Integer) / `config`(String) / `children` / `createdAt` / `updatedAt`。
 *
 * <p>⚠️ `id` 是后端 `String`（注意与 `FormDefinitionVO.categoryId` 的 `Long/number` 不一致——
 * 比对时用 `String()` 归一化）。`parentId` 为 `null` 表示根节点。
 */
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

export interface FormCategoryItem {
  id: string;
  tenantId: string;
  parentId: number | null;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number | null;
  config: string | null;
  /** 仅树接口填充；列表接口为 null。 */
  children: FormCategoryItem[] | null;
  createdAt: string;
  updatedAt: string;
}

/** 新建/更新请求体（对齐后端 `UpsertFormCategoryRequest`）。`parentId=null` 表示根节点。 */
export interface UpsertFormCategoryRequest {
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
export async function fetchFormCategoryTree(tenantId: string): Promise<FormCategoryItem[]> {
  const res = await api.get<ApiResult<FormCategoryItem[] | null>>('/form-categories/tree', {
    params: { tenantId },
  });
  return unwrap(res, '获取表单分类树失败') ?? [];
}

/** 扁平列表接口（无 children）：用于下拉候选、id→name 映射等。 */
export async function fetchFormCategories(tenantId: string): Promise<FormCategoryItem[]> {
  const res = await api.get<ApiResult<FormCategoryItem[] | null>>('/form-categories', {
    params: { tenantId },
  });
  return unwrap(res, '获取表单分类列表失败') ?? [];
}

/** 单条详情（`GET /api/v1/form-categories/{id}`）。 */
export async function getFormCategory(id: string, tenantId: string): Promise<FormCategoryItem> {
  const res = await api.get<ApiResult<FormCategoryItem>>(`/form-categories/${id}`, {
    params: { tenantId },
  });
  return unwrap(res, '获取表单分类失败');
}

/**
 * 新建（`POST /api/v1/form-categories?tenantId=&operatorId=`），返回新 id（number）。
 *
 * <p>⚠️ BFF `create` 比 `update` 多收一个 `operatorId` 参数（与表单定义一致），
 * 调用方须传入，否则后端 `TaskflowIdentity.tenantId` 兜底可能落空。
 */
export async function createFormCategory(
  tenantId: string,
  operatorId: string,
  body: UpsertFormCategoryRequest,
): Promise<number> {
  const res = await api.post<ApiResult<number>>('/form-categories', body, {
    params: { tenantId, operatorId },
  });
  return unwrap(res, '创建表单分类失败');
}

/** 更新（`PUT /api/v1/form-categories/{id}?tenantId=`）。 */
export async function updateFormCategory(
  id: string,
  tenantId: string,
  body: UpsertFormCategoryRequest,
): Promise<void> {
  const res = await api.put<ApiResult<null>>(`/form-categories/${id}`, body, {
    params: { tenantId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '更新表单分类失败');
}

/** 删除（`DELETE /api/v1/form-categories/{id}?tenantId=`）。 */
export async function deleteFormCategory(id: string, tenantId: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/form-categories/${id}`, {
    params: { tenantId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '删除表单分类失败');
}
