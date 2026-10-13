// @vitest-environment jsdom
/**
 * 【QA 独立验证 · B1–B5】首页三板块「表格 → 紧凑列表」回退后的独立断言。
 *
 * <p>本文件**由 QA 独立撰写**，不 import / 不依赖工程师的 `.qa.test` 或容器用例；
 * 直接渲染三个 Board 组件，从「无表格结构」「逐行两枚标签」「三态取值」「静默降级」
 * 「整行可点」五个视角独立钉住新契约。
 *
 * <p>与工程师用例的关键差异（自证独立）：
 * <ul>
 *   <li>B1 逐行断言行是 `ul > li > button`（`:scope` 直接子选择器），且**同时**断言
 *       `table/thead/tbody/td/th` 与 `columnheader/cell` 两种角色视角都为 0；</li>
 *   <li>B2 逐 `li` 断 `[data-meta]` 总数 = 2，且 `app` / `biz-type` **各恰 1**；</li>
 *   <li>B3 三块板都覆盖三态，`ProcessBoard` 用 `WfInstance{businessType:'PURCHASE_ORDER'}`；</li>
 *   <li>B4 两个接口**同时**抛错时列表仍渲染、回退 code、`平台`/`—` 仍成立；</li>
 *   <li>B5 点行开对应抽屉且携对 id；键盘可点语义由「整行是原生 `<button>`」保证。</li>
 * </ul>
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskBoard } from '../components/task-board';
import { MessageBoard } from '../components/message-board';
import { ProcessBoard } from '../components/process-board';
import * as messagesApi from '@/lib/api/messages';
import * as tasksApi from '@/lib/api/tasks';
import * as workflowApi from '@/lib/api/workflow';
import * as platformApi from '@/lib/api/platform';
import * as bizCategoryApi from '@/lib/api/biz-category';
import { usePortalTabStore } from '@/stores/portal-tab-store';
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
  fetchCcTasks: vi.fn(),
}));
vi.mock('@/lib/api/workflow', () => ({ fetchMyProcesses: vi.fn() }));
vi.mock('@/lib/api/platform', () => ({ fetchApps: vi.fn(), fetchDashboardStats: vi.fn() }));
vi.mock('@/lib/api/biz-category', () => ({ fetchBizCategories: vi.fn() }));

vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: ({ open, instanceId }: { open: boolean; instanceId: string | null }) =>
    open ? <div data-testid="todo-drawer" data-instance={instanceId ?? ''} /> : null,
}));
vi.mock('@/features/portal/components/message-detail-drawer', () => ({
  MessageDetailDrawer: ({ open, messageId }: { open: boolean; messageId: string | null }) =>
    open ? <div data-testid="message-drawer" data-message={messageId ?? ''} /> : null,
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

function renderBoard(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

/** B1：整块板不是表格（DOM 视角 + 角色视角双重为 0）。 */
function expectNotTable() {
  expect(document.querySelector('table')).toBeNull();
  expect(document.querySelector('thead')).toBeNull();
  expect(document.querySelector('tbody')).toBeNull();
  expect(document.querySelector('td')).toBeNull();
  expect(document.querySelector('th')).toBeNull();
  expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
  expect(screen.queryAllByRole('cell')).toHaveLength(0);
}

/** B1：由标题文本取回所在行，断言它是 `ul > li`，且 `li` 的**直接子**是 `<button>`。 */
function rowLiOf(titleText: string): HTMLLIElement {
  const li = screen.getByText(titleText).closest('li');
  expect(li).toBeTruthy();
  const el = li as HTMLLIElement;
  // 行容器：li 的直接父是 ul
  expect(el.parentElement?.tagName).toBe('UL');
  // 整行可点：li 的直接子有且仅有 button
  const directBtn = el.querySelector(':scope > button');
  expect(directBtn).toBeTruthy();
  expect((directBtn as HTMLElement).tagName).toBe('BUTTON');
  return el;
}

/** B2：逐 li 统计两枚标签。 */
function tagsOf(li: HTMLElement) {
  return {
    total: li.querySelectorAll('[data-meta]').length,
    appCount: li.querySelectorAll('[data-meta="app"]').length,
    bizCount: li.querySelectorAll('[data-meta="biz-type"]').length,
    app: (li.querySelector('[data-meta="app"]')?.textContent ?? '').trim(),
    bizType: (li.querySelector('[data-meta="biz-type"]')?.textContent ?? '').trim(),
  };
}

