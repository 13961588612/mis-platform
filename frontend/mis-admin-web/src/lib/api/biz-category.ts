/**
 * 业务分类（biz_category）API（对齐后端 `BizCategoryVO`）。
 *
 * <p>业务分类是**租户通用**的邻接树，与 APP 无关：流程定义（`wf_definition.category_id`）与
 * 表单定义（`form_definition.category_id`）都改为关联本分类；叶子节点即「业务类型」，其
 * `code` 即业务类型编码。固定兜底节点 id=991001、code=UNCATEGORIZED、name=未分类。
 *
 * <p>端点来自 BFF `BizCategoryController`（`@RequestMapping("/api/v1/biz-categories")`）：
 * `GET /tree`（嵌套 children）、`GET`（扁平列表）、`GET /{id}`、`POST`、`PUT /{id}`、`DELETE /{id}`。
 *
 * <p>⚠️ **路径逐字对齐**：BFF 在 `deny-unmapped:true` 下每个对外路径都必须在 `sys_api` 登记
 * （V139 的 95093-95098），路径写错一处就会落成 403。本文件严格沿用
 * `BizCategoryController` 的 `@RequestMapping` + 各 `@*Mapping` 片段。
 *
 * <p>字段对照（`BizCategoryVO` 是 `record`）：
 * `id`(String) / `tenantId`(String) / `parentId`(Long) / `code`(String) / `name`(String) /
 * `description`(String) / `sortOrder`(Integer) / `config`(String) / `children` / `createdAt` / `updatedAt`。
 *
 * <p>⚠️ `id` 是后端 `String`（注意与 `WfDefinition.categoryId` 的 `Long/number` 不一致——
 * 比对时用 `String()` 归一化）。`parentId` 为 `null` 表示根节点。
 */
import api from '@/lib/api/client';
import type { ApiResult } from '@/types/api';

export interface BizCategoryItem {
  id: string;
  tenantId: string;
  parentId: number | null;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number | null;
  config: string | null;
  /** 仅树接口填充；列表接口为 null。 */
  children: BizCategoryItem[] | null;
  createdAt: string;
  updatedAt: string;
}

/** 新建/更新请求体（对齐后端 `UpsertBizCategoryRequest`）。`parentId=null` 表示根节点。 */
export interface UpsertBizCategoryRequest {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number | null;
  parentId: number | null;
  config: string | null;
}

/** 兜底「未分类」节点固定 id（对齐 V138 种子与后端 `BizCategoryService.UNCATEGORIZED_ID`）。 */
export const UNCATEGORIZED_ID = '991001';
/** 兜底「未分类」节点固定 code。 */
export const UNCATEGORIZED_CODE = 'UNCATEGORIZED';

function unwrap<T>(res: { data: ApiResult<T> }, fallback: string): T {
  if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
    throw new Error(res.data.message || fallback);
  }
  return res.data.data;
}

/** 树接口（嵌套 children）：用于分类管理树。 */
export async function fetchBizCategoryTree(tenantId: string): Promise<BizCategoryItem[]> {
  const res = await api.get<ApiResult<BizCategoryItem[] | null>>('/biz-categories/tree', {
    params: { tenantId },
  });
  return unwrap(res, '获取业务分类树失败') ?? [];
}

/** 扁平列表接口（无 children）：用于下拉候选、引用计数等。 */
export async function fetchBizCategories(tenantId: string): Promise<BizCategoryItem[]> {
  const res = await api.get<ApiResult<BizCategoryItem[] | null>>('/biz-categories', {
    params: { tenantId },
  });
  return unwrap(res, '获取业务分类列表失败') ?? [];
}

/** 单条详情（`GET /api/v1/biz-categories/{id}`）。 */
export async function getBizCategory(id: string, tenantId: string): Promise<BizCategoryItem> {
  const res = await api.get<ApiResult<BizCategoryItem>>(`/biz-categories/${id}`, {
    params: { tenantId },
  });
  return unwrap(res, '获取业务分类失败');
}

/**
 * 新建（`POST /api/v1/biz-categories?tenantId=&operatorId=`），返回新 id（number）。
 *
 * <p>⚠️ BFF `create` 比 `update` 多收一个 `operatorId` 参数（与表单定义一致），
 * 调用方须传入，否则后端 `TaskflowIdentity.tenantId` 兜底可能落空。
 */
export async function createBizCategory(
  tenantId: string,
  operatorId: string,
  body: UpsertBizCategoryRequest,
): Promise<number> {
  const res = await api.post<ApiResult<number>>('/biz-categories', body, {
    params: { tenantId, operatorId },
  });
  return unwrap(res, '创建业务分类失败');
}

/** 更新（`PUT /api/v1/biz-categories/{id}?tenantId=`）。 */
export async function updateBizCategory(
  id: string,
  tenantId: string,
  body: UpsertBizCategoryRequest,
): Promise<void> {
  const res = await api.put<ApiResult<null>>(`/biz-categories/${id}`, body, {
    params: { tenantId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '更新业务分类失败');
}

/** 删除（`DELETE /api/v1/biz-categories/{id}?tenantId=`）。 */
export async function deleteBizCategory(id: string, tenantId: string): Promise<void> {
  const res = await api.delete<ApiResult<null>>(`/biz-categories/${id}`, {
    params: { tenantId },
  });
  if (res.data.code !== 0) throw new Error(res.data.message || '删除业务分类失败');
}
