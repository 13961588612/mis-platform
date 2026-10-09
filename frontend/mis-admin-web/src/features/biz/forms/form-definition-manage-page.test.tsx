// @vitest-environment jsdom
/**
 * FormDefinitionManagePage 单测：
 * 1. 页面加载渲染左侧树与右侧表格
 * 2. 点击「新增」打开对话框
 * 3. code 不符合正则时前端校验报错，且不发起创建请求
 *
 * <p>通过 `vi.mock('@/lib/api/form-definition')` 接管 fetch 函数，不真发 HTTP。
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

const tree: FormDefinitionItem[] = [
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
        children: null,
        createdAt: null,
        updatedAt: null,
      },
    ],
    createdAt: null,
    updatedAt: null,
  },
];

const list: FormDefinitionItem[] = [
  { ...tree[0], children: null },
  { ...(tree[0].children as FormDefinitionItem[])[0], children: null },
];

describe('FormDefinitionManagePage', () => {
  beforeEach(() => {
    vi.mocked(formApi.fetchFormDefinitionTree).mockResolvedValue(tree);
    vi.mocked(formApi.fetchFormDefinitions).mockResolvedValue(list);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('页面加载显示分类树与表格', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    // 树根节点
    expect(await screen.findByText('全部表单')).toBeTruthy();
    // 树 + 表格均含「根分类」/「子分类」
    expect((await screen.findAllByText('根分类')).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText('子分类')).length).toBeGreaterThanOrEqual(1);
    // 表格表头
    expect(screen.getByText('编码')).toBeTruthy();
  });

  it('点击「新增」打开对话框', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /新增/ }));
    expect(await screen.findByText('新增表单定义')).toBeTruthy();
    expect(screen.getByLabelText('表单编码')).toBeTruthy();
  });

  it('code 不符合正则时校验报错且不发起创建请求', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /新增/ }));
    const codeInput = await screen.findByLabelText('表单编码');
    fireEvent.change(codeInput, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/编码格式不正确/)).toBeTruthy();
    expect(formApi.createFormDefinition).not.toHaveBeenCalled();
  });
});
