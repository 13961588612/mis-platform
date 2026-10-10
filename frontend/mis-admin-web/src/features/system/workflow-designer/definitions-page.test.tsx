// @vitest-environment jsdom
/**
 * WorkflowDefinitionPage 单测（T4.3 发布/取消发布 + 权限门控，T4.5 不留浏览器历史）。
 *
 * 覆盖：
 * 1. 有 `workflow:definition:edit` 时渲染发布/取消发布按钮
 * 2. 无权限时两个按钮都**不渲染**（隐藏而非禁用）
 * 3. ACTIVE 行显示「取消发布」并调 deactivate 端点 + 刷新列表
 * 4. DRAFT 行显示「发布」
 * 5. 点「编排」是**开 Dialog**，路由零变化（不 navigate ⇒ 历史条数不变）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { WorkflowDefinitionPage } from './definitions-page';
import * as workflowApi from '@/lib/api/workflow';
import * as formApi from '@/lib/api/form-definition';
import * as wfCategoryApi from '@/lib/api/wf-category';
import api from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';

// ReactFlow（编排 Dialog 里）在 jsdom 需要 ResizeObserver / DOMMatrix
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as unknown as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class {
  m22 = 1;
};

vi.mock('@/lib/api/workflow', () => ({
  fetchDefinitions: vi.fn(),
  activateDefinition: vi.fn(),
  deactivateDefinition: vi.fn(),
  fetchDefinition: vi.fn(),
}));

vi.mock('@/lib/api/form-definition', () => ({
  fetchEnabledFormDefinitions: vi.fn(),
  fetchFormDefinitions: vi.fn(),
  FORM_STATUS_ENABLED: 'ENABLED',
  FORM_STATUS_DISABLED: 'DISABLED',
}));

vi.mock('@/lib/api/wf-category', () => ({
  fetchWfCategoryTree: vi.fn(),
  fetchWfCategories: vi.fn(),
  createWfCategory: vi.fn(),
  updateWfCategory: vi.fn(),
  deleteWfCategory: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

function def(overrides: Partial<workflowApi.WfDefinition> = {}): workflowApi.WfDefinition {
  return {
    id: '1001',
    tenantId: '1',
    code: 'PUR_APPROVAL',
    name: '采购审批流程',
    category: 'APPROVAL',
    categoryId: null,
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
    ...overrides,
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc">{loc.pathname}</span>;
}

function renderPage() {
  // ⚠️ 只包 MemoryRouter（给 Router 上下文），**不要**包 <Route>：
  // 本仓库页面由 KeepAliveOutlet 用 <Comp /> 直挂，不在 Route 上下文内，包了就测不到真实情况。
  render(
    <MemoryRouter>
      <LocationProbe />
      <WorkflowDefinitionPage />
    </MemoryRouter>,
  );
}

describe('WorkflowDefinitionPage 发布 / 取消发布', () => {
  beforeEach(() => {
    useAuthStore.setState({ permissions: ['workflow:definition:edit'] });
    vi.mocked(workflowApi.activateDefinition).mockResolvedValue(undefined);
    vi.mocked(workflowApi.deactivateDefinition).mockResolvedValue(undefined);
    vi.mocked(formApi.fetchEnabledFormDefinitions).mockResolvedValue([]);
    vi.mocked(workflowApi.fetchDefinition).mockRejectedValue(new Error('n/a'));
    vi.mocked(wfCategoryApi.fetchWfCategoryTree).mockResolvedValue([]);
    vi.mocked(wfCategoryApi.fetchWfCategories).mockResolvedValue([]);
    vi.mocked(api.post).mockResolvedValue({ data: { code: 0, message: 'ok', data: null } });
    vi.mocked(api.put).mockResolvedValue({ data: { code: 0, message: 'ok', data: null } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('有权限时 DRAFT 行显示「发布」', async () => {
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [def()],
    });
    renderPage();

    expect(await screen.findByText('发布')).toBeTruthy();
    expect(screen.queryByText('取消发布')).toBeNull();
  });

  it('有权限时 ACTIVE 行显示「取消发布」并调通端点', async () => {
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [def({ status: 'ACTIVE' })],
    });
    renderPage();

    const btn = await screen.findByText('取消发布');
    fireEvent.click(btn);

    await waitFor(() =>
      expect(workflowApi.deactivateDefinition).toHaveBeenCalledWith('1001', '1'),
    );
    // 保存后必须刷新列表（状态/节点数会变）
    await waitFor(() => expect(workflowApi.fetchDefinitions).toHaveBeenCalledTimes(2));
  });

  it('点「编排」开 Dialog 而不是跳转，路由零变化（不留浏览器历史）', async () => {
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [def()],
    });
    renderPage();

    fireEvent.click(await screen.findByText('编排'));

    // 画布出现在 Dialog 里（角色 dialog 存在且含画布）
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0));
    // ⚠️ 关键：路由没变 ⇒ 没有 push，历史条数恒定
    expect(screen.getByTestId('loc').textContent).toBe('/');
    // 且带上了定义 ID（改版前点哪行都是空白画布）
    expect(workflowApi.fetchDefinition).toHaveBeenCalledWith('1001', '1');
  });

  it('ACTIVE 行的「编排」禁用（后端 update 会拒）', async () => {
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [def({ status: 'ACTIVE' })],
    });
    renderPage();

    const btn = (await screen.findByText('编排')) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('请先取消发布');
  });

  it('无 workflow:definition:edit 时两个按钮都不渲染（隐藏而非禁用）', async () => {
    useAuthStore.setState({ permissions: [] });
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [def({ status: 'ACTIVE' })],
    });
    renderPage();

    await screen.findByText('采购审批流程');
    expect(screen.queryByText('发布')).toBeNull();
    expect(screen.queryByText('取消发布')).toBeNull();
  });

  it('分类下拉树多选后 fetchDefinitions 收到 categoryIds 数组并回到第 1 页', async () => {
    vi.mocked(wfCategoryApi.fetchWfCategoryTree).mockResolvedValue([
      {
        id: '1',
        tenantId: '1',
        parentId: null,
        code: 'ROOT',
        name: '流程分类',
        description: null,
        sortOrder: 0,
        config: null,
        children: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    vi.mocked(wfCategoryApi.fetchWfCategories).mockResolvedValue([
      {
        id: '1',
        tenantId: '1',
        parentId: null,
        code: 'ROOT',
        name: '流程分类',
        description: null,
        sortOrder: 0,
        config: null,
        children: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [def()],
    });
    renderPage();

    // 等首次加载完成（无分类过滤 → 第四参 undefined）
    await screen.findByText('采购审批流程');
    expect(workflowApi.fetchDefinitions).toHaveBeenCalledWith('1', 1, 20, undefined);

    // 打开分类下拉树，勾选「流程分类」（id=1）
    fireEvent.click(screen.getByRole('button', { name: '全部分类' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: '流程分类' }), { button: 0 });

    await waitFor(() => {
      expect(workflowApi.fetchDefinitions).toHaveBeenCalledWith('1', 1, 20, [1]);
    });
  });
});
