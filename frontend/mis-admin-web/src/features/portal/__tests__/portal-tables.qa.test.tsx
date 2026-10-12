// @vitest-environment jsdom
/**
 * 【QA 独立验证 · B】门户「消息中心 / 待办事项」列表改表格 + 新增两列。
 *
 * <p><b>为什么另起一个文件</b>：本轮要求「自己另写断言，别只复跑工程师的用例」。
 * 工程师的 `todo-tabs.test.tsx` / `portal-tabs.test.tsx` 已覆盖容器与点行；本文件专门钉住
 * **两列取值的三态语义**与**整行可点（R-1）**，并覆盖 `sent` 源取 `businessType` 这条
 * 只在 `todo-adapters.fromWfInstance` 里成立的链路：
 * <ul>
 *   <li>两表**确实**渲染出 `<th>平台 / 关联应用</th>` 与 `<th>业务类型</th>`（列位取整表头数组）；</li>
 *   <li>取值三态（应用）：`null → 平台` / 命中应用列表取 `name` / 未命中或拉取失败回退原始 code；</li>
 *   <li>取值三态（业务类型）：`null → —` / 命中业务分类取 `name` / 未命中回退原始 code；</li>
 *   <li>`sent` 源（`WfInstance`）业务类型取 `businessType`（造 `PURCHASE_ORDER` 实例断言列值）；</li>
 *   <li>整行可点 R-1：`<tr role=button tabIndex>`，点击 / Enter / Space 均可触发；</li>
 *   <li>显式搜索回归：输入不请求、点「搜索」才请求（本轮表格改造不得改坏）。</li>
 * </ul>
 *
 * <p>mock 范式：api 层整体 `vi.mock`；zustand 用 `setState` 直塞并逐例复位；`next-themes`
 * 显式 mock；两抽屉替换为轻量替身。**不断 className 子串**（token 判等一律免用）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalMessageTab } from '../tabs/portal-message-tab';
import { PortalTodoTab } from '../tabs/portal-todo-tab';
import * as messagesApi from '@/lib/api/messages';
import * as tasksApi from '@/lib/api/tasks';
import * as workflowApi from '@/lib/api/workflow';
import * as platformApi from '@/lib/api/platform';
import * as bizCategoryApi from '@/lib/api/biz-category';
import { useAuthStore } from '@/stores/auth-store';
import { DEFAULT_TODO_TAB_KEY, usePortalTodoTabStore } from '@/stores/portal-todo-tab-store';
import type { MessageItem } from '@/lib/api/messages';
import type { TaskItem } from '@/lib/api/tasks';
import type { WfInstance } from '@/lib/api/workflow';
import type { BizCategoryItem } from '@/lib/api/biz-category';
import type { AppItem } from '@/types/api';

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
}));

vi.mock('@/lib/api/workflow', () => ({
  fetchMyProcesses: vi.fn(),
}));

vi.mock('@/lib/api/platform', () => ({
  fetchApps: vi.fn(),
}));

vi.mock('@/lib/api/biz-category', () => ({
  fetchBizCategories: vi.fn(),
}));

vi.mock('@/features/portal/components/message-detail-drawer', () => ({
  MessageDetailDrawer: ({ open, messageId }: { open: boolean; messageId: string | null }) =>
    open ? <div data-testid="message-drawer" data-message={messageId ?? ''} /> : null,
}));

vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: ({ open, instanceId }: { open: boolean; instanceId: string | null }) =>
    open ? <div data-testid="todo-drawer" data-instance={instanceId ?? ''} /> : null,
}));

const emptyPage = { page: 1, size: 20, total: 0, list: [] };

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

function bizCategory(code: string, name: string): BizCategoryItem {
  return {
    id: '1',
    tenantId: '1',
    parentId: null,
    code,
    name,
    description: null,
    sortOrder: 1,
    config: null,
    children: null,
    createdAt: '2026-10-01T00:00:00',
    updatedAt: '2026-10-01T00:00:00',
  };
}

/** 应用列表项（`fetchApps` 返回 `AppItem[]`；本测试只依赖 code/name）。 */
function app(code: string, name: string): AppItem {
  return {
    id: '1',
    tenantId: '1',
    code,
    name,
    icon: null,
    basePath: null,
    description: null,
    portalGroup: null,
    kind: 'app',
    runtime: 'host',
    sort: 1,
    status: 1,
    enterable: true,
  };
}

function renderMessageTab() {
  return render(
    <MemoryRouter>
      <PortalMessageTab />
    </MemoryRouter>,
  );
}

function renderTodoTab(activeKey: string = 'pending') {
  // 本轮「全部」成为**默认**子 Tab（source='matters'）。本文件的待办用例针对 `my` 源，
  // 故显式切到 `pending`；sent 源用例传入 `'mySent'`。
  usePortalTodoTabStore.setState({ activeKey });
  return render(
    <MemoryRouter>
      <PortalTodoTab />
    </MemoryRouter>,
  );
}

/** 表头文本数组（去空白）。 */
function headerCells(): string[] {
  const table = document.querySelector('table');
  if (!table) throw new Error('未渲染表格');
  return Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());
}

