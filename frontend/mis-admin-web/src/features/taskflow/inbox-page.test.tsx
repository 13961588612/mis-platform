// @vitest-environment jsdom
/**
 * InboxPage 单测（P2 + P0-4）：
 * 1. 加载收件箱并渲染标题/未读态
 * 2. 点击「标为已读」调用接口并刷新
 * 3. 无数据时展示空态
 * 4. **点消息开右侧抽屉展示完整正文**（不再跳 /task/pending）
 * 5. **搜索 300ms 防抖**（改造前 keyword 直接进useCallback 依赖 = 即输即查）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InboxPage } from './inbox-page';
import * as messagesApi from '@/lib/api/messages';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/lib/api/messages', () => ({
  fetchInbox: vi.fn(),
  searchMessages: vi.fn(),
  fetchMessageStats: vi.fn(),
  fetchMessageDetail: vi.fn(),
  markMessagesRead: vi.fn(),
}));

const sampleItem = {
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
};

const sampleDetail = {
  ...sampleItem,
  content: '第一段正文\n第二段正文，很长很长很长很长很长很长很长很长',
  attachments: null,
  receiverUserIds: ['700001'],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <InboxPage />
    </MemoryRouter>,
  );
}

describe('InboxPage', () => {
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
    vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 1, total: 1 });
    vi.mocked(messagesApi.markMessagesRead).mockResolvedValue(1);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染收件箱列表与未读角标', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [sampleItem],
    });
    renderPage();

    expect(await screen.findByText('采购审批待处理')).toBeTruthy();
    expect(screen.getByText('待办')).toBeTruthy();
    await waitFor(() => expect(messagesApi.fetchMessageStats).toHaveBeenCalled());
  });

  it('点击标为已读触发接口调用', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [sampleItem],
    });
    renderPage();

    const btn = await screen.findByText('标为已读');
    fireEvent.click(btn);
    await waitFor(() => expect(messagesApi.markMessagesRead).toHaveBeenCalledWith('700001', ['1001']));
  });

  it('无数据时展示空态', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    renderPage();
    expect(await screen.findByText('暂无消息')).toBeTruthy();
  });

  it('点消息开右侧抽屉并展示完整正文，不跳待办页', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [sampleItem],
    });
    vi.mocked(messagesApi.fetchMessageDetail).mockResolvedValue(sampleDetail);
    renderPage();

    fireEvent.click(await screen.findByText('采购审批待处理'));

    // 抽屉标题
    expect(await screen.findByText('消息详情')).toBeTruthy();
    // 完整正文（两段都在，不截断）
    await waitFor(() => expect(messagesApi.fetchMessageDetail).toHaveBeenCalledWith('1001', '700001'));
    expect(await screen.findByText(/第一段正文/)).toBeTruthy();
    expect(screen.getByText(/第二段正文/)).toBeTruthy();
    // 未读消息点开会顺便标已读
    await waitFor(() => expect(messagesApi.markMessagesRead).toHaveBeenCalledWith('700001', ['1001']));
  });

  it('消息详情加载失败时抽屉内展示错误而不崩', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [{ ...sampleItem, read: true }],
    });
    vi.mocked(messagesApi.fetchMessageDetail).mockRejectedValue(new Error('boom'));
    renderPage();

    fireEvent.click(await screen.findByText('采购审批待处理'));
    expect(await screen.findByText('消息详情')).toBeTruthy();
    expect(await screen.findByText('boom')).toBeTruthy();
  });

  it('搜索输入 300ms 防抖：打字过程中不请求，静默期后才请求一次', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    vi.mocked(messagesApi.searchMessages).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [sampleItem],
    });
    renderPage();
    await screen.findByText('暂无消息');

    const input = screen.getByPlaceholderText('搜索标题 / 摘要');
    fireEvent.change(input, { target: { value: '采' } });
    fireEvent.change(input, { target: { value: '采购' } });
    fireEvent.change(input, { target: { value: '采购审' } });

    // 立即断言：还没到静默期，不该发搜索请求
    expect(messagesApi.searchMessages).not.toHaveBeenCalled();

    // 等过防抖窗口
    await waitFor(
      () => {
        expect(messagesApi.searchMessages).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
    expect(messagesApi.searchMessages).toHaveBeenCalledWith(
      expect.objectContaining({ q: '采购审', tenantId: '1', userId: '700001' }),
    );
  });

  it('点搜索按钮跳过防抖立即生效', async () => {
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    vi.mocked(messagesApi.searchMessages).mockResolvedValue({
      page: 1,
      size: 20,
      total: 0,
      list: [],
    });
    renderPage();
    await screen.findByText('暂无消息');

    const input = screen.getByPlaceholderText('搜索标题 / 摘要');
    fireEvent.change(input, { target: { value: '采购' } });
    fireEvent.click(screen.getByText('搜索'));

    await waitFor(() =>
      expect(messagesApi.searchMessages).toHaveBeenCalledWith(
        expect.objectContaining({ q: '采购', tenantId: '1', userId: '700001' }),
      ),
    );
  });
});