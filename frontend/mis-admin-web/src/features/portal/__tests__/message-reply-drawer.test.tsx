// @vitest-environment jsdom
/**
 * 门户「消息中心」+ 详情抽屉。
 *
 * 覆盖：
 * 1. 「全部 + 四类」子 Tab，默认「全部」，切 Tab 以对应 msgType 拉取；
 * 2. 显式搜索：输入不触发请求；点「搜索」/回车才发；
 * 3. 点消息 → 抽屉打开 + fetchMessageDetail；未读 → markMessagesRead；
 * 4. **关联流程**（`instanceId != null`）：嵌入 ProcessShell(embedded)，无独立回复框；
 * 5. **普通消息**（`instanceId == null`）：正文可见，不挂 ProcessShell，无回复入口。
 *
 * ProcessShell 用轻量替身（审批能力已在 process-shell / todo-detail-drawer 测过）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalMessageTab } from '../tabs/portal-message-tab';
import * as messagesApi from '@/lib/api/messages';
import * as platformApi from '@/lib/api/platform';
import * as bizCategoryApi from '@/lib/api/biz-category';
import { useAuthStore } from '@/stores/auth-store';
import type { MessageItem } from '@/lib/api/messages';

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

vi.mock('@/features/taskflow/process-shell', () => ({
  ProcessShell: ({
    instanceId,
    variant,
  }: {
    instanceId: string;
    variant?: string;
  }) => (
    <div
      data-testid="process-shell"
      data-instance={instanceId}
      data-variant={variant ?? 'page'}
    />
  ),
}));

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

function renderTab() {
  return render(
    <MemoryRouter>
      <PortalMessageTab />
    </MemoryRouter>,
  );
}

describe('PortalMessageTab + MessageDetailDrawer', () => {
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
    expect(messagesApi.searchMessages).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    await waitFor(() => expect(messagesApi.searchMessages).toHaveBeenCalledTimes(1));
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
    expect(await screen.findByText('第一段正文')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText('采购审批待处理')).toHaveLength(2);
    });
  });

  it('关联流程：instanceId != null → 嵌入 ProcessShell(embedded)，无独立回复框', async () => {
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

    const shell = await screen.findByTestId('process-shell');
    expect(shell.getAttribute('data-instance')).toBe('128');
    expect(shell.getAttribute('data-variant')).toBe('embedded');
    expect(screen.queryByLabelText('回复内容')).toBeNull();
    expect(messagesApi.replyMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /在完整页打开/ })).toBeTruthy();
  });

  it('普通消息（instanceId == null）→ 正文可见，不挂 ProcessShell，无回复入口', async () => {
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
    expect(screen.queryByTestId('process-shell')).toBeNull();
    expect(screen.queryByLabelText('回复内容')).toBeNull();
    expect(messagesApi.replyMessage).not.toHaveBeenCalled();
  });
});
