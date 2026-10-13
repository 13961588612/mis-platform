// @vitest-environment jsdom
/**
 * 门户「消息中心」+ 回复抽屉（T04，设计 §2.3 / §8.2 T04）。
 *
 * 覆盖：
 * 1. 「全部 + 四类」子 Tab（全部 / 审批 / 通知 / 提醒 / 系统告警）均渲染，默认「全部」（聚合，
 *    不传 msgType），切 Tab 以对应 msgType 拉取；
 * 2. **显式搜索**：输入本身**不触发请求**；点「搜索」才以 `q` + `page=1` 请求 `searchMessages`；
 *    空关键词走 `fetchInbox`；
 * 3. 点消息 → 抽屉打开 + 调 `fetchMessageDetail`；未读 → 调 `markMessagesRead`；
 * 4. **流程通知形态**（`instanceId != null`）：调 `fetchProcessDetail` 并渲染只读表单区；
 * 5. **`canReply=true`**：有回复输入框，提交 → `replyMessage` 收到正确参数 + **就地回显**；
 * 6. **`canReply=false`**：**无回复入口** + 提示文案；
 * 7. **普通消息**（`instanceId == null`）：不调 `fetchProcessDetail`。
 *
 * mock 范式：整体替换 `@/lib/api/messages`、`@/lib/api/workflow`；抽屉是真实组件（集成验证），
 * 故需 mock 其全部接口依赖；Radix Sheet 在 jsdom 需 ResizeObserver / scrollIntoView 打桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalMessageTab } from '../tabs/portal-message-tab';
import * as messagesApi from '@/lib/api/messages';
import * as workflowApi from '@/lib/api/workflow';
import * as platformApi from '@/lib/api/platform';
import * as bizCategoryApi from '@/lib/api/biz-category';
import { useAuthStore } from '@/stores/auth-store';
import type { MessageItem } from '@/lib/api/messages';

// Radix Sheet / 浮层在 jsdom 里可能触达 ResizeObserver；打桩（仓库既有范式）。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView ??= () => {};

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

vi.mock('@/lib/api/workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/workflow')>();
  return { ...actual, fetchProcessDetail: vi.fn() };
});

// 门户表格新增两列（平台/关联应用、业务类型）经 `usePortalLookups` 拉取应用列表与业务分类，
// 整体替换这两个 api 模块，避免测试触达真实 axios。
vi.mock('@/lib/api/platform', () => ({
  fetchApps: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api/biz-category', () => ({
  fetchBizCategories: vi.fn().mockResolvedValue([]),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const emptyPage = { page: 1, size: 20, total: 0, list: [] };

function msg(overrides: Partial<MessageItem> = {}): MessageItem {
  return {
    id: '1001',
    tenantId: '1',
    msgType: 'APPROVAL',
    category: 'TASK',
    title: '采购审批待处理',
    summary: '张三提交了采购申请',
    senderId: '9',
    senderName: '系统',
    referenceTaskId: '5001',
    receiverGroupType: 'SINGLE',
    read: false,
    readCount: 0,
    totalCount: 1,
    createdAt: '2026-10-08T10:00:00',
    instanceId: null,
    canReply: false,
    appCode: null,
    bizType: null,
    ...overrides,
  };
}

/** 流程详情 fixture（仅用于取只读表单）。 */
function processDetail() {
  return {
    instance: {
      id: '128',
      definitionCode: 'PURCHASE_APPROVAL',
      startedFormCode: 'PUR_FORM',
      businessType: 'PURCHASE_ORDER',
      businessId: 'PO-001',
      status: 'RUNNING',
      initiatorId: '100',
      initiatorName: '发起人',
      initiatorOrgName: null,
      currentNodeCode: 'approve',
      currentNodeName: null,
      progress: '50%',
      postProcessStatus: 'WAITING',
      postRetryCount: 0,
      createdAt: '2026-10-08T10:00:00',
      completedAt: null,
      appCode: null,
      title: null,
    },
    tasks: [],
    history: [],
    formData: JSON.stringify({ orderNo: 'PO-001', amount: 128000 }),
  };
}

