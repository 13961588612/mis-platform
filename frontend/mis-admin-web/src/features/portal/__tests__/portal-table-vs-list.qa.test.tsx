// @vitest-environment jsdom
/**
 * 【QA 独立验证 · B6】「首页板 = 列表 / 门户内页 = 表格」的结构对齐核查。
 *
 * <p>背景：工程师把 `portal-tabs.test.tsx` 里首页三板块的整行选择器从 `tr` 回退为
 * `button`（本轮首页回退列表所致）。QA 需**独立确认这不是「把断言改松」**：
 * 「门户内页（待办事项 / 消息中心 Tab）」必须**仍是表格**（表头存在、整行是 `tr`），
 * 「首页三板块」必须**不是表格**（整行是 `button`）。
 *
 * <p>做法与工程师用例解耦：本文件**直接渲染真实内页组件**
 * （`PortalTodoTab` / `PortalMessageTab`）断言其为表格，直接渲染三个 Board 断言其非表格；
 * 两边都用「角色视角」（`columnheader`）作为硬证据，避免只查 DOM 标签。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalTodoTab } from '../tabs/portal-todo-tab';
import { PortalMessageTab } from '../tabs/portal-message-tab';
import { TaskBoard } from '../components/task-board';
import { MessageBoard } from '../components/message-board';
import { ProcessBoard } from '../components/process-board';
import * as messagesApi from '@/lib/api/messages';
import * as tasksApi from '@/lib/api/tasks';
import * as workflowApi from '@/lib/api/workflow';
import * as platformApi from '@/lib/api/platform';
import * as bizCategoryApi from '@/lib/api/biz-category';
import { useAuthStore } from '@/stores/auth-store';
import { usePortalTabStore } from '@/stores/portal-tab-store';
import { DEFAULT_TODO_TAB_KEY, usePortalTodoTabStore } from '@/stores/portal-todo-tab-store';
import type { MessageItem } from '@/lib/api/messages';
import type { TaskItem } from '@/lib/api/tasks';
import type { WfInstance } from '@/lib/api/workflow';

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: 'light' }),
}));
vi.mock('@/lib/api/messages', () => ({
  fetchInbox: vi.fn(),
  fetchMessageStats: vi.fn(),
  searchMessages: vi.fn(),
  fetchMessageDetail: vi.fn(),
  markMessagesRead: vi.fn(),
  replyMessage: vi.fn(),
}));
vi.mock('@/lib/api/tasks', () => ({
  fetchMyTasks: vi.fn(),
  fetchHandledTasks: vi.fn(),
  fetchTaskStats: vi.fn(),
  handleTask: vi.fn(),
  fetchPortalMatters: vi.fn(),
  fetchCcTasks: vi.fn(),
}));
vi.mock('@/lib/api/workflow', () => ({ fetchMyProcesses: vi.fn() }));
vi.mock('@/lib/api/platform', () => ({ fetchApps: vi.fn(), fetchDashboardStats: vi.fn() }));
vi.mock('@/lib/api/biz-category', () => ({ fetchBizCategories: vi.fn() }));
vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: () => null,
}));
vi.mock('@/features/portal/components/message-detail-drawer', () => ({
  MessageDetailDrawer: () => null,
}));

const emptyPage = { page: 1, size: 20, total: 0, list: [] as never[] };

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: '9001',
    tenantId: '1',
    taskType: 'APPROVE',
    bizType: 'PURCHASE_ORDER',
    bizRefId: 'PO-001',
    bizTitle: '待办-甲',
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
    initiatorName: null,
    initiatorOrgName: null,
    ...overrides,
  };
}
function message(overrides: Partial<MessageItem> = {}): MessageItem {
  return {
    id: '5001',
    tenantId: '1',
    msgType: 'APPROVAL',
    category: 'TASK',
    title: '消息-甲',
    summary: null,
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
    appCode: null,
    bizType: null,
    ...overrides,
  };
}
function wf(overrides: Partial<WfInstance> = {}): WfInstance {
  return {
    id: '128',
    definitionCode: 'PURCHASE_APPROVAL',
    startedFormCode: 'PUR_FORM',
    businessType: 'PURCHASE_ORDER',
    businessId: 'PO-001',
    status: 'RUNNING',
    initiatorId: '700001',
    initiatorName: '测试员',
    initiatorOrgName: null,
    currentNodeCode: 'finance',
    currentNodeName: null,
    progress: '50%',
    postProcessStatus: 'WAITING',
    postRetryCount: 0,
    createdAt: '2026-10-08T10:00:00',
    completedAt: null,
    appCode: null,
    title: null,
    ...overrides,
  };
}

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
  usePortalTabStore.setState({ activeTab: 'home' });
  usePortalTodoTabStore.setState({ activeKey: DEFAULT_TODO_TAB_KEY });
  vi.mocked(platformApi.fetchApps).mockResolvedValue([]);
  vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([]);
  vi.mocked(messagesApi.fetchInbox).mockResolvedValue(emptyPage);
  vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 0, total: 0 });
  vi.mocked(messagesApi.markMessagesRead).mockResolvedValue(0);
  vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
  vi.mocked(tasksApi.fetchPortalMatters).mockResolvedValue(emptyPage);
  vi.mocked(tasksApi.fetchHandledTasks).mockResolvedValue(emptyPage);
  vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue(emptyPage);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('[QA·独立] B6 门户内页 = 表格', () => {
  it('待办事项 Tab：仍是 <table>，columnheader>0，整行是 <tr role=button>', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ ...emptyPage, total: 1, list: [task({ bizTitle: '表内待办' })] });
    usePortalTodoTabStore.setState({ activeKey: 'pending' });
    render(
      <MemoryRouter>
        <PortalTodoTab />
      </MemoryRouter>,
    );
    await screen.findByText('表内待办');
    expect(document.querySelector('table')).toBeTruthy();
    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBeGreaterThan(0);
    const tr = screen.getByText('表内待办').closest('tr');
    expect(tr).toBeTruthy();
    expect(tr!.getAttribute('role')).toBe('button');
    // 反向：内页不得用首页那种「li>button」整行
    expect(screen.getByText('表内待办').closest('li')).toBeNull();
  });

  it('消息中心 Tab：仍是 <table>，columnheader>0，整行是 <tr role=button>', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ ...emptyPage, total: 1, list: [message({ title: '表内消息' })] });
    render(
      <MemoryRouter>
        <PortalMessageTab />
      </MemoryRouter>,
    );
    await screen.findByText('表内消息');
    expect(document.querySelector('table')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0);
    const tr = screen.getByText('表内消息').closest('tr');
    expect(tr).toBeTruthy();
    expect(tr!.getAttribute('role')).toBe('button');
    expect(screen.getByText('表内消息').closest('li')).toBeNull();
  });
});

describe('[QA·独立] B6 首页三板块 = 列表（与内页表格形成对照）', () => {
  it('三板块集体：均无 <table> / columnheader，整行为 button', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ ...emptyPage, total: 1, list: [task({ bizTitle: '首页待办' })] });
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ ...emptyPage, total: 1, list: [message({ title: '首页消息' })] });
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({ ...emptyPage, total: 1, list: [wf()] });
    render(
      <MemoryRouter>
        <TaskBoard tenantId="1" userId="700001" />
        <MessageBoard tenantId="1" userId="700001" />
        <ProcessBoard tenantId="1" userId="700001" />
      </MemoryRouter>,
    );
    await screen.findByText('首页待办');
    await screen.findByText('首页消息');
    await screen.findByText('PURCHASE_ORDER / PO-001');
    expect(document.querySelector('table')).toBeNull();
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
    for (const title of ['首页待办', '首页消息', 'PURCHASE_ORDER / PO-001']) {
      const li = screen.getByText(title).closest('li');
      expect(li).toBeTruthy();
      expect((li as HTMLElement).querySelector(':scope > button')?.tagName).toBe('BUTTON');
    }
  });
});
