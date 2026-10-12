// @vitest-environment jsdom
/**
 * 【QA 独立验证 · 本轮回退】门户**首页三板块**回退为紧凑列表 + 行内两枚元信息标签。
 *
 * <p>本轮回退把 `我的待办` / `消息与通知` / `我发起的` 三块板从**表格**改回**原来的紧凑
 * `ul` 列表**（整行可点 `<button>`），并在行内新增两枚稳定钩子标签：
 * `[data-meta="app"]`（平台 / 关联应用）与 `[data-meta="biz-type"]`（业务类型）。
 * 契约随之变化：不再有 `<table>` / `columnheader`，改为「每行有且仅有两枚标签」。
 *
 * <p>三态取值仍走 `usePortalLookups`：`appCode==null→「平台」`、`bizType==null→「—」`、
 * 命中取 name、取不到回退 code。`process-board` 的业务类型取 **`item.businessType`**
 * （字段名与 TaskItem/MessageItem 的 `bizType` 不同）。
 *
 * <p><b>独立另写</b>：直接渲染三个 Board 组件（`TaskBoard`/`MessageBoard`/`ProcessBoard`），
 * 从**无表格结构**与**逐行标签**两个视角钉住新契约，不依赖工程师的容器测试。mock 范式
 * 同工程师用例：整体替换 api 模块、zustand 直塞、抽屉替换为轻量替身。
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
}));

vi.mock('@/lib/api/workflow', () => ({
  fetchMyProcesses: vi.fn(),
}));

vi.mock('@/lib/api/platform', () => ({
  fetchApps: vi.fn(),
  fetchDashboardStats: vi.fn(),
}));

vi.mock('@/lib/api/biz-category', () => ({
  fetchBizCategories: vi.fn(),
}));

vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: ({ open, instanceId }: { open: boolean; instanceId: string | null }) =>
    open ? <div data-testid="todo-drawer" data-instance={instanceId ?? ''} /> : null,
}));

vi.mock('@/features/portal/components/message-detail-drawer', () => ({
  MessageDetailDrawer: ({ open, messageId }: { open: boolean; messageId: string | null }) =>
    open ? <div data-testid="message-drawer" data-message={messageId ?? ''} /> : null,
}));

const emptyPage = { page: 1, size: 20, total: 0, list: [] as never[] };

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

/** 断言当前渲染的是**列表**（本轮回退的红线）：不含任何表格结构。 */
function expectRenderedAsList() {
  expect(document.querySelector('table')).toBeNull();
  expect(document.querySelector('thead')).toBeNull();
  expect(document.querySelector('tbody')).toBeNull();
  expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
  expect(screen.queryAllByRole('cell')).toHaveLength(0);
}

/** 由标题文本定位其行（`<li>`），返回该行两枚元信息标签的文本与数量。 */
function rowTags(titleText: string): {
  total: number;
  appCount: number;
  bizCount: number;
  app: string;
  bizType: string;
} {
  const li = screen.getByText(titleText).closest('li');
  if (!li) throw new Error(`未找到标题为「${titleText}」的列表行`);
  const appEls = li.querySelectorAll('[data-meta="app"]');
  const bizEls = li.querySelectorAll('[data-meta="biz-type"]');
  return {
    total: li.querySelectorAll('[data-meta]').length,
    appCount: appEls.length,
    bizCount: bizEls.length,
    app: (appEls[0]?.textContent ?? '').trim(),
    bizType: (bizEls[0]?.textContent ?? '').trim(),
  };
}

/** 精确 token 断言 className（避免子串 `toContain` 误判）。 */
function hasToken(el: Element, token: string): boolean {
  return new Set((el.getAttribute('class') ?? '').split(/\s+/)).has(token);
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

describe('[QA·本轮回退] 首页三板块 = 紧凑列表（无表格），行内恰两枚元信息标签', () => {
  it('我的待办：无 table/columnheader/cell，行内 [data-meta] 恰两枚（app + biz-type）', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ ...emptyPage, total: 1, list: [task({ bizTitle: '待办-甲' })] });
    renderBoard(<TaskBoard tenantId="1" userId="700001" />);
    await screen.findByText('待办-甲');
    expectRenderedAsList();
    expect(screen.getByText('待办-甲').closest('ul')).toBeTruthy(); // 列表容器
    const tags = rowTags('待办-甲');
    expect(tags.total).toBe(2);
    expect(tags.appCount).toBe(1);
    expect(tags.bizCount).toBe(1);
  });

  it('消息与通知：无 table/columnheader/cell，行内 [data-meta] 恰两枚', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ ...emptyPage, total: 1, list: [message({ title: '消息-甲' })] });
    renderBoard(<MessageBoard tenantId="1" userId="700001" />);
    await screen.findByText('消息-甲');
    expectRenderedAsList();
    expect(screen.getByText('消息-甲').closest('ul')).toBeTruthy();
    const tags = rowTags('消息-甲');
    expect(tags.total).toBe(2);
    expect(tags.appCount).toBe(1);
    expect(tags.bizCount).toBe(1);
  });

  it('我发起的：无 table/columnheader/cell，行内 [data-meta] 恰两枚', async () => {
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({ ...emptyPage, total: 1, list: [wfInstance()] });
    renderBoard(<ProcessBoard tenantId="1" userId="700001" />);
    await screen.findByText('PURCHASE_ORDER / PO-001');
    expectRenderedAsList();
    expect(screen.getByText('PURCHASE_ORDER / PO-001').closest('ul')).toBeTruthy();
    const tags = rowTags('PURCHASE_ORDER / PO-001');
    expect(tags.total).toBe(2);
    expect(tags.appCount).toBe(1);
    expect(tags.bizCount).toBe(1);
  });
});