function renderTab() {
  return render(
    <MemoryRouter>
      <PortalMessageTab />
    </MemoryRouter>,
  );
}

describe('PortalMessageTab + MessageDetailDrawer（T04）', () => {
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
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue(emptyPage);
    vi.mocked(messagesApi.searchMessages).mockResolvedValue(emptyPage);
    vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 0, total: 0 });
    vi.mocked(messagesApi.markMessagesRead).mockResolvedValue(1);
    vi.mocked(messagesApi.fetchMessageDetail).mockResolvedValue(
      { ...msg(), content: '第一段正文', attachments: null, receiverUserIds: ['700001'] } as never,
    );
    vi.mocked(messagesApi.replyMessage).mockResolvedValue(undefined);
    vi.mocked(workflowApi.fetchProcessDetail).mockResolvedValue(processDetail() as never);
    // `usePortalLookups`（门户表格新增两列）在挂载时拉取应用列表 / 业务分类。
    // 因 `afterEach` 的 `vi.restoreAllMocks()` 会把模块工厂里的 `vi.fn()` 实现清成
    // 返回 undefined，必须在每个用例的 `beforeEach` 里**重新装配**这两处 resolve，
    // 否则第一个用例之后的 `fetchApps().then(...)` 会抛 `Cannot read properties of
    // undefined (reading 'then')`（模块级 mock 被 restore 的典型坑）。
    vi.mocked(platformApi.fetchApps).mockResolvedValue([]);
    vi.mocked(bizCategoryApi.fetchBizCategories).mockResolvedValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('渲染「全部 + 四类」子 Tab，默认「全部」，聚合拉取不传 msgType', async () => {
    renderTab();
    for (const label of ['全部', '审批', '通知', '提醒', '系统告警']) {
      expect(await screen.findByRole('tab', { name: label })).toBeTruthy();
    }
    await waitFor(() =>
      expect(messagesApi.fetchInbox).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: '1', userId: '700001', page: 1, size: 20 }),
      ),
    );
    // 「全部」为聚合视图：缺省 = 不过滤类型 ⇒ 首拉请求不带 msgType。
    const firstParams = vi.mocked(messagesApi.fetchInbox).mock.calls[0][0];
    expect('msgType' in firstParams).toBe(false);
  });

  it('切子 Tab「审批」以 msgType=APPROVAL 拉取（非「全部」时才带类型）', async () => {
    renderTab();
    await waitFor(() => expect(messagesApi.fetchInbox).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByRole('tab', { name: '审批' }), { button: 0 });
    await waitFor(() =>
      expect(messagesApi.fetchInbox).toHaveBeenLastCalledWith(
        expect.objectContaining({ msgType: 'APPROVAL', page: 1 }),
      ),
    );
  });

  it('显式搜索：输入不发请求，点「搜索」才以 q + page=1 请求 searchMessages', async () => {
    renderTab();
    await waitFor(() => expect(messagesApi.fetchInbox).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText('消息关键词');
    fireEvent.change(input, { target: { value: '采购' } });
    // 打字本身不触发任何请求
    expect(messagesApi.searchMessages).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    await waitFor(() => expect(messagesApi.searchMessages).toHaveBeenCalledTimes(1));
    // 默认「全部」⇒ 搜索同样不传 msgType（聚合）。
    expect(messagesApi.searchMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: '采购', page: 1 }),
    );
    const searchParams = vi.mocked(messagesApi.searchMessages).mock.calls[0][0];
    expect('msgType' in searchParams).toBe(false);
  });

  it('显式搜索：回车同样触发；「重置」清空并回到 fetchInbox', async () => {
    renderTab();
    await waitFor(() => expect(messagesApi.fetchInbox).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText('消息关键词');
    fireEvent.change(input, { target: { value: 'ENT' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(messagesApi.searchMessages).toHaveBeenCalledTimes(1));

    // 重置 → 清空关键词，回 fetchInbox（空关键词路径）
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    await waitFor(() => expect(messagesApi.fetchInbox).toHaveBeenCalledTimes(2));
  });

  it('点消息 → 抽屉打开 + fetchMessageDetail；未读顺手标已读', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [msg({ id: '1001', read: false })],
    });
    renderTab();

    fireEvent.click(await screen.findByText('采购审批待处理'));

    await waitFor(() => expect(messagesApi.fetchMessageDetail).toHaveBeenCalledWith('1001', '700001'));
    await waitFor(() => expect(messagesApi.markMessagesRead).toHaveBeenCalledWith('700001', ['1001']));
    // 抽屉已打开：正文可见
    expect(await screen.findByText('第一段正文')).toBeTruthy();
  });

  it('流程通知形态：instanceId != null → 调 fetchProcessDetail 并渲染只读表单区', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [msg({ id: '1001', msgType: 'NOTIFY', instanceId: '128', canReply: true, read: true })],
    });
    vi.mocked(messagesApi.fetchMessageDetail).mockResolvedValue({
      ...msg({ id: '1001', msgType: 'NOTIFY', instanceId: '128', canReply: true }),
      content: '流程结果通知',
      attachments: null,
      receiverUserIds: ['700001'],
    } as never);
    renderTab();

    fireEvent.click(await screen.findByText('采购审批待处理'));

    await waitFor(() => expect(workflowApi.fetchProcessDetail).toHaveBeenCalledWith('128', '1'));
    // 只读表单区渲染（FormShell）
    expect(await screen.findByTestId('form-shell')).toBeTruthy();
  });

  it('canReply=true → 有回复输入框，提交 → replyMessage 正确参数 + 就地回显', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [msg({ id: '1001', msgType: 'NOTIFY', instanceId: '128', canReply: true, read: true })],
    });
    vi.mocked(messagesApi.fetchMessageDetail).mockResolvedValue({
      ...msg({ id: '1001', msgType: 'NOTIFY', instanceId: '128', canReply: true }),
      content: '请补充发票',
      attachments: null,
      receiverUserIds: ['700001'],
    } as never);
    renderTab();

    fireEvent.click(await screen.findByText('采购审批待处理'));

    const input = await screen.findByLabelText('回复内容');
    fireEvent.change(input, { target: { value: '同意，请补充发票' } });
    fireEvent.click(screen.getByRole('button', { name: '回复' }));

    await waitFor(() =>
      expect(messagesApi.replyMessage).toHaveBeenCalledWith(
        '1001',
        '1',
        '700001',
        '测试员',
        '同意，请补充发票',
      ),
    );
    // 就地回显
    expect(await screen.findByText('我的回复：')).toBeTruthy();
    expect(screen.getByText('同意，请补充发票')).toBeTruthy();
  });

  it('canReply=false → 无回复入口 + 提示文案', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [msg({ id: '1001', msgType: 'APPROVAL', instanceId: '128', canReply: false, read: true })],
    });
    vi.mocked(messagesApi.fetchMessageDetail).mockResolvedValue({
      ...msg({ id: '1001', msgType: 'APPROVAL', instanceId: '128', canReply: false }),
      content: '审批消息',
      attachments: null,
      receiverUserIds: ['700001'],
    } as never);
    renderTab();

    fireEvent.click(await screen.findByText('采购审批待处理'));

    expect(await screen.findByText('该消息无关联流程，暂不支持回复')).toBeTruthy();
    expect(screen.queryByLabelText('回复内容')).toBeNull();
    expect(messagesApi.replyMessage).not.toHaveBeenCalled();
  });

  it('普通消息（instanceId == null）→ 不调 fetchProcessDetail', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [msg({ id: '1001', msgType: 'REMIND', instanceId: null, canReply: false, read: true })],
    });
    vi.mocked(messagesApi.fetchMessageDetail).mockResolvedValue({
      ...msg({ id: '1001', msgType: 'REMIND', instanceId: null, canReply: false }),
      content: '普通提醒正文',
      attachments: null,
      receiverUserIds: ['700001'],
    } as never);
    renderTab();

    fireEvent.click(await screen.findByText('采购审批待处理'));

    expect(await screen.findByText('普通提醒正文')).toBeTruthy();
    expect(workflowApi.fetchProcessDetail).not.toHaveBeenCalled();
    expect(screen.queryByTestId('form-shell')).toBeNull();
  });
});
