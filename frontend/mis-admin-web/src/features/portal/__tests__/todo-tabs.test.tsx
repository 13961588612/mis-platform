// @vitest-environment jsdom
/**
 * 门户「待办事项」聚合 + 显式搜索 测试（T03a；本轮新增「全部」子 Tab + 发起人/参与人）。
 *
 * 覆盖：
 * 1. 全部子 Tab（全部/待处理/审批中/已通过/已驳回/我发起的/我审批的）均渲染；
 * 2. **默认选中「全部」**：以 `/tasks/matters` 拉三源聚合（`source='matters'`）；
 * 3. **显式搜索**：输入关键词/发起人/参与人本身**不触发请求**；点「搜索」或回车才请求；
 * 4. 分类 → 接口路由：「我发起的」调 `fetchMyProcesses`、「我审批的」调 `fetchHandledTasks`；
 * 5. 空态 / 错误态渲染；
 * 6. **T03b**：点有实例的行 → 打开右侧抽屉（携带 instanceId），不再 `navigate`；
 * 7. **本轮（「全部」）**：默认调聚合接口，行由 `fromPortalMatter` 适配（含发起人/参与人过滤透传）。
 *
 * mock 范式：整体替换 `@/lib/api/tasks`、`@/lib/api/workflow`；auth store 用 `useAuthStore.setState`；
 * `next-themes` 显式 mock；抽屉替换为轻量替身；`wfInstanceId` 不 mock（用真实解析，metadata 决定 instanceId）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalTodoTab } from '../tabs/portal-todo-tab';
import * as tasksApi from '@/lib/api/tasks';
import * as workflowApi from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';
import { DEFAULT_TODO_TAB_KEY, usePortalTodoTabStore } from '@/stores/portal-todo-tab-store';
import { TODO_TABS } from '../lib/todo-tabs';
import type { PortalMatterItem, TaskItem } from '@/lib/api/tasks';
import type { WfInstance } from '@/lib/api/workflow';

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: 'light' }),
}));

vi.mock('@/lib/api/tasks', () => ({
  fetchMyTasks: vi.fn(),
  fetchHandledTasks: vi.fn(),
  fetchPortalMatters: vi.fn(),
}));

vi.mock('@/lib/api/workflow', () => ({
  fetchMyProcesses: vi.fn(),
}));

// 门户表格新增两列（平台/关联应用、业务类型）经 `usePortalLookups` 拉取应用列表与业务分类，
// 整体替换这两个 api 模块，避免测试触达真实 axios。
vi.mock('@/lib/api/platform', () => ({
  fetchApps: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api/biz-category', () => ({
  fetchBizCategories: vi.fn().mockResolvedValue([]),
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
    appCode: null,
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
    appCode: null,
    ...overrides,
  };
}

function matter(overrides: Partial<PortalMatterItem> = {}): PortalMatterItem {
  return {
    kind: 'TASK',
    id: '9001',
    instanceId: '128',
    sysTaskId: '9001',
    title: '聚合待办-甲',
    subtitle: 'PURCHASE_ORDER / PO-001',
    bizType: 'PURCHASE_ORDER',
    appCode: null,
    initiatorName: '发起人甲',
    assigneeName: '测试员',
    status: 'PENDING',
    createdAt: '2026-10-08T10:00:00',
    category: 'PENDING',
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
    vi.mocked(tasksApi.fetchPortalMatters).mockResolvedValue(emptyPage);
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue(emptyPage);
    // 子 Tab 键本轮提升到模块级全局 store（跨测试共享），必须逐例复位到默认
    // 「全部」，否则上一例点过「我发起的」会让下一例「默认全部」断言假失败
    // （约定同 `portal-tab-store`）。
    usePortalTodoTabStore.setState({ activeKey: DEFAULT_TODO_TAB_KEY });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染全部子 Tab（含「全部」）', async () => {
    renderTab();
    for (const label of ['全部', '待处理', '审批中', '已通过', '已驳回', '我发起的', '我审批的']) {
      expect(await screen.findByRole('tab', { name: label })).toBeTruthy();
    }
  });

  it('默认「全部」：调 /tasks/matters 三源聚合', async () => {
    renderTab();
    await waitFor(() =>
      expect(tasksApi.fetchPortalMatters).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: '1', userId: '700001', page: 1, size: 20 }),
      ),
    );
    // 默认子 Tab 不得走「待处理」的 /tasks/my。
    expect(tasksApi.fetchMyTasks).not.toHaveBeenCalled();
  });

  it('「全部」行由 fromPortalMatter 适配渲染（标题 + 业务编号副标题）', async () => {
    vi.mocked(tasksApi.fetchPortalMatters).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [matter({ title: '聚合待办-甲' })],
    });
    renderTab();
    expect(await screen.findByText('聚合待办-甲')).toBeTruthy();
    expect(screen.getByText('PURCHASE_ORDER / PO-001')).toBeTruthy();
  });

  it('发起人/参与人 搜索：输入不请求，点「搜索」才把两值透传给 /tasks/matters', async () => {
    renderTab();
    await waitFor(() => expect(tasksApi.fetchPortalMatters).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('发起人'), { target: { value: '张三' } });
    fireEvent.change(screen.getByLabelText('参与人'), { target: { value: '李四' } });
    // 打字本身不触发请求
    expect(tasksApi.fetchPortalMatters).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    await waitFor(() => expect(tasksApi.fetchPortalMatters).toHaveBeenCalledTimes(2));
    expect(tasksApi.fetchPortalMatters).toHaveBeenLastCalledWith(
      expect.objectContaining({ initiatorName: '张三', participantName: '李四', page: 1 }),
    );
  });

  it('显式搜索（待处理源）：输入不发请求，点「搜索」才以 keyword 且 page=1 请求', async () => {
    usePortalTodoTabStore.setState({ activeKey: 'pending' });
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

  it('显式搜索（待处理源）：回车键同样触发请求', async () => {
    usePortalTodoTabStore.setState({ activeKey: 'pending' });
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
    await waitFor(() => expect(tasksApi.fetchPortalMatters).toHaveBeenCalled());

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
    await waitFor(() => expect(tasksApi.fetchPortalMatters).toHaveBeenCalled());

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
    await waitFor(() => expect(tasksApi.fetchPortalMatters).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByRole('tab', { name: '我发起的' }), { button: 0 });
    // 列表已改为表格：整行是 `<tr role="button">`（不再是 `<button>` 卡片行）。
    const rowBtn = (await screen.findByText('PURCHASE_ORDER / PO-001')).closest('tr');
    expect(rowBtn).toBeTruthy();

    fireEvent.click(rowBtn!);

    // 抽屉打开且带着该行的 instanceId（T03b：由 navigate 改为右侧划入抽屉）
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
  });

  it('列表渲染（待处理源）：展示标题 / 业务编号 / 处理人', async () => {
    usePortalTodoTabStore.setState({ activeKey: 'pending' });
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
    usePortalTodoTabStore.setState({ activeKey: 'pending' });
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
    renderTab();
    expect(await screen.findByText('暂无记录')).toBeTruthy();
  });

  it('错误态：展示错误消息与重试', async () => {
    usePortalTodoTabStore.setState({ activeKey: 'pending' });
    vi.mocked(tasksApi.fetchMyTasks).mockRejectedValue(new Error('加载爆炸'));
    renderTab();
    expect(await screen.findByText('加载爆炸')).toBeTruthy();
    expect(screen.getByText('重试')).toBeTruthy();
  });

  // ---------------------------------------------------------------------
  // 本轮（状态提升 + 新增「全部」）：子 Tab 键从组件内 useState 提升到全局 store
  // ---------------------------------------------------------------------
  it('TODO_TABS 首项与 store 的默认子 Tab 键一致（防止两处漂移）', () => {
    // 默认键已搬到 stores/portal-todo-tab-store.ts 单点定义（子 Tab 初值随状态一起搬），
    // TODO_TABS[0] 必须仍是它；表中各键的集合也一并钉住（本轮首项为 'all'）。
    expect(TODO_TABS[0].key).toBe(DEFAULT_TODO_TAB_KEY);
    expect(TODO_TABS[0].key).toBe('all');
    expect(TODO_TABS.map((t) => t.key)).toEqual([
      'all',
      'pending',
      'approving',
      'approved',
      'rejected',
      'mySent',
      'myHandled',
    ]);
  });

  it('子 Tab 键提升到 store：外部 setActiveKey("mySent") 驱动本组件换源（首页板块靠这条桥接）', async () => {
    renderTab();
    // 默认源：/tasks/matters（默认子 Tab「全部」）
    await waitFor(() => expect(tasksApi.fetchPortalMatters).toHaveBeenCalled());

    // 模拟首页「我发起的 → 查看全部」：只写 store，不碰组件实例。
    act(() => {
      usePortalTodoTabStore.getState().setActiveKey('mySent');
    });

    // 换源生效：走 /workflow/instances/my，且子 Tab 条选中「我发起的」。
    await waitFor(() =>
      expect(workflowApi.fetchMyProcesses).toHaveBeenCalledWith('1', '700001', undefined, 1, 20, undefined),
    );
    expect(screen.getByRole('tab', { name: '我发起的' }).getAttribute('data-state')).toBe('active');
    expect(usePortalTodoTabStore.getState().activeKey).toBe('mySent');
  });
});
