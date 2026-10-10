// @vitest-environment jsdom
/**
 * FormDefinitionManagePage 单测（双 Tab + code 下拉 + 标红）：
 * 1. 默认「表单管理」Tab 显示表单表格（含「编码」表头）
 * 2. 切到「分类管理」Tab 显示分类树（含「全部分类」根）
 * 3. 「新增表单」对话框的 code 是下拉选「已注册组件」
 * 4. 表单列表里 code 未关联前端组件的行标红 + 「未关联组件」徽标
 * 5. FORM 对话框 code 为空（未选组件）时校验报错且不发起创建请求
 *
 * <p>通过 `vi.mock('@/lib/api/form-definition')` 接管 fetch 函数，不真发 HTTP。
 * `listFormLoaderCodes()` 取真实注册表（默认含 `PUR_FORM`），不 mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FormDefinitionManagePage } from './form-definition-manage-page';
import * as formApi from '@/lib/api/form-definition';
import type { FormDefinitionItem } from '@/lib/api/form-definition';

vi.mock('@/lib/api/form-definition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/form-definition')>();
  return {
    ...actual,
    fetchFormDefinitionTree: vi.fn(),
    fetchFormDefinitions: vi.fn(),
    getFormDefinition: vi.fn(),
    createFormDefinition: vi.fn(),
    updateFormDefinition: vi.fn(),
    deleteFormDefinition: vi.fn(),
  };
});

const categoryTree: FormDefinitionItem[] = [
  {
    id: '1',
    tenantId: '1',
    parentId: null,
    code: 'ROOT',
    name: '根分类',
    description: null,
    status: 'ENABLED',
    sortOrder: 0,
    config: null,
    kind: 'CATEGORY',
    children: [
      {
        id: '2',
        tenantId: '1',
        parentId: 1,
        code: 'SUB',
        name: '子分类',
        description: null,
        status: 'ENABLED',
        sortOrder: 0,
        config: null,
        kind: 'CATEGORY',
        children: null,
        createdAt: null,
        updatedAt: null,
      },
    ],
    createdAt: null,
    updatedAt: null,
  },
];

const formList: FormDefinitionItem[] = [
  {
    id: '10',
    tenantId: '1',
    parentId: 1,
    code: 'PUR_FORM',
    name: '采购申请单',
    description: null,
    status: 'ENABLED',
    sortOrder: 0,
    config: null,
    children: null,
    createdAt: null,
    updatedAt: null,
    kind: 'FORM',
  },
  {
    id: '11',
    tenantId: '1',
    parentId: 1,
    code: 'UNREGISTERED_FORM',
    name: '未注册组件表单',
    description: null,
    status: 'ENABLED',
    sortOrder: 1,
    config: null,
    children: null,
    createdAt: null,
    updatedAt: null,
    kind: 'FORM',
  },
];

describe('FormDefinitionManagePage', () => {
  beforeEach(() => {
    vi.mocked(formApi.fetchFormDefinitionTree).mockResolvedValue(categoryTree);
    vi.mocked(formApi.fetchFormDefinitions).mockResolvedValue(formList);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('默认「表单管理」Tab 显示表单表格与「编码」表头', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('表单管理')).toBeTruthy();
    // 表单表格表头
    expect(screen.getByText('编码')).toBeTruthy();
    // 表单列表含两条表单
    expect((await screen.findAllByText('采购申请单')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('未注册组件表单')).toBeTruthy();
  });

  it('切到「分类管理」Tab 显示分类树（全部分类根）', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '分类管理' }));
    expect(await screen.findByText('全部分类')).toBeTruthy();
    // 根分类 / 子分类出现在分类树
    expect((await screen.findAllByText('根分类')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('子分类')).toBeTruthy();
  });

  it('「新增表单」对话框的 code 是下拉选已注册组件', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '新增表单' }));
    expect(await screen.findByText('新增表单定义')).toBeTruthy();
    // code 字段是「表单组件」下拉，候选含已注册组件 PUR_FORM
    const select = screen.getByLabelText('表单组件') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'PUR_FORM' })).toBeTruthy();
  });

  it('code 未关联前端组件的行标红并带「未关联组件」徽标', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    // 等表格渲染
    await screen.findByText('未注册组件表单');
    // 「未关联组件」徽标出现
    expect(screen.getByText('未关联组件')).toBeTruthy();
    // 已注册组件 PUR_FORM 那行不应出现该徽标（数量应为 1）
    expect(screen.getAllByText('未关联组件').length).toBe(1);
  });

  it('FORM 对话框未选组件时校验报错且不发起创建请求', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '新增表单' }));
    await screen.findByText('新增表单定义');
    // 不碰 code 下拉（保持空），直接保存
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('请选择已注册的表单组件')).toBeTruthy();
    expect(formApi.createFormDefinition).not.toHaveBeenCalled();
  });
});