/** 由某条标题文本定位其 `<tr>` 的 td 列表（去空白）。 */
function rowCells(titleText: string): string[] {
  const cell = screen.getByText(titleText);
  const tr = cell.closest('tr');
  if (!tr) throw new Error(`未找到标题为「${titleText}」的数据行`);
  return within(tr)
    .getAllByRole('cell')
    .map((td) => (td.textContent ?? '').trim());
}

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
  // lookups 默认空表（各用例按需覆写）。
  vi.mocked(platformApi.fetchApps).mockResolvedValue([]);
  vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([]);
  vi.mocked(messagesApi.fetchInbox).mockResolvedValue(emptyPage);
  vi.mocked(messagesApi.searchMessages).mockResolvedValue(emptyPage);
  vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 0, total: 0 });
  vi.mocked(messagesApi.markMessagesRead).mockResolvedValue(0);
  vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
  vi.mocked(tasksApi.fetchHandledTasks).mockResolvedValue(emptyPage);
  vi.mocked(tasksApi.fetchPortalMatters).mockResolvedValue(emptyPage);
  vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue(emptyPage);
  // 模块级单例复位。
  usePortalTodoTabStore.setState({ activeKey: DEFAULT_TODO_TAB_KEY });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('[QA-B] 消息中心表 · 两列表头与取值三态', () => {
  it('表头恰为 [标题, 平台 / 关联应用, 业务类型, 发送人, 发起时间]', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ ...emptyPage, total: 1, list: [message()] });
    renderMessageTab();
    await screen.findByText('消息-甲');
    expect(headerCells()).toEqual(['标题', '平台 / 关联应用', '业务类型', '发送人', '发起时间']);
  });

  it('三态取值：null→平台/—；命中→name；未命中→回退 code（逐行）', async () => {
    vi.mocked(platformApi.fetchApps).mockResolvedValue([app('kb', '知识库')]);
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([
      bizCategory('PURCHASE_ORDER', '采购订单'),
    ]);
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 3,
      list: [
        message({ id: '1', title: '平台无类型', appCode: null, bizType: null }),
        message({ id: '2', title: '命中', appCode: 'kb', bizType: 'PURCHASE_ORDER' }),
        message({ id: '3', title: '幽灵值', appCode: 'ghost', bizType: 'GHOST' }),
      ],
    });
    renderMessageTab();
    await screen.findByText('平台无类型');

    // 行1：null → 「平台」「—」
    await waitFor(() => expect(rowCells('平台无类型')[1]).toBe('平台'));
    expect(rowCells('平台无类型')[2]).toBe('—');

    // 行2：命中映射 → name
    await waitFor(() => expect(rowCells('命中')[1]).toBe('知识库'));
    expect(rowCells('命中')[2]).toBe('采购订单');

    // 行3：未命中 → 回退原始 code
    expect(rowCells('幽灵值')[1]).toBe('ghost');
    expect(rowCells('幽灵值')[2]).toBe('GHOST');
  });

  it('应用列表拉取失败 → 静默降级：非空 appCode 回退 code，null 仍为「平台」', async () => {
    vi.mocked(platformApi.fetchApps).mockRejectedValue(new Error('apps down'));
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 2,
      list: [
        message({ id: '1', title: '平台行', appCode: null, bizType: null }),
        message({ id: '2', title: 'kb行', appCode: 'kb', bizType: null }),
      ],
    });
    renderMessageTab();
    await screen.findByText('平台行');
    await waitFor(() => expect(rowCells('kb行')[1]).toBe('kb'));
    expect(rowCells('平台行')[1]).toBe('平台');
  });

  it('整行可点 R-1：点击 / Enter / Space 均打开消息抽屉且携带该行 id', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [message({ id: '5555', title: '点我行', read: true })],
    });
    renderMessageTab();
    const tr = (await screen.findByText('点我行')).closest('tr')!;
    expect(tr.getAttribute('role')).toBe('button');
    expect(tr.getAttribute('tabindex')).toBe('0');

    fireEvent.click(tr);
    expect(await screen.findByTestId('message-drawer')).toBeTruthy();
    expect(screen.getByTestId('message-drawer').getAttribute('data-message')).toBe('5555');
  });

  it('整行可点 R-1：Enter 打开抽屉', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [message({ id: '6666', title: '回车行', read: true })],
    });
    renderMessageTab();
    const tr = (await screen.findByText('回车行')).closest('tr')!;
    fireEvent.keyDown(tr, { key: 'Enter' });
    expect(await screen.findByTestId('message-drawer')).toBeTruthy();
    expect(screen.getByTestId('message-drawer').getAttribute('data-message')).toBe('6666');
  });

  it('整行可点 R-1：Space 打开抽屉', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [message({ id: '7777', title: '空格行', read: true })],
    });
    renderMessageTab();
    const tr = (await screen.findByText('空格行')).closest('tr')!;
    fireEvent.keyDown(tr, { key: ' ' });
    expect(await screen.findByTestId('message-drawer')).toBeTruthy();
    expect(screen.getByTestId('message-drawer').getAttribute('data-message')).toBe('7777');
  });

  it('显式搜索回归：输入不请求、点「搜索」才以 keyword 请求', async () => {
    renderMessageTab();
    await waitFor(() => expect(messagesApi.fetchInbox).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText('消息关键词');
    fireEvent.change(input, { target: { value: 'ZKW' } });
    expect(messagesApi.fetchInbox).toHaveBeenCalledTimes(1);
    expect(messagesApi.searchMessages).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    await waitFor(() => expect(messagesApi.searchMessages).toHaveBeenCalledTimes(1));
    expect(messagesApi.searchMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'ZKW', page: 1 }),
    );
  });
});

