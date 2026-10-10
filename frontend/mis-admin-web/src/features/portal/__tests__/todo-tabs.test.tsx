// @vitest-environment jsdom
/**
 * 门户「待办事项」六类聚合 + 显式搜索 测试（T03a）。
 *
 * 覆盖：
 * 1. 六个子 Tab（待处理/审批中/已通过/已驳回/我发起的/我审批的）均渲染；
 * 2. **显式搜索**：输入关键词本身**不触发请求**；点「搜索」或回车才以 `keyword` + `page=1` 请求；
 * 3. 分类 → 接口路由：「我发起的」调 `fetchMyProcesses`、「我审批的」调 `fetchHandledTasks`；
 * 4. 空态 / 错误态渲染；
 * 5. **T03b**：点有实例的行 → 打开右侧抽屉（携带 instanceId），不再 `navigate`。
 *
 * mock 范式：整体替换 `@/lib/api/tasks`、`@/lib/api/workflow`；auth store 用 `useAuthStore.setState`；
 * `next-themes` 显式 mock；抽屉替换为轻量替身；`wfInstanceId` 不 mock（用真实解析，metadata 决定 instanceId）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalTodoTab } from '../tabs/portal-todo-tab';
import * as tasksApi from '@/lib/api/tasks';
import * as workflowApi from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';
import type { TaskItem } from '@/lib/api/tasks';
import type { WfInstance } from '@/lib/api/workflow';

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: 'light' }),
}));

vi.mock('@/lib/api/tasks', () => ({
  fetchMyTasks: vi.fn(),
  fetchHandledTasks: vi.fn(),
}));

vi.mock('@/lib/api/workflow', () => ({
  fetchMyProcesses: vi.fn(),
}));

// 抽屉替身（T03b）：本文件只验证「点有实例的行 → 打开抽屉（而非 navigate）」的接线，
// 抽屉内部行为由 `todo-detail-drawer.test.tsx` 覆盖。
vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: ({ open, instanceId }: { open: boolean; instanceId: string | null }) =>
    open ? <div data-testid="todo-drawer" data-instance={instanceId ?? ''} /> : null,
}));

const emptyPage = { page: 1, size: 20, total: 0, list: [] };

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: '9001',
    tenantId: '1',
    taskType: 'APPROVE',
    bizType: 'PURCHASE_ORDER',
    bizRefId: 'PO-001',
    bizTitle: '采购单审批',
    targetEntity: null,
    assigneeId: '700001',
    assigneeName: '测试员',
    status: 'PENDING',
    priority: 2,
    dueDate: null,
    metadata: null,
    result: null,
    read: false,
    completedAt: null,
    createdAt: '2026-10-08T10:00:00',
    ...overrides,
  };
}

function wfInstance(overrides: Partial<WfInstance> = {}): WfInstance {
  return {
    id: '128',
    definitionCode: 'PURCHASE_APPROVAL',
    startedFormCode: 'PUR_FORM',
    businessType: 'PURCHASE_ORDER',
    businessId: 'PO-001',
    status: 'RUNNING',
    initiatorId: '700001',
    initiatorName: '测试员',
    currentNodeCode: 'finance',
    currentNodeName: null,
    progress: '50%',
    postProcessStatus: 'WAITING',
    postRetryCount: 0,
    createdAt: '2026-10-08T10:00:00',
    completedAt: null,
    ...overrides,
  };
}

function renderTab() {
  return render(
    <MemoryRouter>
      <PortalTodoTab />
    </MemoryRouter>,
  );
}

describe('PortalTodoTab（T03a）', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
        id: '700001',
        employeeId: 'E1',
        username: 'tester',
        realName: '测试员',
        avatarUrl: null,
        deptId: null,
        deptName: null,
        roles: [],
        mustChangePassword: false,
      },
    });
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
    vi.mocked(tasksApi.fetchHandledTasks).mockResolvedValue(emptyPage);
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue(emptyPage);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染六个子 Tab', async () => {
    renderTab();
    for (const label of ['待处理', '审批中', '已通过', '已驳回', '我发起的', '我审批的']) {
      expect(await screen.findByRole('tab', { name: label })).toBeTruthy();
    }
  });

  it('默认「待处理」：以 status=PENDING 拉 /tasks/my', async () => {
    renderTab();
    await waitFor(() =>
      expect(tasksApi.fetchMyTasks).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: '1', assigneeId: '700001', status: 'PENDING', page: 1, size: 20 }),
      ),
    );
  });

  it('显式搜索：输入不发请求，点「搜索」才以 keyword 且 page=1 请求', async () => {
    renderTab();
    await waitFor(() => expect(tasksApi.fetchMyTasks).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText('待办关键词');
    fireEvent.change(input, { target: { value: 'ZKW' } });
    // 打字本身不触发任何请求
    expect(tasksApi.fetchMyTasks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    await waitFor(() => expect(tasksApi.fetchMyTasks).toHaveBeenCalledTimes(2));
    expect(tasksApi.fetchMyTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: 'ZKW', page: 1, status: 'PENDING' }),
    );
  });

  it('显式搜索：回车键同样触发请求', async () => {
    renderTab();
    await waitFor(() => expect(tasksApi.fetchMyTasks).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText('待办关键词');
    fireEvent.change(input, { target: { value: 'ENT' } });
    expect(tasksApi.fetchMyTasks).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(tasksApi.fetchMyTasks).toHaveBeenCalledTimes(2));
    expect(tasksApi.fetchMyTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: 'ENT', page: 1 }),
    );
  });

  it('「我发起的」调 fetchMyProcesses、「我审批的」调 fetchHandledTasks', async () => {
    renderTab();
    await waitFor(() => expect(tasksApi.fetchMyTasks).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByRole('tab', { name: '我发起的' }), { button: 0 });
    await waitFor(() =>
      expect(workflowApi.fetchMyProcesses).toHaveBeenCalledWith('1', '700001', undefined, 1, 20, undefined),
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: '我审批的' }), { button: 0 });
    await waitFor(() =>
      expect(tasksApi.fetchHandledTasks).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: '1', assigneeId: '700001', page: 1, size: 20 }),
      ),
    );
  });

  it('列表渲染：展示标题与流程状态徽标（我发起的）', async () => {
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [wfInstance()],
    });
    renderTab();
    await waitFor(() => expect(tasksApi.fetchMyTasks).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByRole('tab', { name: '我发起的' }), { button: 0 });
    expect(await screen.findByText('PURCHASE_ORDER / PO-001')).toBeTruthy();
    expect(screen.getByText('进行中')).toBeTruthy();
  });

  it('点击有实例的行 → 打开抽屉（而非 navigate），携带 instanceId', async () => {
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [wfInstance({ id: '128' })],
    });
    renderTab();
    await waitFor(() => expect(tasksApi.fetchMyTasks).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByRole('tab', { name: '我发起的' }), { button: 0 });
    const rowBtn = (await screen.findByText('PURCHASE_ORDER / PO-001')).closest('button');
    expect(rowBtn).toBeTruthy();

    fireEvent.click(rowBtn!);

    // 抽屉打开且带着该行的 instanceId（T03b：由 navigate 改为右侧划入抽屉）
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
  });

  it('列表渲染：待办源展示标题 / 业务编号 / 处理人', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [task({ id: '9001', bizTitle: '采购单审批-甲' })],
    });
    renderTab();
    expect(await screen.findByText('采购单审批-甲')).toBeTruthy();
    expect(screen.getByText('PURCHASE_ORDER / PO-001')).toBeTruthy();
    expect(screen.getByText('处理人 测试员')).toBeTruthy();
  });

  it('空态：无数据展示占位', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
    renderTab();
    expect(await screen.findByText('暂无记录')).toBeTruthy();
  });

  it('错误态：展示错误消息与重试', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockRejectedValue(new Error('加载爆炸'));
    renderTab();
    expect(await screen.findByText('加载爆炸')).toBeTruthy();
    expect(screen.getByText('重试')).toBeTruthy();
  });
});
