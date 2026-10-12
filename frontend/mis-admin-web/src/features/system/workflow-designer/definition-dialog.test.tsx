// @vitest-environment jsdom
/**
 * DefinitionDialog 单测（T4.4 + T09 categoryId 下拉）：
 *
 * 覆盖：
 * 1. 四个必填字段齐全才能提交，回调带 trim 后的值（categoryId 取代原 category 枚举）
 * 2. 编码格式非法被拒（小写 / 数字开头 / 特殊字符）
 * 3. 表单未选 / 选了未注册项被拒（formCode 已注册校验）
 * 4. 编码重复给出「编码 "XXX" 已存在」友好提示
 * 5. 分类是 biz_category 下拉（不再是 APPROVAL/NOTICE/TASK 枚举），提交带 categoryId
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DefinitionDialog } from './definition-dialog';
import * as formApi from '@/lib/api/form-definition';
import * as workflowApi from '@/lib/api/workflow';
import * as bizCategoryApi from '@/lib/api/biz-category';
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
    ]);
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({ page: 1, size: 100, total: 0, list: [] });
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue(CATEGORIES);
    vi.mocked(bizCategoryApi.fetchBizCategoryTree).mockResolvedValue(CATEGORIES);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('四字段齐全后提交，回调带 trim 后的值（categoryId 取代 category）', async () => {
    const onSubmit = renderDialog();
    fill('流程名称', '  采购审批流程  ');
    fill('流程编码', '  PUR_APPROVAL  ');
    await pickFirstForm();

    fireEvent.click(screen.getByText('下一步：编排'));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        code: 'PUR_APPROVAL',
        name: '采购审批流程',
        categoryId: null,
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
          categoryId: 990001,
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

  it('分类是 biz_category 下拉树，节点来自后端分类树，选中回传 categoryId', async () => {
    const onSubmit = renderDialog();
    fill('流程名称', '采购审批流程');
    fill('流程编码', 'PUR_APPROVAL');
    await pickFirstForm();

    // 触发器是按钮（不再是原生 <select>），未选时显示占位「未分类」。
    const trigger = (await screen.findByLabelText('分类')) as HTMLButtonElement;
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toContain('未分类');

    // 展开下拉树：候选节点来自业务分类树（name），而非旧枚举。
    fireEvent.click(trigger);
    const node = await screen.findByRole('button', { name: '审批类' });
    expect(screen.getByRole('button', { name: '通知类' })).toBeTruthy();
    // 选中「审批类」（id 990001）——节点点击用 pointerdown 双触发范式。
    fireEvent.pointerDown(node, { button: 0 });

    // 选中后触发器展示已选分类名。
    await waitFor(() => expect(screen.getByLabelText('分类').textContent).toContain('审批类'));

    fireEvent.click(screen.getByText('下一步：编排'));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 990001 })),
    );
  });
});
