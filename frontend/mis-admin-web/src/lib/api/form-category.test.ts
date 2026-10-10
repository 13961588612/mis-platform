// @vitest-environment node
/**
 * form-category API 层单测（V133）：逐一确认前端路径与 BFF `FormCategoryController`
 * （`@RequestMapping("/api/v1/form-categories")`）逐字一致，且字段透传正确。
 *
 * <p>BFF 在 `deny-unmapped:true` 下每个对外路径都需登记，路径写错一字即 403，
 * 所以这里显式断言请求 path 与 params。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api/client';
import * as formCategory from '@/lib/api/form-category';
import type { FormCategoryItem } from '@/lib/api/form-category';

vi.mock('@/lib/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const apiMock = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const sampleTree: FormCategoryItem[] = [
  {
    id: '1791607381266',
    tenantId: '1',
    parentId: 1791607381265,
    code: 'CRM',
    name: '会员',
    description: null,
    sortOrder: 0,
    config: null,
    children: null,
    createdAt: '2024-01-01T00:00:00',
    updatedAt: '2024-01-01T00:00:00',
  },
];

const sampleList: FormCategoryItem[] = [{ ...sampleTree[0] }];

describe('form-category API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetchFormCategoryTree 命中 /form-categories/tree 并透传 tenantId', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 0, data: sampleTree } });
    const r = await formCategory.fetchFormCategoryTree('1');
    expect(apiMock.get).toHaveBeenCalledWith('/form-categories/tree', { params: { tenantId: '1' } });
    expect(r).toEqual(sampleTree);
  });

  it('fetchFormCategories 命中 /form-categories（列表）', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 0, data: sampleList } });
    const r = await formCategory.fetchFormCategories('1');
    expect(apiMock.get).toHaveBeenCalledWith('/form-categories', { params: { tenantId: '1' } });
    expect(r).toEqual(sampleList);
  });

  it('getFormCategory 命中 /form-categories/{id}', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 0, data: sampleTree[0] } });
    const r = await formCategory.getFormCategory('1791607381266', '1');
    expect(apiMock.get).toHaveBeenCalledWith('/form-categories/1791607381266', { params: { tenantId: '1' } });
    expect(r.id).toBe('1791607381266');
  });

  it('createFormCategory POST /form-categories 且带 tenantId + operatorId', async () => {
    apiMock.post.mockResolvedValue({ data: { code: 0, data: 1791607381266 } });
    const body: formCategory.UpsertFormCategoryRequest = {
      code: 'CRM',
      name: '会员',
      description: null,
      sortOrder: 0,
      parentId: null,
      config: null,
    };
    const id = await formCategory.createFormCategory('1', '1', body);
    expect(apiMock.post).toHaveBeenCalledWith('/form-categories', body, {
      params: { tenantId: '1', operatorId: '1' },
    });
    expect(id).toBe(1791607381266);
  });

  it('updateFormCategory PUT /form-categories/{id} 带 tenantId', async () => {
    apiMock.put.mockResolvedValue({ data: { code: 0, message: 'ok', data: null } });
    const body: formCategory.UpsertFormCategoryRequest = {
      code: 'CRM',
      name: '会员',
      description: 'x',
      sortOrder: 1,
      parentId: 1791607381265,
      config: null,
    };
    await formCategory.updateFormCategory('1791607381266', '1', body);
    expect(apiMock.put).toHaveBeenCalledWith('/form-categories/1791607381266', body, {
      params: { tenantId: '1' },
    });
  });

  it('deleteFormCategory DELETE /form-categories/{id} 带 tenantId', async () => {
    apiMock.delete.mockResolvedValue({ data: { code: 0, message: 'ok', data: null } });
    await formCategory.deleteFormCategory('1791607381266', '1');
    expect(apiMock.delete).toHaveBeenCalledWith('/form-categories/1791607381266', {
      params: { tenantId: '1' },
    });
  });

  it('后端 code !== 0 时抛错（不静默）', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 1, message: '无权限', data: null } });
    await expect(formCategory.fetchFormCategoryTree('1')).rejects.toThrow('无权限');
  });
});