describe('[QA-B] 待办事项表 · 两列表头与取值三态', () => {
  it('表头恰为 [标题, 业务编号 / 流程, 平台 / 关联应用, 业务类型, 发起人 / 处理人, 发起时间]', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ ...emptyPage, total: 1, list: [task()] });
    renderTodoTab();
    await screen.findByText('待办-甲');
    expect(headerCells()).toEqual([
      '标题',
      '业务编号 / 流程',
      '平台 / 关联应用',
      '业务类型',
      '发起人 / 处理人',
      '发起时间',
    ]);
  });

  it('取值三态（待办源）：null appCode→平台；命中→name；未命中→回退 code', async () => {
    vi.mocked(platformApi.fetchApps).mockResolvedValue([app('kb', '知识库')]);
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([
      bizCategory('PURCHASE_ORDER', '采购订单'),
    ]);
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      ...emptyPage,
      total: 3,
      list: [
        // ⚠️ `TaskItem.bizType` 是**非空 string**（见 lib/api/tasks.ts），故待办源无法造出
        // `bizType=null` 的行；「业务类型」列的 `null → —` 分支由「消息中心」表（MessageItem.bizType
        // 可空）与 hook 直测（use-portal-lookups.qa.test.ts）覆盖，此处只覆盖可达的三态。
        task({ id: '1', bizTitle: '平台应用', appCode: null, bizType: 'PURCHASE_ORDER' }),
        task({ id: '2', bizTitle: '命中', appCode: 'kb', bizType: 'PURCHASE_ORDER' }),
        task({ id: '3', bizTitle: '幽灵值', appCode: 'ghost', bizType: 'GHOST' }),
      ],
    });
    renderTodoTab();
    await screen.findByText('平台应用');

    // 列位：0 标题 / 1 业务编号 / 2 平台应用 / 3 业务类型 / 4 发起处理 / 5 时间
    await waitFor(() => expect(rowCells('平台应用')[2]).toBe('平台'));
    expect(rowCells('平台应用')[3]).toBe('采购订单');

    await waitFor(() => expect(rowCells('命中')[2]).toBe('知识库'));
    expect(rowCells('命中')[3]).toBe('采购订单');

    expect(rowCells('幽灵值')[2]).toBe('ghost');
    expect(rowCells('幽灵值')[3]).toBe('GHOST');
  });

  it('sent 源（WfInstance）：业务类型取 businessType，命中映射显示 name', async () => {
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([
      bizCategory('PURCHASE_ORDER', '采购订单'),
    ]);
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [wfInstance({ businessType: 'PURCHASE_ORDER', businessId: 'PO-001' })],
    });
    // 切到「我发起的」源（模块级 store，渲染前写入）。
    renderTodoTab('mySent');

    // 行标题为 `${businessType} / ${businessId}`（由 fromWfInstance 拼装）。
    await screen.findByText('PURCHASE_ORDER / PO-001');
    // 业务类型列（index 3）来自 businessType → 命中映射名「采购订单」。
    await waitFor(() => expect(rowCells('PURCHASE_ORDER / PO-001')[3]).toBe('采购订单'));
  });

  it('整行可点 R-1：点击有实例的行打开待办抽屉并携带 instanceId', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [task({ id: '9001', bizTitle: '有流程行', metadata: JSON.stringify({ wfInstanceId: 128 }) })],
    });
    renderTodoTab();
    const tr = (await screen.findByText('有流程行')).closest('tr')!;
    expect(tr.getAttribute('role')).toBe('button');
    fireEvent.click(tr);
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
  });

  it('整行可点 R-1：Enter 打开抽屉', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [task({ id: '9002', bizTitle: '回车行', metadata: JSON.stringify({ wfInstanceId: 256 }) })],
    });
    renderTodoTab();
    const tr = (await screen.findByText('回车行')).closest('tr')!;
    fireEvent.keyDown(tr, { key: 'Enter' });
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('256');
  });

  it('显式搜索回归：输入不请求、点「搜索」才以 keyword 请求', async () => {
    renderTodoTab();
    await waitFor(() => expect(tasksApi.fetchMyTasks).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText('待办关键词');
    fireEvent.change(input, { target: { value: 'ZKW' } });
    expect(tasksApi.fetchMyTasks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    await waitFor(() => expect(tasksApi.fetchMyTasks).toHaveBeenCalledTimes(2));
    expect(tasksApi.fetchMyTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: 'ZKW', page: 1 }),
    );
  });
});
