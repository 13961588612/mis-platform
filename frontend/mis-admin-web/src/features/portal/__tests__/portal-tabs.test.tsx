// @vitest-environment jsdom
/**
 * 门户三 Tab 容器测试（T01）。
 *
 * 覆盖：
 * 1. 「首页 / 待办事项 / 消息中心」三个 Tab 均渲染；
 * 2. 默认选中「首页」，且首页内容（欢迎语 + 工作台板块 + AppRail）与现状一致；
 * 3. 点击「待办事项」→ 切到 Todo 壳（首页内容卸载）；点击「消息中心」→ 切到 Message 壳；
 * 4. **不发生路由跳转**：Tab 切换纯本地 `useState`，`useNavigate` 不被调用、pathname 不变。
 *    （这是本批的核心红线：三 Tab 绝不入 URL，规避 keep-alive `PAGE_MAP`/`useParams` 坑。）
 * 5. **T05 集成**：两抽屉可开——待办点行开待办抽屉（携 instanceId）、消息点行开消息抽屉（携 messageId）。
 *    抽屉以轻量替身替换（其内部行为由 `todo-tabs.test.tsx` / `message-reply-drawer.test.tsx` 覆盖）。
 *
 * mock 范式（对齐 `portal-page.smoke.test.tsx`）：
 * - 整体替换 api 模块，避免真实 axios/fetch；
 * - zustand 用 `useAuthStore.setState` 直接塞状态；
 * - `next-themes` 显式 mock（子组件可能间接用到）；
 * - `useNavigate` 用 spy 替换，用于断言「未发生跳转」；
 * - 两个抽屉替身（T05）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalPage } from '../portal-page';
import * as platformApi from '@/lib/api/platform';
import * as tasksApi from '@/lib/api/tasks';
import * as messagesApi from '@/lib/api/messages';
import * as workflowApi from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: 'light' }),
}));

vi.mock('@/lib/api/platform', () => ({
  fetchApps: vi.fn(),
  fetchDashboardStats: vi.fn(),
}));

vi.mock('@/lib/api/auth', () => ({
  logout: vi.fn(),
}));

vi.mock('@/lib/api/tasks', () => ({
  fetchMyTasks: vi.fn(),
  fetchHandledTasks: vi.fn(),
  fetchTaskStats: vi.fn(),
  handleTask: vi.fn(),
}));

vi.mock('@/lib/api/messages', () => ({
  fetchInbox: vi.fn(),
  fetchMessageStats: vi.fn(),
  searchMessages: vi.fn(),
  fetchMessageDetail: vi.fn(),
  markMessagesRead: vi.fn(),
  replyMessage: vi.fn(),
}));

vi.mock('@/lib/api/workflow', () => ({
  fetchMyProcesses: vi.fn(),
}));

// 两抽屉替身（T05 集成）：本文件只验证「行点击 → 抽屉打开并带对 ID」的接线，
// 抽屉内部（表单渲染 / 回复回显 / 三动作）由各自单测覆盖。
vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: ({ open, instanceId }: { open: boolean; instanceId: string | null }) =>
    open ? <div data-testid="todo-drawer" data-instance={instanceId ?? ''} /> : null,
}));
vi.mock('@/features/portal/components/message-detail-drawer', () => ({
  MessageDetailDrawer: ({ open, messageId }: { open: boolean; messageId: string | null }) =>
    open ? <div data-testid="message-drawer" data-message={messageId ?? ''} /> : null,
}));

vi.mock('@/lib/nav/iframe-apps', () => ({
  registerIframeApps: vi.fn(),
  getIframeApp: vi.fn(),
  useIframeRegistryVersion: vi.fn(() => 0),
}));

const emptyPage = { page: 1, size: 20, total: 0, list: [] };

const sampleApps = [
  {
    id: '1',
    tenantId: '1',
    code: 'system',
    name: '系统管理',
    icon: 'Settings',
    basePath: '/system',
    description: null,
    portalGroup: 'governance',
    kind: 'app',
    runtime: 'host',
    sort: 1,
    status: 1,
    enterable: true,
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/portal']}>
      <PortalPage />
    </MemoryRouter>,
  );
}

describe('PortalPage 三 Tab 容器', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 'test-token',
      expiresAt: Date.now() + 3_600_000,
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
    vi.mocked(platformApi.fetchApps).mockResolvedValue(sampleApps);
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
    vi.mocked(tasksApi.fetchTaskStats).mockResolvedValue({ pending: 0, urgent: 0, overdue: 0 });
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue(emptyPage);
    vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 0, total: 0 });
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue(emptyPage);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染「首页 / 待办事项 / 消息中心」三个 Tab', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: '首页' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '待办事项' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '消息中心' })).toBeTruthy();
  });

  it('默认选中「首页」，首页内容与现状一致（欢迎语 + 工作台板块 + AppRail）', async () => {
    renderPage();
    expect(await screen.findByText('你好，测试员')).toBeTruthy();
    // 工作台板块 + AppRail（与 portal-page.smoke 同口径）
    expect(screen.getByText('消息与通知')).toBeTruthy();
    expect(screen.getByText('我的应用')).toBeTruthy();
    expect((await screen.findAllByText('系统管理')).length).toBeGreaterThan(0);
    // 首页为默认态 ⇒ Todo/Message 不应挂载（Todo 的搜索框、Message 的搜索框都不出现）
    expect(screen.queryByLabelText('待办关键词')).toBeNull();
    expect(screen.queryByLabelText('消息关键词')).toBeNull();
  });

  it('点击「待办事项」切到 Todo（真实组件），首页内容卸载', async () => {
    renderPage();
    await screen.findByText('你好，测试员');

    // Radix Tabs Trigger 在 onMouseDown 上激活（click 不触发），故用 mouseDown。
    fireEvent.mouseDown(screen.getByRole('tab', { name: '待办事项' }), { button: 0 });

    // T03a 起「待办事项」为真实组件：以搜索框 + 子 Tab 作为挂载标志。
    expect(await screen.findByLabelText('待办关键词')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '待处理' })).toBeTruthy();
    expect(screen.queryByText('你好，测试员')).toBeNull();
  });

  it('点击「消息中心」切到 Message（真实组件），首页内容卸载', async () => {
    renderPage();
    await screen.findByText('你好，测试员');

    fireEvent.mouseDown(screen.getByRole('tab', { name: '消息中心' }), { button: 0 });

    // T04 起「消息中心」为真实组件：以搜索框 + 四类子 Tab 作为挂载标志。
    expect(await screen.findByLabelText('消息关键词')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '审批' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '系统告警' })).toBeTruthy();
    expect(screen.queryByLabelText('待办关键词')).toBeNull();
    expect(screen.queryByText('你好，测试员')).toBeNull();
  });

  it('Tab 切换不发生路由跳转（useNavigate 未被调用、不新增路由）', async () => {
    renderPage();
    await screen.findByText('你好，测试员');

    fireEvent.mouseDown(screen.getByRole('tab', { name: '待办事项' }), { button: 0 });
    fireEvent.mouseDown(screen.getByRole('tab', { name: '消息中心' }), { button: 0 });
    fireEvent.mouseDown(screen.getByRole('tab', { name: '首页' }), { button: 0 });
    await screen.findByText('你好，测试员');

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('T05 集成：两抽屉可开——待办点行开待办抽屉（携 instanceId）、消息点行开消息抽屉（携 messageId）', async () => {
    // 待办：一条带 wfInstanceId 的待处理（行点击才可开抽屉）。
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [
        {
          id: '9001',
          tenantId: '1',
          taskType: 'APPROVE',
          bizType: 'PURCHASE_ORDER',
          bizRefId: 'PO-001',
          bizTitle: '采购单审批-甲',
          targetEntity: null,
          assigneeId: '700001',
          assigneeName: '测试员',
          status: 'PENDING',
          priority: 2,
          dueDate: null,
          metadata: JSON.stringify({ wfInstanceId: 128 }),
          result: null,
          read: false,
          completedAt: null,
          createdAt: '2026-10-08T10:00:00',
        },
      ],
    });
    // 消息：一条普通消息（点行开抽屉）。
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [
        {
          id: '5001',
          tenantId: '1',
          msgType: 'APPROVAL',
          category: 'TASK',
          title: '消息-甲',
          summary: '摘要',
          senderId: '9',
          senderName: '系统',
          referenceTaskId: null,
          receiverGroupType: 'SINGLE',
          read: true,
          readCount: 1,
          totalCount: 1,
          createdAt: '2026-10-08T10:00:00',
          instanceId: null,
          canReply: false,
        },
      ],
    });
    renderPage();
    await screen.findByText('你好，测试员');

    // 待办 Tab：点行 → 待办抽屉打开，携带该行 instanceId（不由 navigate 承担）。
    fireEvent.mouseDown(screen.getByRole('tab', { name: '待办事项' }), { button: 0 });
    const todoRow = (await screen.findByText('采购单审批-甲')).closest('button');
    expect(todoRow).toBeTruthy();
    fireEvent.click(todoRow!);
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
    expect(navigateSpy).not.toHaveBeenCalled();

    // 消息 Tab：切过去后待办抽屉随面板卸载；点消息行 → 消息抽屉打开，携带 messageId。
    fireEvent.mouseDown(screen.getByRole('tab', { name: '消息中心' }), { button: 0 });
    const msgRow = (await screen.findByText('消息-甲')).closest('button');
    expect(msgRow).toBeTruthy();
    fireEvent.click(msgRow!);
    expect(await screen.findByTestId('message-drawer')).toBeTruthy();
    expect(screen.getByTestId('message-drawer').getAttribute('data-message')).toBe('5001');
    // 切 Tab 卸载上一面板 ⇒ 待办抽屉随之关闭（期望语义）。
    expect(screen.queryByTestId('todo-drawer')).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
