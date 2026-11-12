// @vitest-environment jsdom
/**
 * LinkFormsDialog：V149 起只读反查已关联表单，无保存。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LinkFormsDialog } from './link-forms-dialog';
import type { WfDefinition } from '@/lib/api/workflow';

vi.mock('./form-catalog', () => ({
  useFormCatalog: () => ({
    options: [
      { code: 'PUR_FORM', name: '采购单' },
      { code: 'OTHER', name: '其它' },
    ],
    loading: false,
    notice: null,
  }),
}));

const current: WfDefinition = {
  id: '10',
  tenantId: '1',
  code: 'PUR_APPROVAL',
  name: '采购审批',
  category: '',
  categoryId: null,
  description: null,
  version: 1,
  status: 'ACTIVE',
  supportedFormCodes: ['PUR_FORM'],
  formSchema: null,
  config: '{}',
  nodes: [],
  edges: null,
  createdAt: '',
  updatedAt: '',
};

describe('LinkFormsDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {});

  it('只读展示已关联表单，无保存按钮', () => {
    render(
      <LinkFormsDialog open onOpenChange={vi.fn()} definition={current} onSaved={vi.fn()} />,
    );
    expect(screen.getByText('采购单')).toBeTruthy();
    expect(screen.getByText(/只读反查/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(screen.getByTestId('link-forms-close')).toBeTruthy();
  });

  it('无关联时给出去表单注册的提示', () => {
    render(
      <LinkFormsDialog
        open
        onOpenChange={vi.fn()}
        definition={{ ...current, supportedFormCodes: [] }}
      />,
    );
    expect(screen.getByText(/暂无关联表单/)).toBeTruthy();
  });

  it('点关闭回调 onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(<LinkFormsDialog open onOpenChange={onOpenChange} definition={current} />);
    fireEvent.click(screen.getByTestId('link-forms-close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

