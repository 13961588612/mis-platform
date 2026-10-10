// @vitest-environment jsdom
/**
 * HeaderToolkit 单测（T2：为「未读数改真实 stats」铺安全网；UI 精修轮扩「下拉合并 20 条」）。
 *
 * 覆盖：
 * 1. 渲染不抛错，搜索 pill / 工作台 / 通知铃铛存在
 * 2. 挂载时拉取 /tasks/my（fetchMyTasks）与 /messages/inbox（fetchInbox）
 * 3. 打开铃铛展示待办 + 消息条目，点条目跳对应路由
 * 4. **未读数取后端 stats 权威值**（P0-2 改造后）：`GET /tasks/stats`.pending +
 *    `GET /messages/stats`.unread，前端零计算。改造前是
 *    `items.filter(n => !n.read).length` 前端假算，且列表 `size:4` 截断、
 *    待办 `read` 硬编码 false，导致消息超 4 条时铃铛显示个位数而收件箱显示 57。
 * 5. **UI 精修轮**：下拉 = 待办 + 消息**合计最近 20 条**（两侧各取 20 → 合并按
 *    `createdAt` 倒序 → 截前 20），且底部按钮文案为「打开消息中心」、点击会
 *    写门户 Tab store（真正切到消息中心，而不只是跳路由）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HeaderToolkit } from './header-toolkit';
import * as tasksApi from '@/lib/api/tasks';
import * as messagesApi from '@/lib/api/messages';
import { useAuthStore } from '@/stores/auth-store';
import { usePortalTabStore } from '@/stores/portal-tab-store';

vi.mock('@/lib/api/tasks', () => ({
  fetchMyTasks: vi.fn(),
  fetchTaskStats: vi.fn(),
}));

vi.mock('@/lib/api/messages', () => ({
  fetchInbox: vi.fn(),
  fetchMessageStats: vi.fn(),
}));

const emptyPage = { page: 1, size: 4, total: 0, list: [] };

const oneTask = {
  id: '5001',
  tenantId: '1',
  taskType: 'PURCHASE_APPROVAL',
  bizType: 'PURCHASE_ORDER',
  bizRefId: 'PO-001',
  bizTitle: '采购审批 - 服务器采购',
  targetEntity: 'PURCHASE_ORDER',
  assigneeId: '700001',
  assigneeName: '测试员',
  status: 'PENDING',
  priority: 4,
  dueDate: null,
  metadata: null,
  result: null,
  read: false,
  completedAt: null,
  createdAt: '2026-10-08T10:00:00',
};

const oneMessage = {
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
};

function renderToolkit() {
  return render(
    <MemoryRouter>
      <HeaderToolkit onOpenCommand={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('HeaderToolkit', () => {
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
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue(emptyPage);
    vi.mocked(tasksApi.fetchTaskStats).mockResolvedValue({ pending: 0, urgent: 0, overdue: 0 });
    vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 0, total: 0 });
    // 门户 Tab 激活态是**模块级全局 store**（跨用例共享），必须逐例复位到默认「首页」，
    // 否则某个用例把它切到 message 后，后续依赖默认态的用例会假失败。
    // 复位统一放这里而不是用例体内：本文件后续若新增依赖 activeTab 的用例，自动受保护。
    usePortalTabStore.setState({ activeTab: 'home' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染不抛错，搜索 pill / 工作台 / 通知铃铛存在', () => {
    expect(() => renderToolkit()).not.toThrow();
    expect(screen.getByText('搜索…')).toBeTruthy();
    expect(screen.getByLabelText('工作台')).toBeTruthy();
    expect(screen.getByLabelText('通知')).toBeTruthy();
  });

  it('挂载时拉取 /tasks/my 与 /messages/inbox（各取 20 条以支持合并后截前 20）', async () => {
    renderToolkit();
    await waitFor(() => {
      expect(tasksApi.fetchMyTasks).toHaveBeenCalledWith({
        tenantId: '1',
        assigneeId: '700001',
        status: 'PENDING',
        page: 1,
        size: 20,
      });
    });
    expect(messagesApi.fetchInbox).toHaveBeenCalledWith({
      tenantId: '1',
      userId: '700001',
      page: 1,
      size: 20,
    });
  });

  it('无userId 时不发起请求', () => {
    useAuthStore.setState({ user: null });
    renderToolkit();
    expect(tasksApi.fetchMyTasks).not.toHaveBeenCalled();
    expect(messagesApi.fetchInbox).not.toHaveBeenCalled();
    expect(tasksApi.fetchTaskStats).not.toHaveBeenCalled();
    expect(messagesApi.fetchMessageStats).not.toHaveBeenCalled();
  });

  it('打开铃铛展示待办与消息条目', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ ...emptyPage, total: 1, list: [oneTask] });
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ ...emptyPage, total: 1, list: [oneMessage] });
    renderToolkit();

    fireEvent.click(screen.getByLabelText('通知'));
    expect(await screen.findByText('待办与消息')).toBeTruthy();
    expect(screen.getByText('采购审批 - 服务器采购')).toBeTruthy();
    expect(screen.getByText('采购审批待处理')).toBeTruthy();
    // 待办条目带「待办」角标
    expect(screen.getByText('待办')).toBeTruthy();
  });

  it('无数据时展示空态', async () => {
    renderToolkit();
    fireEvent.click(screen.getByLabelText('通知'));
    expect(await screen.findByText('暂无待办或消息')).toBeTruthy();
  });

  it('接口失败不抛错，铃铛仍可打开', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockRejectedValue(new Error('boom'));
    vi.mocked(messagesApi.fetchInbox).mockRejectedValue(new Error('boom'));
    renderToolkit();

    fireEvent.click(screen.getByLabelText('通知'));
    expect(await screen.findByText('暂无待办或消息')).toBeTruthy();
  });

  it('未读数取后端 stats 权威值：待办 pending + 消息 unread（不受列表 size:4 截断影响）', async () => {
    // 列表只回 1 条待办 + 1 条已读消息（看起来「没什么未处理」），
    // 但 stats 权威值是待办 1 未处理、消息未读 0 → 合计 1。
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ ...emptyPage, total: 1, list: [oneTask] });
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [{ ...oneMessage, read: true }],
    });
    vi.mocked(tasksApi.fetchTaskStats).mockResolvedValue({ pending: 1, urgent: 0, overdue: 0 });
    vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 0, total: 1 });
    renderToolkit();

    fireEvent.click(screen.getByLabelText('通知'));
    expect(await screen.findByText('待办 1 · 未读 0')).toBeTruthy();
    const badge = screen.getByLabelText('通知').querySelector('span');
    expect(badge?.textContent).toBe('1');
  });

  it('消息超4 条时角标用真实未读数（57），而非被 size:4 截断的列表长度', async () => {
    // 这是本次改造的核心回归：改造前 messages 只取 4 条且待办 read 恒false，
    // 57 条未读只会显示成个位数。
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 57,
      list: Array.from({ length: 4 }, (_, i) => ({ ...oneMessage, id: `1${i}` })),
    });
    vi.mocked(tasksApi.fetchTaskStats).mockResolvedValue({ pending: 0, urgent: 0, overdue: 0 });
    vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 57, total: 57 });
    renderToolkit();

    fireEvent.click(screen.getByLabelText('通知'));
    expect(await screen.findByText('待办 0 · 未读 57')).toBeTruthy();
    const badge = screen.getByLabelText('通知').querySelector('span');
    expect(badge?.textContent).toBe('9+');
  });

  it('期望行为：未读数取真实未读消息数（fetchMessageStats.unread），不含待办条数', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue(emptyPage);
    // 有 3 条待办，但待办不计入「消息未读」这一维度
    vi.mocked(tasksApi.fetchTaskStats).mockResolvedValue({ pending: 3, urgent: 1, overdue: 0 });
    vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 5, total: 9 });
    renderToolkit();

    fireEvent.click(screen.getByLabelText('通知'));
    // 面板把两个维度分开显示，不再混成一个「N 条未处理」
    expect(await screen.findByText('待办 3 · 未读 5')).toBeTruthy();
    // 角标是两者之和（待处理总量），来自两个权威计数器而非列表长度
    const badge = screen.getByLabelText('通知').querySelector('span');
    expect(badge?.textContent).toBe('8');
  });

  it('期望行为：待办与未读消息分开展示角标（stats 失败时回落 0 不报错）', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockRejectedValue(new Error('boom'));
    vi.mocked(messagesApi.fetchInbox).mockRejectedValue(new Error('boom'));
    vi.mocked(tasksApi.fetchTaskStats).mockRejectedValue(new Error('boom'));
    vi.mocked(messagesApi.fetchMessageStats).mockRejectedValue(new Error('boom'));
    renderToolkit();

    fireEvent.click(screen.getByLabelText('通知'));
    expect(await screen.findByText('暂无待办或消息')).toBeTruthy();
    // stats 挂了也不能白屏或出NaN
    expect(screen.getByText('待办 0 · 未读 0')).toBeTruthy();
    expect(screen.getByLabelText('通知').querySelector('span')).toBeNull();
  });

  // ---------------------------------------------------------------------
  // UI 精修轮：下拉 = 待办 + 消息合计最近 20 条
  // ---------------------------------------------------------------------

  /** 造 n 条待办：`createdAt` 随序号递增（第 n 条最新）。 */
  function makeTasks(n: number, prefix = 'T') {
    return Array.from({ length: n }, (_, i) => ({
      ...oneTask,
      id: `${prefix}-${i}`,
      bizTitle: `待办-${prefix}-${i}`,
      // 用可比较的 ISO 串：序号越大越新。
      createdAt: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T10:00:00`,
    }));
  }

  /** 造 n 条消息：`createdAt` 随序号递增（第 n 条最新）。 */
  function makeMessages(n: number, prefix = 'M') {
    return Array.from({ length: n }, (_, i) => ({
      ...oneMessage,
      id: `${prefix}-${i}`,
      title: `消息-${prefix}-${i}`,
      createdAt: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T12:00:00`,
    }));
  }

  /** 取下拉列表（`max-h-96 overflow-y-auto` 的那个 `ul`）里的条目按钮。 */
  function dropdownItems(): HTMLElement[] {
    const list = document.querySelector('ul.max-h-96');
    expect(list).toBeTruthy();
    return Array.from(list!.querySelectorAll('button'));
  }

  it('下拉最多渲染 20 条：待办 12 + 消息 12 = 24 条合并后截到 20', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ ...emptyPage, total: 12, list: makeTasks(12) });
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({ ...emptyPage, total: 12, list: makeMessages(12) });
    renderToolkit();

    fireEvent.click(screen.getByLabelText('通知'));
    await screen.findByText('待办与消息');
    await waitFor(() => expect(dropdownItems().length).toBeGreaterThan(0));

    // 24 条合并后必须被截到 20（不是 8，也不可能是 24）
    expect(dropdownItems().length).toBe(20);
  });

  it('下拉按时间倒序：合并流里最新的那条排在第一', async () => {
    // 一条很旧的任务 + 一条很新的消息 → 消息应排第一（不是「待办优先」）。
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [{ ...oneTask, id: 'T-old', bizTitle: '待办-很旧', createdAt: '2020-01-01T00:00:00' }],
    });
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      ...emptyPage,
      total: 1,
      list: [{ ...oneMessage, id: 'M-new', title: '消息-很新', createdAt: '2026-10-08T10:00:00' }],
    });
    renderToolkit();

    fireEvent.click(screen.getByLabelText('通知'));
    await screen.findByText('待办与消息');
    await waitFor(() => expect(dropdownItems().length).toBe(2));

    const first = dropdownItems()[0];
    expect(first.textContent).toContain('消息-很新');
    expect(first.textContent).not.toContain('待办-很旧');
  });

  it('底部按钮文案为「打开消息中心」，点击后写门户 Tab store（真正切到消息页签）', async () => {
    // activeTab 的复位统一在 beforeEach 完成，用例体内不再重复。
    renderToolkit();

    fireEvent.click(screen.getByLabelText('通知'));
    const btn = await screen.findByText('打开消息中心');
    // 旧文案不得残留
    expect(screen.queryByText('打开工作台')).toBeNull();

    fireEvent.click(btn);
    await waitFor(() => expect(usePortalTabStore.getState().activeTab).toBe('message'));
    // 下拉同时收起
    expect(screen.queryByText('待办与消息')).toBeNull();
  });
});