describe('[QA·本轮回退] 两枚标签取值三态', () => {
  it('消息与通知：null→平台/—；命中→name；未知→回退 code', async () => {
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
    expectRenderedAsList();

    await waitFor(() => expect(rowTags('平台无类型').app).toBe('平台'));
    expect(rowTags('平台无类型').bizType).toBe('—');

    await waitFor(() => expect(rowTags('命中行').app).toBe('知识库'));
    expect(rowTags('命中行').bizType).toBe('采购订单');

    expect(rowTags('幽灵行').app).toBe('ghost');
    expect(rowTags('幽灵行').bizType).toBe('GHOST');
  });

  it('我的待办：appCode null→平台、命中→name、未知→code（bizType 命中/未知同走映射）', async () => {
    vi.mocked(platformApi.fetchApps).mockResolvedValue([app('kb', '知识库')]);
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([bizCategory('PURCHASE_ORDER', '采购订单')]);
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      ...emptyPage,
      total: 3,
      list: [
        // TaskItem.bizType 类型为 string（非空），「—」三态由 MessageItem 一例覆盖；
        // 此处专注 appCode 三态 + bizType 命中/回退两态。
        task({ id: '1', bizTitle: '平台行', appCode: null }),
        task({ id: '2', bizTitle: '命中行', appCode: 'kb', bizType: 'PURCHASE_ORDER' }),
        task({ id: '3', bizTitle: '幽灵行', appCode: 'ghost', bizType: 'GHOST' }),
      ],
    });
    renderBoard(<TaskBoard tenantId="1" userId="700001" />);
    await screen.findByText('平台行');
    expectRenderedAsList();

    await waitFor(() => expect(rowTags('平台行').app).toBe('平台'));

    await waitFor(() => expect(rowTags('命中行').app).toBe('知识库'));
    expect(rowTags('命中行').bizType).toBe('采购订单');

    expect(rowTags('幽灵行').app).toBe('ghost');
    expect(rowTags('幽灵行').bizType).toBe('GHOST');
  });

  it('我发起的：业务类型取 item.businessType（PURCHASE_ORDER → 采购订单）', async () => {
    vi.mocked(platformApi.fetchApps).mockResolvedValue([app('kb', '知识库')]);
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([bizCategory('PURCHASE_ORDER', '采购订单')]);
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [wfInstance({ businessType: 'PURCHASE_ORDER', appCode: 'kb' })],
    });
    renderBoard(<ProcessBoard tenantId="1" userId="700001" />);
    await screen.findByText('PURCHASE_ORDER / PO-001');
    expectRenderedAsList();

    await waitFor(() => expect(rowTags('PURCHASE_ORDER / PO-001').bizType).toBe('采购订单'));
    expect(rowTags('PURCHASE_ORDER / PO-001').app).toBe('知识库');
  });
});

describe('[QA·本轮回退] 静默降级（接口抛错不炸）', () => {
  it('fetchApps / 业务分类接口抛错 → 回退 code，「平台」「—」仍成立', async () => {
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
    expectRenderedAsList();

    await waitFor(() => expect(rowTags('kb行').app).toBe('kb'));
    expect(rowTags('kb行').bizType).toBe('PURCHASE_ORDER');
    expect(rowTags('平台行').app).toBe('平台');
    expect(rowTags('平台行').bizType).toBe('—');
  });
});

describe('[QA·整行可点回归] 点行仍开抽屉（列表整行 <button>）', () => {
  it('我的待办 点行 → 待办抽屉，携 instanceId', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [task({ id: '1', bizTitle: '可点行', metadata: JSON.stringify({ wfInstanceId: 128 }) })],
    });
    renderBoard(<TaskBoard tenantId="1" userId="700001" />);
    const btn = (await screen.findByText('可点行')).closest('button')!;
    // 整行可点：行按钮宽占满（w-full 精确 token）
    expect(hasToken(btn, 'w-full')).toBe(true);
    fireEvent.click(btn);
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
  });

  it('消息与通知 点行 → 消息抽屉，携该行 messageId', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [message({ id: '5001', title: '消息可点' })],
    });
    renderBoard(<MessageBoard tenantId="1" userId="700001" />);
    const btn = (await screen.findByText('消息可点')).closest('button')!;
    expect(hasToken(btn, 'w-full')).toBe(true);
    fireEvent.click(btn);
    expect(await screen.findByTestId('message-drawer')).toBeTruthy();
    expect(screen.getByTestId('message-drawer').getAttribute('data-message')).toBe('5001');
  });

  it('我发起的 点行 → 待办抽屉，携实例 id', async () => {
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [wfInstance({ id: '128' })],
    });
    renderBoard(<ProcessBoard tenantId="1" userId="700001" />);
    const btn = (await screen.findByText('PURCHASE_ORDER / PO-001')).closest('button')!;
    expect(hasToken(btn, 'w-full')).toBe(true);
    fireEvent.click(btn);
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
  });
});
