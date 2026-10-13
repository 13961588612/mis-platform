// @vitest-environment jsdom
/**
 * LinkFormsDialog：左可选 / 右已选、互斥过滤、保存调 updateSupportedForms。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LinkFormsDialog } from './link-forms-dialog';
import * as workflowApi from '@/lib/api/workflow';
import * as formApi from '@/lib/api/form-definition';
import { __setFormLoadersForTest } from '@/features/biz/forms/forms/form-loaders';

vi.mock('@/lib/api/workflow', () => ({
  fetchDefinitions: vi.fn(),
  updateSupportedForms: vi.fn(),
}));

vi.mock('@/lib/api/form-definition', () => ({
  fetchEnabledFormDefinitions: vi.fn(),
  fetchFormDefinitions: vi.fn(),
  FORM_STATUS_ENABLED: 'ENABLED',
  FORM_STATUS_DISABLED: 'DISABLED',
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const current: workflowApi.WfDefinition = {
  id: '1001',
  tenantId: '1',
  code: 'PUR_APPROVAL',
  name: '采购审批流程',
  category: 'APPROVAL',
  categoryId: null,
  description: null,
  version: 1,
  status: 'DRAFT',
  supportedFormCodes: ['PUR_FORM'],
  formSchema: null,
  config: '{}',
  nodes: [],
  edges: null,
  createdAt: '',
  updatedAt: '',
};

describe('LinkFormsDialog', () => {
  beforeEach(() => {
    __setFormLoadersForTest({
      PUR_FORM: async () => [{ formCode: 'PUR_FORM', name: '采购申请单', component: () => null, fields: [] }],
      LEAVE_FORM: async () => [{ formCode: 'LEAVE_FORM', name: '请假单', component: () => null, fields: [] }],
      TAKEN_FORM: async () => [{ formCode: 'TAKEN_FORM', name: '已被占用', component: () => null, fields: [] }],
    });
    vi.mocked(formApi.fetchEnabledFormDefinitions).mockResolvedValue([
      {
        id: '1',
        tenantId: '1',
        categoryId: null,
        code: 'PUR_FORM',
        name: '采购申请单',
        description: null,
        status: 'ENABLED',
        sortOrder: 0,
        config: null,
        createdAt: null,
        updatedAt: null,
      },
      {
        id: '2',
        tenantId: '1',
        categoryId: null,
        code: 'LEAVE_FORM',
        name: '请假单',
        description: null,
        status: 'ENABLED',
        sortOrder: 1,
        config: null,
        createdAt: null,
        updatedAt: null,
      },
      {
        id: '3',
        tenantId: '1',
        categoryId: null,
        code: 'TAKEN_FORM',
        name: '已被占用',
        description: null,
        status: 'ENABLED',
        sortOrder: 2,
        config: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 200,
      total: 2,
      list: [
        current,
        {
          ...current,
          id: '2002',
          code: 'OTHER',
          name: '其他流程',
          supportedFormCodes: ['TAKEN_FORM'],
        },
      ],
    });
    vi.mocked(workflowApi.updateSupportedForms).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('右侧展示已选；左侧不含已选与被其他流程占用的表单', async () => {
    render(
      <LinkFormsDialog open onOpenChange={vi.fn()} definition={current} onSaved={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByTestId('selected-form').textContent).toContain('PUR_FORM'));
    const available = await screen.findAllByTestId('available-form');
    const texts = available.map((el) => el.textContent ?? '');
    expect(texts.some((t) => t.includes('LEAVE_FORM'))).toBe(true);
    expect(texts.some((t) => t.includes('PUR_FORM'))).toBe(false);
    expect(texts.some((t) => t.includes('TAKEN_FORM'))).toBe(false);
  });

  it('搜索过滤左侧可选；点击加入右侧；保存调用 updateSupportedForms', async () => {
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <LinkFormsDialog
        open
        onOpenChange={onOpenChange}
        definition={{ ...current, supportedFormCodes: [] }}
        onSaved={onSaved}
      />,
    );

    await waitFor(() => expect(screen.getAllByTestId('available-form').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('搜索可选表单'), { target: { value: '请假' } });
    await waitFor(() => {
      const rows = screen.getAllByTestId('available-form');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('LEAVE_FORM');
    });

    fireEvent.click(screen.getByTestId('available-form'));
    await waitFor(() => expect(screen.getByTestId('selected-form').textContent).toContain('LEAVE_FORM'));

    fireEvent.click(screen.getByText('保存'));
    await waitFor(() =>
      expect(workflowApi.updateSupportedForms).toHaveBeenCalledWith('1001', '1', ['LEAVE_FORM']),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
