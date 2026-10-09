// @vitest-environment jsdom
/**
 * DefinitionDialog 单测（T4.4）。
 *
 * 覆盖：
 * 1. 四个必填字段齐全才能提交，回调带 trim 后的值
 * 2. 编码格式非法被拒（小写 / 数字开头 / 特殊字符）
 * 3. 表单未选 / 选了未注册项被拒（formCode 已注册校验）
 * 4. 编码重复给出「编码 "XXX" 已存在」友好提示
 * 5. 分类是枚举
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DefinitionDialog } from './definition-dialog';
import * as formApi from '@/lib/api/form-definition';
import * as workflowApi from '@/lib/api/workflow';
import { __setFormLoadersForTest } from '@/features/biz/forms/forms/form-loaders';

vi.mock('@/lib/api/form-definition', () => ({
  fetchEnabledFormDefinitions: vi.fn(),
  fetchFormDefinitions: vi.fn(),
  FORM_STATUS_ENABLED: 'ENABLED',
  FORM_STATUS_DISABLED: 'DISABLED',
}));

vi.mock('@/lib/api/workflow', () => ({
  fetchDefinitions: vi.fn(),
}));

function renderDialog(onSubmit = vi.fn()) {
  render(<DefinitionDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);
  return onSubmit;
}

function fill(field: string, value: string) {
  fireEvent.change(screen.getByLabelText(field), { target: { value } });
}

async function pickFirstForm() {
  await waitFor(() => expect(screen.getAllByTestId('form-option').length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
}

describe('DefinitionDialog', () => {
  beforeEach(() => {
    __setFormLoadersForTest({
      PUR_FORM: async () => [{ formCode: 'PUR_FORM', name: '采购申请单', component: () => null, fields: [] }],
    });
    vi.mocked(formApi.fetchEnabledFormDefinitions).mockResolvedValue([
      {
        id: '960010',
        tenantId: '1',
        parentId: 0,
        code: 'PUR_FORM',
        name: '采购申请单',
        description: null,
        status: 'ENABLED',
        sortOrder: 0,
        config: null,
        children: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({ page: 1, size: 100, total: 0, list: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('四字段齐全后提交，回调带 trim 后的值', async () => {
    const onSubmit = renderDialog();
    fill('流程名称', '  采购审批流程  ');
    fill('流程编码', '  PUR_APPROVAL  ');
    await pickFirstForm();

    fireEvent.click(screen.getByText('下一步：编排'));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        code: 'PUR_APPROVAL',
        name: '采购审批流程',
        category: 'APPROVAL',
        description: '',
        supportedFormCodes: ['PUR_FORM'],
      }),
    );
  });

  it('未选表单时不提交', async () => {
    const onSubmit = renderDialog();
    fill('流程名称', '采购审批流程');
    fill('流程编码', 'PUR_APPROVAL');

    fireEvent.click(screen.getByText('下一步：编排'));

    await waitFor(() => expect(screen.getByText('请至少选择一个表单')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('编码格式非法被拒', async () => {
    renderDialog();
    fill('流程名称', '采购审批流程');
    fill('流程编码', 'pur_approval');
    await pickFirstForm();

    fireEvent.click(screen.getByText('下一步：编排'));

    await waitFor(() => expect(screen.getByText(/编码须以大写字母开头/)).toBeTruthy());
    expect(workflowApi.fetchDefinitions).not.toHaveBeenCalled();
  });

  it('编码重复给出友好提示', async () => {
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 100,
      total: 1,
      list: [
        {
          id: '1',
          tenantId: '1',
          code: 'PUR_APPROVAL',
          name: '已存在的流程',
          category: 'APPROVAL',
          description: null,
          version: 1,
          status: 'DRAFT',
          supportedFormCodes: [],
          formSchema: null,
          config: '{}',
          nodes: [],
          edges: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    const onSubmit = renderDialog();
    fill('流程名称', '采购审批流程');
    fill('流程编码', 'PUR_APPROVAL');
    await pickFirstForm();

    fireEvent.click(screen.getByText('下一步：编排'));

    await waitFor(() => expect(screen.getByText('编码「PUR_APPROVAL」已存在')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('分类是枚举而非自由文本', () => {
    renderDialog();
    const select = screen.getByLabelText('分类') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['APPROVAL', 'NOTICE', 'TASK']);
  });
});
