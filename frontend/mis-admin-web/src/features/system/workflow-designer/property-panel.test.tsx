// @vitest-environment jsdom
/**
 * PropertyPanel 单测（表单关联已移出编排，本文件聚焦分类与全局属性）。
 *
 * 覆盖：
 * 1. 编排全局属性不再展示表单白名单多选
 * 2. 分类是 biz_category 下拉树，选中回传 categoryId
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PropertyPanel, type FlowMeta } from './property-panel';
import * as bizCategoryApi from '@/lib/api/biz-category';

vi.mock('@/lib/api/biz-category', () => ({
  fetchBizCategories: vi.fn(),
  fetchBizCategoryTree: vi.fn(),
}));

const CATEGORIES = [
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
    createdAt: '',
    updatedAt: '',
  },
  {
    id: '990002',
    tenantId: '1',
    parentId: 0,
    code: 'NOTICE',
    name: '通知类',
    description: null,
    sortOrder: 1,
    config: null,
    children: null,
    createdAt: '',
    updatedAt: '',
  },
];

const meta: FlowMeta = {
  code: 'PUR_APPROVAL',
  name: '采购审批',
  categoryId: null,
  description: '',
  supportedFormCodes: '',
};

function renderPanel(overrides: Partial<FlowMeta> = {}) {
  const onChange = vi.fn();
  render(
    <PropertyPanel
      selected={null}
      flowMeta={{ ...meta, ...overrides }}
      onFlowMetaChange={onChange}
      onNodeChange={vi.fn()}
      onDeleteNode={vi.fn()}
    />,
  );
  return onChange;
}

describe('PropertyPanel 全局属性', () => {
  beforeEach(() => {
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue(CATEGORIES);
    vi.mocked(bizCategoryApi.fetchBizCategoryTree).mockResolvedValue(CATEGORIES);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('编排内不再展示表单白名单多选', () => {
    renderPanel();
    expect(screen.queryByTestId('multi-select-trigger')).toBeNull();
    expect(screen.getByText(/表单关联请在流程定义列表中操作/)).toBeTruthy();
  });

  it('分类是 biz_category 下拉树，选中回传 categoryId', async () => {
    const onChange = renderPanel();

    const trigger = (await screen.findByLabelText('分类')) as HTMLButtonElement;
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toContain('未分类');

    fireEvent.click(trigger);
    const node = await screen.findByRole('button', { name: '审批类' });
    expect(screen.getByRole('button', { name: '通知类' })).toBeTruthy();
    fireEvent.pointerDown(node, { button: 0 });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 990001 })),
    );
  });
});