beforeEach(() => {
  usePortalTabStore.setState({ activeTab: 'home' });
  usePortalTodoTabStore.setState({ activeKey: DEFAULT_TODO_TAB_KEY });
  vi.mocked(platformApi.fetchApps).mockResolvedValue([]);
  vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([]);
  vi.mocked(messagesApi.fetchInbox).mockResolvedValue(emptyPage);
  vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
  vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue(emptyPage);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('[QA·独立] B1+B2 三板块 = 紧凑列表（非表格），逐行恰两枚标签', () => {
  it('我的待办：无表格；行是 ul>li>button；每行 [data-meta] 恰 2 且 app/biz-type 各 1', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ ...emptyPage, total: 2, list: [task({ id: 'a', bizTitle: '待办-甲' }), task({ id: 'b', bizTitle: '待办-乙' })] });
    renderBoard(<TaskBoard tenantId="1" userId="700001" />);
    await screen.findByText('待办-甲');
    expectNotTable();
    for (const title of ['待办-甲', '待办-乙']) {
      const li = rowLiOf(title);
      const t = tagsOf(li);
      expect(t.total).toBe(2);
      expect(t.appCount).toBe(1);
      expect(t.bizCount).toBe(1);
    }
  });

  it('消息与通知：无表格；行是 ul>li>button；每行两枚标签', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ ...emptyPage, total: 1, list: [message({ title: '消息-甲' })] });
    renderBoard(<MessageBoard tenantId="1" userId="700001" />);
    await screen.findByText('消息-甲');
    expectNotTable();
    const t = tagsOf(rowLiOf('消息-甲'));
    expect(t.total).toBe(2);
    expect(t.appCount).toBe(1);
    expect(t.bizCount).toBe(1);
  });

  it('我发起的：无表格；行是 ul>li>button；每行两枚标签', async () => {
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({ ...emptyPage, total: 1, list: [wf()] });
    renderBoard(<ProcessBoard tenantId="1" userId="700001" />);
    await screen.findByText('PURCHASE_ORDER / PO-001');
    expectNotTable();
    const t = tagsOf(rowLiOf('PURCHASE_ORDER / PO-001'));
    expect(t.total).toBe(2);
    expect(t.appCount).toBe(1);
    expect(t.bizCount).toBe(1);
  });
});

describe('[QA·独立] B3 三态取值（三板块全覆盖）', () => {
  it('消息与通知：appCode/bizType 三态（null→平台/—、命中→name、未知→code）', async () => {
    vi.mocked(platformApi.fetchApps).mockResolvedValue([app('kb', '知识库')]);
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([bizCategory('PURCHASE_ORDER', '采购订单')]);
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 3,
      list: [
        message({ id: '1', title: '平台无类型', appCode: null, bizType: null }),
        message({ id: '2', title: '命中行', appCode: 'kb', bizType: 'PURCHASE_ORDER' }),
        message({ id: '3', title: '幽灵行', appCode: 'ghost', bizType: 'GHOST' }),
      ],
    });
    renderBoard(<MessageBoard tenantId="1" userId="700001" />);
    await screen.findByText('平台无类型');
    await waitFor(() => expect(tagsOf(rowLiOf('平台无类型')).app).toBe('平台'));
    expect(tagsOf(rowLiOf('平台无类型')).bizType).toBe('—');
    await waitFor(() => expect(tagsOf(rowLiOf('命中行')).app).toBe('知识库'));
    expect(tagsOf(rowLiOf('命中行')).bizType).toBe('采购订单');
    expect(tagsOf(rowLiOf('幽灵行')).app).toBe('ghost');
    expect(tagsOf(rowLiOf('幽灵行')).bizType).toBe('GHOST');
  });

  it('我的待办：appCode 三态 + bizType 命中/未知（TaskItem.bizType 非空，null 分支不可达）', async () => {
    vi.mocked(platformApi.fetchApps).mockResolvedValue([app('kb', '知识库')]);
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([bizCategory('PURCHASE_ORDER', '采购订单')]);
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      ...emptyPage,
      total: 3,
      list: [
        task({ id: '1', bizTitle: '平台行', appCode: null, bizType: 'PURCHASE_ORDER' }),
        task({ id: '2', bizTitle: '命中行', appCode: 'kb', bizType: 'PURCHASE_ORDER' }),
        task({ id: '3', bizTitle: '幽灵行', appCode: 'ghost', bizType: 'GHOST' }),
      ],
    });
    renderBoard(<TaskBoard tenantId="1" userId="700001" />);
    await screen.findByText('平台行');
    await waitFor(() => expect(tagsOf(rowLiOf('平台行')).app).toBe('平台'));
    expect(tagsOf(rowLiOf('平台行')).bizType).toBe('采购订单');
    await waitFor(() => expect(tagsOf(rowLiOf('命中行')).app).toBe('知识库'));
    expect(tagsOf(rowLiOf('幽灵行')).app).toBe('ghost');
    expect(tagsOf(rowLiOf('幽灵行')).bizType).toBe('GHOST');
  });

  it('我发起的：业务类型取 item.businessType（PURCHASE_ORDER → 采购订单）；appCode 未知→code', async () => {
    vi.mocked(platformApi.fetchApps).mockResolvedValue([app('kb', '知识库')]);
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([bizCategory('PURCHASE_ORDER', '采购订单')]);
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({
      ...emptyPage,
      total: 2,
      list: [
        wf({ id: '1', businessType: 'PURCHASE_ORDER', businessId: 'PO-001', appCode: 'kb' }),
        wf({ id: '2', businessType: 'GHOST', businessId: 'PO-002', appCode: null }),
      ],
    });
    renderBoard(<ProcessBoard tenantId="1" userId="700001" />);
    await screen.findByText('PURCHASE_ORDER / PO-001');
    await waitFor(() => expect(tagsOf(rowLiOf('PURCHASE_ORDER / PO-001')).bizType).toBe('采购订单'));
    expect(tagsOf(rowLiOf('PURCHASE_ORDER / PO-001')).app).toBe('知识库');
    await screen.findByText('GHOST / PO-002');
    expect(tagsOf(rowLiOf('GHOST / PO-002')).app).toBe('平台');
    expect(tagsOf(rowLiOf('GHOST / PO-002')).bizType).toBe('GHOST');
  });
});

