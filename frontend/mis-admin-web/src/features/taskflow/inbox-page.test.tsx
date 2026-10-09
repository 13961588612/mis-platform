// @vitest-environment jsdom
/**
 * InboxPage 单测（P2）：
 * 1. 加载收件箱并渲染标题/未读态
 * 2. 点击「标为已读」调用接口并刷新
 * 3. 无数据时展示空态
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

  it('关键词搜索调用 searchMessages', async () => {
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
    fireEvent.change(input, { target: { value: '采购' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(messagesApi.searchMessages).toHaveBeenCalledWith(
        expect.objectContaining({ q: '采购', tenantId: '1', userId: '700001' }),
      ),
    );
  });
});