// @vitest-environment jsdom
/**
 * 【QA 独立验证 · B】`usePortalLookups` 取值映射的**单元级**三态契约。
 *
 * <p><b>为什么要单独直测 hook</b>：需求把「业务类型 `null → —`」列为表格契约，但待办源
 * 的 `TaskItem.bizType` 在类型上是**非空 string**（`lib/api/tasks.ts`），消息源的
 * `MessageItem.bizType` 才是可空；`WfInstance.businessType` 亦非空。也就是说「待办源
 * bizType=null」在类型层面不可达，只能在**函数级**验证该分支确实存在且正确——否则该
 * 分支会变成无人守的裸分支。本文件用 `renderHook` 直接钉住 `appNameOf` / `bizTypeNameOf`
 * 的全部三态 + 静默降级。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as platformApi from '@/lib/api/platform';
import * as bizCategoryApi from '@/lib/api/biz-category';
import { EMPTY_BIZ_TYPE_LABEL, PLATFORM_LABEL, usePortalLookups } from './use-portal-lookups';
import type { BizCategoryItem } from '@/lib/api/biz-category';
import type { AppItem } from '@/types/api';

vi.mock('@/lib/api/platform', () => ({ fetchApps: vi.fn() }));
vi.mock('@/lib/api/biz-category', () => ({ fetchBizCategories: vi.fn() }));

function app(code: string, name: string): AppItem {
  return {
    id: '1',
    tenantId: '1',
    code,
    name,
    icon: null,
    basePath: null,
    description: null,
    portalGroup: null,
    kind: 'app',
    runtime: 'host',
    sort: 1,
    status: 1,
    enterable: true,
  };
}

function bizCategory(code: string, name: string): BizCategoryItem {
  return {
    id: '1',
    tenantId: '1',
    parentId: null,
    code,
    name,
    description: null,
    sortOrder: 1,
    config: null,
    children: null,
    createdAt: '2026-10-01T00:00:00',
    updatedAt: '2026-10-01T00:00:00',
  };
}

beforeEach(() => {
  vi.mocked(platformApi.fetchApps).mockResolvedValue([]);
  vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('[QA-B] usePortalLookups · appNameOf 三态', () => {
  it('null/undefined → 「平台」（平台级）', () => {
    const { result } = renderHook(() => usePortalLookups('1'));
    expect(result.current.appNameOf(null)).toBe(PLATFORM_LABEL);
    expect(result.current.appNameOf(null)).toBe('平台');
    expect(result.current.appNameOf(undefined)).toBe('平台');
  });

  it('命中应用列表 → name；未命中 → 回退原始 code', async () => {
    vi.mocked(platformApi.fetchApps).mockResolvedValue([app('kb', '知识库')]);
    const { result } = renderHook(() => usePortalLookups('1'));

    await waitFor(() => expect(result.current.appNameOf('kb')).toBe('知识库'));
    expect(result.current.appNameOf('ghost')).toBe('ghost');
    // null 分支在列表就绪后仍然成立（不被空表覆盖）。
    expect(result.current.appNameOf(null)).toBe('平台');
  });

  it('fetchApps 拉取失败 → 静默降级：非空回退 code，null 仍「平台」', async () => {
    vi.mocked(platformApi.fetchApps).mockRejectedValue(new Error('apps down'));
    const { result } = renderHook(() => usePortalLookups('1'));
    // 失败不抛、不阻断渲染：映射器照常可用。
    await waitFor(() => expect(platformApi.fetchApps).toHaveBeenCalled());
    expect(result.current.appNameOf('kb')).toBe('kb');
    expect(result.current.appNameOf(null)).toBe('平台');
  });
});

describe('[QA-B] usePortalLookups · bizTypeNameOf 三态', () => {
  it('null/undefined → 「—」', () => {
    const { result } = renderHook(() => usePortalLookups('1'));
    expect(result.current.bizTypeNameOf(null)).toBe(EMPTY_BIZ_TYPE_LABEL);
    expect(result.current.bizTypeNameOf(null)).toBe('—');
    expect(result.current.bizTypeNameOf(undefined)).toBe('—');
  });

  it('命中业务分类 → name（UNCATEGORIZED 亦然）；未命中 → 回退原始 code', async () => {
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([
      bizCategory('PURCHASE_ORDER', '采购订单'),
      bizCategory('UNCATEGORIZED', '未分类'),
    ]);
    const { result } = renderHook(() => usePortalLookups('1'));

    await waitFor(() => expect(result.current.bizTypeNameOf('PURCHASE_ORDER')).toBe('采购订单'));
    expect(result.current.bizTypeNameOf('UNCATEGORIZED')).toBe('未分类');
    expect(result.current.bizTypeNameOf('GHOST')).toBe('GHOST');
    expect(result.current.bizTypeNameOf(null)).toBe('—');
  });

  it('fetchBizCategories 失败 → 静默降级回退 code', async () => {
    vi.mocked(bizCategoryApi.fetchBizCategories).mockRejectedValue(new Error('cats down'));
    const { result } = renderHook(() => usePortalLookups('1'));
    await waitFor(() => expect(bizCategoryApi.fetchBizCategories).toHaveBeenCalled());
    expect(result.current.bizTypeNameOf('PURCHASE_ORDER')).toBe('PURCHASE_ORDER');
    expect(result.current.bizTypeNameOf(null)).toBe('—');
  });

  it('tenantId 为空串 → 不发起业务分类请求（避免无租户请求）', async () => {
    renderHook(() => usePortalLookups(''));
    await waitFor(() => expect(platformApi.fetchApps).toHaveBeenCalled());
    expect(bizCategoryApi.fetchBizCategories).not.toHaveBeenCalled();
  });
});