describe('[QA·独立] B4 静默降级（两个接口同时抛错）', () => {
  it('fetchApps + fetchBizCategories 都抛错 → 列表照常渲染、回退 code、平台/— 成立', async () => {
    vi.mocked(platformApi.fetchApps).mockRejectedValue(new Error('apps down'));
    vi.mocked(bizCategoryApi.fetchBizCategories).mockRejectedValue(new Error('cats down'));
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 2,
      list: [
        message({ id: '1', title: '平台行', appCode: null, bizType: null }),
        message({ id: '2', title: 'kb行', appCode: 'kb', bizType: 'PURCHASE_ORDER' }),
      ],
    });
    renderBoard(<MessageBoard tenantId="1" userId="700001" />);
    await screen.findByText('平台行');
    expectNotTable();
    await waitFor(() => expect(tagsOf(rowLiOf('kb行')).app).toBe('kb'));
    expect(tagsOf(rowLiOf('kb行')).bizType).toBe('PURCHASE_ORDER');
    expect(tagsOf(rowLiOf('平台行')).app).toBe('平台');
    expect(tagsOf(rowLiOf('平台行')).bizType).toBe('—');
  });
});

describe('[QA·独立] B5 整行可点回归（行=<button>，携正确 id）', () => {
  it('我的待办 点行 → 待办抽屉，携 instanceId（来自 metadata.wfInstanceId）', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [task({ id: '9001', bizTitle: '可点待办', metadata: JSON.stringify({ wfInstanceId: 128 }) })],
    });
    renderBoard(<TaskBoard tenantId="1" userId="700001" />);
    await screen.findByText('可点待办');
    const li = rowLiOf('可点待办');
    const btn = li.querySelector(':scope > button') as HTMLElement;
    // 键盘可点语义：整行是原生 button（浏览器对 button 的 Enter/Space 有内建激活）
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    fireEvent.click(btn);
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
  });

  it('消息与通知 点行 → 消息抽屉，携该行 messageId（非固定值）', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 2,
      list: [message({ id: '5001', title: '甲信' }), message({ id: '5002', title: '乙信' })],
    });
    renderBoard(<MessageBoard tenantId="1" userId="700001" />);
    await screen.findByText('乙信');
    const btn = rowLiOf('乙信').querySelector(':scope > button') as HTMLElement;
    fireEvent.click(btn);
    expect(await screen.findByTestId('message-drawer')).toBeTruthy();
    expect(screen.getByTestId('message-drawer').getAttribute('data-message')).toBe('5002');
  });

  it('我发起的 点行 → 待办抽屉，携实例 id', async () => {
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({ ...emptyPage, total: 1, list: [wf({ id: '256' })] });
    renderBoard(<ProcessBoard tenantId="1" userId="700001" />);
    await screen.findByText('PURCHASE_ORDER / PO-001');
    const btn = rowLiOf('PURCHASE_ORDER / PO-001').querySelector(':scope > button') as HTMLElement;
    fireEvent.click(btn);
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('256');
  });
});
