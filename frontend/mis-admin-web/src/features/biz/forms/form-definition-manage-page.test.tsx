// @vitest-environment jsdom
/**
 * FormDefinitionManagePage 单测（分类列 + code 下拉 + 标红）：
 * 1. 表单表格显示（含「编码」「分类」表头），分类列解析分类名/未分类
 * 2. 「新增表单」对话框的 code 是下拉选「已注册组件」，且含分类下拉
 * 3. 表单列表里 code 未关联前端组件的行标红 + 「未关联组件」徽标
 * 4. 对话框未选组件时校验报错且不发起创建请求
 * 5. 分类筛选：勾选分类后点「查询」才请求；选父分类时 categoryIds 含子孙
 *
 * <p>分类已统一为「租户通用业务分类」`biz_category`：mock `@/lib/api/biz-category`
 * （树/扁平/增删改）+ 新版 `@/lib/api/form-definition`（无树、带 categoryId）。
 * `listFormLoaderCodes()` 取真实注册表（默认含 `PUR_FORM`），不 mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FormDefinitionManagePage } from './form-definition-manage-page';
import * as formApi from '@/lib/api/form-definition';
import * as bizCategoryApi from '@/lib/api/biz-category';
import type { FormDefinitionItem } from '@/lib/api/form-definition';
import type { BizCategoryItem } from '@/lib/api/biz-category';

vi.mock('@/lib/api/form-definition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/form-definition')>();
  return {
    ...actual,
    fetchFormDefinitions: vi.fn(),
    getFormDefinition: vi.fn(),
    createFormDefinition: vi.fn(),
    updateFormDefinition: vi.fn(),
    deleteFormDefinition: vi.fn(),
  };
});

vi.mock('@/lib/api/biz-category', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/biz-category')>();
  return {
    ...actual,
    fetchBizCategoryTree: vi.fn(),
    fetchBizCategories: vi.fn(),
    getBizCategory: vi.fn(),
    createBizCategory: vi.fn(),
    updateBizCategory: vi.fn(),
    deleteBizCategory: vi.fn(),
  };
});

const categoryTree: BizCategoryItem[] = [
  {
    id: '1',
    tenantId: '1',
    parentId: null,
    code: 'ROOT',
    name: '根分类',
    description: null,
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
        sortOrder: 0,
        config: null,
        children: null,
        createdAt: '',
        updatedAt: '',
      },
    ],
    createdAt: '',
    updatedAt: '',
  },
];

const categoryList: BizCategoryItem[] = [
  { ...categoryTree[0], children: null },
  { ...categoryTree[0].children![0] },
];

const formList: FormDefinitionItem[] = [
  {
    id: '10',
    tenantId: '1',
    categoryId: 1,
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
    id: '11',
    tenantId: '1',
    categoryId: null,
    code: 'UNREGISTERED_FORM',
    name: '未注册组件表单',
    description: null,
    status: 'ENABLED',
    sortOrder: 1,
    config: null,
    createdAt: null,
    updatedAt: null,
  },
];

describe('FormDefinitionManagePage', () => {
  beforeEach(() => {
    vi.mocked(formApi.fetchFormDefinitions).mockResolvedValue(formList);
    vi.mocked(bizCategoryApi.fetchBizCategoryTree).mockResolvedValue(categoryTree);
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue(categoryList);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('显示表单表格、「编码」表头与分类列（含未分类）', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('表单定义管理')).toBeTruthy();
    // 表头
    expect(screen.getByText('编码')).toBeTruthy();
    expect(screen.getByText('分类')).toBeTruthy();
    // 表单列表含两条表单
    expect((await screen.findAllByText('采购申请单')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('未注册组件表单')).toBeTruthy();
    // 分类列：PUR_FORM → 根分类；UNREGISTERED_FORM → 未分类（限定在表格单元格内，排除筛选下拉的 option）
    expect(screen.getByText('根分类', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('未分类', { selector: 'td' })).toBeTruthy();
  });

  it('「新增表单」对话框的 code 是下拉选已注册组件，且分类为下拉树', async () => {
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
    // 分类字段是下拉树触发器（按钮，不再是原生 <select>），未选显示占位「未分类」
    const categoryTrigger = screen.getByLabelText('分类') as HTMLButtonElement;
    expect(categoryTrigger.tagName).toBe('BUTTON');
    expect(categoryTrigger.textContent).toContain('未分类');
    // 展开后可见分类树节点（父子层级）
    fireEvent.click(categoryTrigger);
    expect(await screen.findByRole('button', { name: '根分类' })).toBeTruthy();
  });

  it('code 未关联前端组件的行标红并带「未关联组件」徽标', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    // 等表格渲染
    await screen.findByText('未注册组件表单');
    // 「未关联组件」徽标出现，且只有未注册那一行（数量应为 1）
    expect(screen.getAllByText('未关联组件').length).toBe(1);
  });

  it('对话框未选组件时校验报错且不发起创建请求', async () => {
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

  it('勾选分类后点「查询」才请求；选父分类时 categoryIds 含子孙', async () => {
    render(
      <MemoryRouter>
        <FormDefinitionManagePage />
      </MemoryRouter>,
    );
    // 等初始加载完成：第一次调用无分类过滤（第三参 undefined）
    await screen.findByText('采购申请单');
    expect(formApi.fetchFormDefinitions).toHaveBeenCalledWith('1', undefined, undefined);
    const callsAfterLoad = vi.mocked(formApi.fetchFormDefinitions).mock.calls.length;

    // 打开分类下拉树，勾选根分类（id=1，含子分类 id=2）后尚未点查询 → 不应新增请求
    fireEvent.click(screen.getByRole('button', { name: '全部分类' }));
    fireEvent.pointerDown(await screen.findByRole('button', { name: '根分类' }), { button: 0 });
    expect(vi.mocked(formApi.fetchFormDefinitions).mock.calls.length).toBe(callsAfterLoad);

    // 关掉分类 Popover（modal 打开时外层按钮被 aria-hidden）
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: '查询' }));

    await waitFor(() => {
      const last = vi.mocked(formApi.fetchFormDefinitions).mock.calls.at(-1);
      expect(last?.[0]).toBe('1');
      expect(last?.[1]).toBeUndefined();
      expect(last?.[2]).toEqual(expect.arrayContaining([1, 2]));
      expect(last?.[2]).toHaveLength(2);
    });
    expect(await screen.findByText('采购申请单')).toBeTruthy();
  });
});
