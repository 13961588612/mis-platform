// @vitest-environment node
/**
 * biz-category API 层单测：逐一确认前端路径与 BFF `BizCategoryController`
 * （`@RequestMapping("/api/v1/biz-categories")`）逐字一致，且字段透传正确。
 *
 * <p>BFF 在 `deny-unmapped:true` 下每个对外路径都需登记，路径写错一字即 403，
 * 所以这里显式断言请求 path 与 params。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api/client';
import * as bizCategory from '@/lib/api/biz-category';
import type { BizCategoryItem } from '@/lib/api/biz-category';

vi.mock('@/lib/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const apiMock = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const sampleTree: BizCategoryItem[] = [
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

const sampleList: BizCategoryItem[] = [{ ...sampleTree[0] }];

describe('biz-category API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetchBizCategoryTree 命中 /biz-categories/tree 并透传 tenantId', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 0, data: sampleTree } });
    const r = await bizCategory.fetchBizCategoryTree('1');
    expect(apiMock.get).toHaveBeenCalledWith('/biz-categories/tree', { params: { tenantId: '1' } });
    expect(r).toEqual(sampleTree);
  });

  it('fetchBizCategories 命中 /biz-categories（列表）', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 0, data: sampleList } });
    const r = await bizCategory.fetchBizCategories('1');
    expect(apiMock.get).toHaveBeenCalledWith('/biz-categories', { params: { tenantId: '1' } });
    expect(r).toEqual(sampleList);
  });

  it('getBizCategory 命中 /biz-categories/{id}', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 0, data: sampleTree[0] } });
    const r = await bizCategory.getBizCategory('990001', '1');
    expect(apiMock.get).toHaveBeenCalledWith('/biz-categories/990001', { params: { tenantId: '1' } });
    expect(r.id).toBe('990001');
  });

  it('createBizCategory POST /biz-categories 且带 tenantId + operatorId', async () => {
    apiMock.post.mockResolvedValue({ data: { code: 0, data: 990001 } });
    const body: bizCategory.UpsertBizCategoryRequest = {
      code: 'APPROVAL',
      name: '审批类',
      description: null,
      sortOrder: 0,
      parentId: null,
      config: null,
    };
    const id = await bizCategory.createBizCategory('1', '1', body);
    expect(apiMock.post).toHaveBeenCalledWith('/biz-categories', body, {
      params: { tenantId: '1', operatorId: '1' },
    });
    expect(id).toBe(990001);
  });

  it('updateBizCategory PUT /biz-categories/{id} 带 tenantId', async () => {
    apiMock.put.mockResolvedValue({ data: { code: 0, message: 'ok', data: null } });
    const body: bizCategory.UpsertBizCategoryRequest = {
      code: 'APPROVAL',
      name: '审批类',
      description: 'x',
      sortOrder: 1,
      parentId: null,
      config: null,
    };
    await bizCategory.updateBizCategory('990001', '1', body);
    expect(apiMock.put).toHaveBeenCalledWith('/biz-categories/990001', body, {
      params: { tenantId: '1' },
    });
  });

  it('deleteBizCategory DELETE /biz-categories/{id} 带 tenantId', async () => {
    apiMock.delete.mockResolvedValue({ data: { code: 0, message: 'ok', data: null } });
    await bizCategory.deleteBizCategory('990001', '1');
    expect(apiMock.delete).toHaveBeenCalledWith('/biz-categories/990001', {
      params: { tenantId: '1' },
    });
  });

  it('后端 code !== 0 时抛错（不静默）', async () => {
    apiMock.get.mockResolvedValue({ data: { code: 1, message: '无权限', data: null } });
    await expect(bizCategory.fetchBizCategoryTree('1')).rejects.toThrow('无权限');
  });
});
