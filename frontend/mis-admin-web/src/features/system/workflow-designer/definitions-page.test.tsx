// @vitest-environment jsdom
/**
 * WorkflowDefinitionPage 单测（T4.3 发布/取消发布 + 权限门控）。
 *
 * 覆盖：
 * 1. 有 `workflow:definition:edit` 时渲染发布/取消发布按钮
 * 2. 无权限时两个按钮都**不渲染**（隐藏而非禁用）
 * 3. ACTIVE 行显示「取消发布」并调 deactivate 端点 + 刷新列表
 * 4. DRAFT 行显示「发布」
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkflowDefinitionPage } from './definitions-page';
import * as workflowApi from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/lib/api/workflow', () => ({
  fetchDefinitions: vi.fn(),
  activateDefinition: vi.fn(),
  deactivateDefinition: vi.fn(),
  fetchDefinition: vi.fn(),
}));

function def(overrides: Partial<workflowApi.WfDefinition> = {}): workflowApi.WfDefinition {
  return {
    id: '1001',
    tenantId: '1',
    code: 'PUR_APPROVAL',
    name: '采购审批流程',
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
    ...overrides,
  };
}

function renderPage() {
  // ⚠️ 只包 MemoryRouter（给 useNavigate 提供上下文），**不要**包 <Route>：
  // 本仓库页面由 KeepAliveOutlet 用 <Comp /> 直挂，不在 Route 上下文内，包了就测不到真实情况。
  render(
    <MemoryRouter>
      <WorkflowDefinitionPage />
    </MemoryRouter>,
  );
}

describe('WorkflowDefinitionPage 发布 / 取消发布', () => {
  beforeEach(() => {
    useAuthStore.setState({ permissions: ['workflow:definition:edit'] });
    vi.mocked(workflowApi.activateDefinition).mockResolvedValue(undefined);
    vi.mocked(workflowApi.deactivateDefinition).mockResolvedValue(undefined);
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
});
