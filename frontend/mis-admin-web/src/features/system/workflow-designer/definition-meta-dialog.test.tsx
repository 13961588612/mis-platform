// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchDefinitions = vi.fn();
const fetchBizCategoryTree = vi.fn();

vi.mock('@/lib/api/workflow', () => ({
  fetchDefinitions: (...args: unknown[]) => fetchDefinitions(...args),
}));

vi.mock('@/lib/api/biz-category', () => ({
  fetchBizCategories: vi.fn().mockResolvedValue([]),
  fetchBizCategoryTree: (...args: unknown[]) => fetchBizCategoryTree(...args),
}));

describe('DefinitionDialog meta', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('提交时 supportedFormCodes 为空；无表单多选', async () => {
    fetchDefinitions.mockResolvedValue({ page: 1, size: 100, total: 0, list: [] });
    fetchBizCategoryTree.mockResolvedValue([]);
    const { DefinitionDialog } = await import('./definition-dialog');
    const onSubmit = vi.fn();
    render(<DefinitionDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);
    expect(screen.queryByLabelText('搜索表单')).toBeNull();
    fireEvent.change(screen.getByLabelText('流程名称'), { target: { value: '采购审批流程' } });
    fireEvent.change(screen.getByLabelText('流程编码'), { target: { value: 'PUR_APPROVAL' } });
    fireEvent.click(screen.getByText('下一步：编排'));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PUR_APPROVAL', supportedFormCodes: [] }),
      ),
    );
  });

  it('编码非法不查重', async () => {
    fetchDefinitions.mockResolvedValue({ page: 1, size: 100, total: 0, list: [] });
    fetchBizCategoryTree.mockResolvedValue([]);
    const { DefinitionDialog } = await import('./definition-dialog');
    render(<DefinitionDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('流程名称'), { target: { value: '采购审批流程' } });
    fireEvent.change(screen.getByLabelText('流程编码'), { target: { value: 'pur_approval' } });
    fireEvent.click(screen.getByText('下一步：编排'));
    await waitFor(() => expect(screen.getByText(/编码须以大写字母开头/)).toBeTruthy());
    expect(fetchDefinitions).not.toHaveBeenCalled();
  });
});
