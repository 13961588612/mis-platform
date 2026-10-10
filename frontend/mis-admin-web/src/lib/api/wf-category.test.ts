// @vitest-environment node
/**
 * wf-category API 层单测（T09）：逐一确认前端路径与 BFF `WfCategoryController`
 * （`@RequestMapping("/api/v1/workflow/categories")`）逐字一致，且字段透传正确。
 *
 * <p>BFF 在 `deny-unmapped:true` 下每个对外路径都需登记，路径写错一字即 403，
 * 所以这里显式断言请求 path 与 params。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api/client';
import * as wfCategory from '@/lib/api/wf-category';
import type { WfCategoryItem } from '@/lib/api/wf-category';

vi.mock('@/lib/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const apiMock = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const sampleTree: WfCategoryItem[] = [
  {
    id: '990001',
    tenantId: '1',
    parentId: 0,
    code: 'APPROVAL',
    name: '审批类',
    description: null,
    sortOrder: 0,
    config: null,
    children: null,
    createdAt: '2024-01-01T00:00:00',
    updatedAt: '2024-01-01T00:00:00',
  },
];

const sampleList: WfCategoryItem[] = [{ ...sampleTree[0] }];

describe('wf-category API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetchWfCategoryTree 命中 /workflow/categories/tree 并透传 tenantId', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 0, data: sampleTree } });
    const r = await wfCategory.fetchWfCategoryTree('1');
    expect(apiMock.get).toHaveBeenCalledWith('/workflow/categories/tree', { params: { tenantId: '1' } });
    expect(r).toEqual(sampleTree);
  });

  it('fetchWfCategories 命中 /workflow/categories（列表）', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 0, data: sampleList } });
    const r = await wfCategory.fetchWfCategories('1');
    expect(apiMock.get).toHaveBeenCalledWith('/workflow/categories', { params: { tenantId: '1' } });
    expect(r).toEqual(sampleList);
  });

  it('getWfCategory 命中 /workflow/categories/{id}', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 0, data: sampleTree[0] } });
    const r = await wfCategory.getWfCategory('990001', '1');
    expect(apiMock.get).toHaveBeenCalledWith('/workflow/categories/990001', { params: { tenantId: '1' } });
    expect(r.id).toBe('990001');
  });

  it('createWfCategory POST /workflow/categories 且带 tenantId + operatorId', async () => {
    apiMock.post.mockResolvedValue({ data: { code: 0, data: 990001 } });
    const body: wfCategory.UpsertWfCategoryRequest = {
      code: 'APPROVAL',
      name: '审批类',
      description: null,
      sortOrder: 0,
      parentId: null,
      config: null,
    };
    const id = await wfCategory.createWfCategory('1', '1', body);
    expect(apiMock.post).toHaveBeenCalledWith('/workflow/categories', body, {
      params: { tenantId: '1', operatorId: '1' },
    });
    expect(id).toBe(990001);
  });

  it('updateWfCategory PUT /workflow/categories/{id} 带 tenantId', async () => {
    apiMock.put.mockResolvedValue({ data: { code: 0, message: 'ok', data: null } });
    const body: wfCategory.UpsertWfCategoryRequest = {
      code: 'APPROVAL',
      name: '审批类',
      description: 'x',
      sortOrder: 1,
      parentId: null,
      config: null,
    };
    await wfCategory.updateWfCategory('990001', '1', body);
    expect(apiMock.put).toHaveBeenCalledWith('/workflow/categories/990001', body, {
      params: { tenantId: '1' },
    });
  });

  it('deleteWfCategory DELETE /workflow/categories/{id} 带 tenantId', async () => {
    apiMock.delete.mockResolvedValue({ data: { code: 0, message: 'ok', data: null } });
    await wfCategory.deleteWfCategory('990001', '1');
    expect(apiMock.delete).toHaveBeenCalledWith('/workflow/categories/990001', {
      params: { tenantId: '1' },
    });
  });

  it('后端 code !== 0 时抛错（不静默）', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 1, message: '无权限', data: null } });
    await expect(wfCategory.fetchWfCategoryTree('1')).rejects.toThrow('无权限');
  });
});
