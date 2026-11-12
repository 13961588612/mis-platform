// @vitest-environment jsdom
/**
 * PortalPage 冒烟测试（T1 + P0-5）。
 *
 * 覆盖：
 * 1. 渲染不抛错 + 欢迎语取user.realName
 * 2. 工作台板块标题存在（我的待办 / 消息与通知 / 我发起的 / 我的应用）
 * 3. 应用导航 rail 渲染真实应用名
 * 4. **P0-5 归位后 PortalPage 自身不再渲染任何 header**（自造的M logo / 主题切换 /
 *    用户菜单 / 退出登录 / HeaderToolkit 已删除，顶栏统一由 AppLayout 提供）。
 *    路由嵌套关系（/portal 是否在 AppLayout 内）由 `app/router.test.tsx` 断言。
 *
 * mock 范式（与 features/taskflow/*.test.tsx 对齐）：
 * - `vi.mock('@/lib/api/xxx')` 整体替换 api 模块，避免真实 axios/fetch
 * - zustand 用`useAuthStore.setState({...})` 直接塞状态，不mock store
 * - `next-themes` 无 ThemeProvider 时行为不确定，测试里显式 mock useTheme
 *   （归位后 PortalPage 已不再用 useTheme，保留 mock 以防子组件回归引入）
 * - HeaderToolkit / CommandPalette / CopilotPanel 全部 mock：
 *   HeaderToolkit 会真实调 /tasks/my、/messages/inbox；后两者含 Radix + lazy chunk
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalPage } from './portal-page';
import * as platformApi from '@/lib/api/platform';
import * as tasksApi from '@/lib/api/tasks';
import * as messagesApi from '@/lib/api/messages';
import * as workflowApi from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';
import { usePortalTabStore } from '@/stores/portal-tab-store';
import { DEFAULT_TODO_TAB_KEY, usePortalTodoTabStore } from '@/stores/portal-todo-tab-store';

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
  fetchTaskStats: vi.fn(),
  fetchCcTasks: vi.fn(),
  handleTask: vi.fn(),
}));

vi.mock('@/lib/api/messages', () => ({
  fetchInbox: vi.fn(),
  fetchMessageStats: vi.fn(),
}));

vi.mock('@/lib/api/workflow', () => ({
  fetchMyProcesses: vi.fn(),
}));

// 首页三板块表格化后经 `usePortalLookups` 拉取业务分类（应用列表由 platform mock 覆盖），
// 整体替换该 api 模块避免真实 axios。
vi.mock('@/lib/api/biz-category', () => ({
  fetchBizCategories: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/nav/iframe-apps', () => ({
  registerIframeApps: vi.fn(),
  getIframeApp: vi.fn(),
  useIframeRegistryVersion: vi.fn(() => 0),
}));

// UI 精修轮：首页 TaskBoard / ProcessBoard / MessageBoard 现在挂载详情抽屉，
// 抽屉会 import ProcessShell / FormShell 及其一串接口依赖。本冒烟只关心板块是否
// 渲染出来，用轻量替身短路抽屉内部（其行为由 portal-tabs.test.tsx 与两个抽屉单测覆盖）。
vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: () => null,
}));
vi.mock('@/features/portal/components/message-detail-drawer', () => ({
  MessageDetailDrawer: () => null,
}));

// HeaderToolkit 真实实现会打接口；这里用极简替身，只保留「工作台」入口语义
vi.mock('@/components/layout/header-toolkit', () => ({
  HeaderToolkit: () => <div data-testid="header-toolkit" />,
}));

vi.mock('@/components/layout/command-palette', () => ({
  CommandPalette: () => null,
  useCommandPaletteHotkey: vi.fn(),
}));

vi.mock('@/components/layout/copilot-panel', () => ({
  CopilotPanel: () => null,
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
  {
    id: '2',
    tenantId: '1',
    code: 'iqd',
    name: '智能问数',
    icon: 'LayoutDashboard',
    basePath: '/iqd',
    description: null,
    portalGroup: 'data',
    kind: 'app',
    runtime: 'host',
    sort: 2,
    status: 1,
    enterable: true,
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <PortalPage />
    </MemoryRouter>,
  );
}

describe('PortalPage 冒烟', () => {
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
    vi.mocked(tasksApi.fetchTaskStats).mockResolvedValue({ pending: 3, urgent: 1, overdue: 0 });
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue(emptyPage);
    vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 2, total: 5 });
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue(emptyPage);
    // Tab 激活态是模块级全局 store（跨测试文件/用例共享），复位到默认「首页」，
    // 否则被别的用例切到 message 后，本文件的「首页板块」断言会假失败。
    usePortalTabStore.setState({ activeTab: 'home' });
    // 待办子 Tab 键同理（本轮从 PortalTodoTab 的 useState 提升而来）：
    // 别的文件点过「我发起的 → 查看全部」后会残留 mySent。
    usePortalTodoTabStore.setState({ activeKey: DEFAULT_TODO_TAB_KEY });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染不抛错，且欢迎语取user.realName', async () => {
    expect(() => renderPage()).not.toThrow();
    expect(await screen.findByText('你好，测试员')).toBeTruthy();
  });

  it('欢迎语在realName 缺失时回落 username', async () => {
    useAuthStore.setState({
      user: {
        id: '700001',
        employeeId: 'E1',
        username: 'tester',
        realName: null,
        avatarUrl: null,
        deptId: null,
        deptName: null,
        roles: [],
        mustChangePassword: false,
      },
    } as never);
    renderPage();
    expect(await screen.findByText('你好，tester')).toBeTruthy();
  });

  it('工作台四个板块标题存在', async () => {
    renderPage();

    // 我的待办 / 我发起的 在概览条与板块标题各出现一次，故用 getAllByText
    expect((await screen.findAllByText('我的待办')).length).toBeGreaterThan(0);
    expect(screen.getByText('消息与通知')).toBeTruthy();
    expect(screen.getAllByText('我发起的').length).toBeGreaterThan(0);
    // 应用导航 rail 标题
    expect(screen.getByText('我的应用')).toBeTruthy();
    // 概览指标
    expect(screen.getByText('未读消息')).toBeTruthy();
    expect(screen.getByText('逾期')).toBeTruthy();
  });

  it('概览指标渲染真实统计值', async () => {
    renderPage();
    await waitFor(() => expect(tasksApi.fetchTaskStats).toHaveBeenCalledWith('1', '700001'));
    // pending=3 / urgent=1 / overdue=0 / unread=2
    expect(await screen.findByText('紧急 1')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('应用导航 rail 渲染真实应用名', async () => {
    renderPage();
    // 「我的应用」分组与「最近访问」都会列出可进入应用，故用 getAllByText
    await waitFor(() => expect(platformApi.fetchApps).toHaveBeenCalled());
    expect((await screen.findAllByText('系统管理')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('智能问数').length).toBeGreaterThan(0);
    // rail 的两个区块标题
    expect(screen.getByText('我的应用')).toBeTruthy();
    expect(screen.getByText('最近访问')).toBeTruthy();
  });

  it('顶栏唯一性——PortalPage 自身不再渲染任何 header（顶栏由 AppLayout 唯一提供）', async () => {
    renderPage();
    await screen.findByText('你好，测试员');

    // P0-5 归位后，PortalPage 已删掉自造的 <header>（M logo / 主题切换 / 用户菜单 / 退出登录 /
    // HeaderToolkit）。这里逐个断言「不存在」，而不是「至多一个」——
    // 后者在归位前也能通过，锁不住回归。
    // 注意：不能用 queryByRole('banner') —— 各卡片自己的 <header>（我的待办等）
    // 也有隐式 banner role，会误报多个。改为断言顶栏独有元素。
    expect(screen.queryByLabelText('切换主题')).toBeNull();
    expect(screen.queryByLabelText('用户菜单')).toBeNull();
    expect(screen.queryByTestId('header-toolkit')).toBeNull();
    // 门户自有的 M logo 标题也应消失
    expect(screen.queryByText('MIS Platform')).toBeNull();
    // 「返回门户」是 AppLayout 顶栏的组件，PortalPage 不该有
    expect(screen.queryByText('返回门户')).toBeNull();
  });

  it('保留门户独有内容：工作台四卡片 + AppRail 应用导航', async () => {
    renderPage();
    // 四卡片
    expect((await screen.findAllByText('我的待办')).length).toBeGreaterThan(0);
    expect(screen.getByText('消息与通知')).toBeTruthy();
    expect(screen.getAllByText('我发起的').length).toBeGreaterThan(0);
    // AppRail（应用导航）：归位后仍由 PortalPage 提供，不受AppLayout 侧栏影响
    expect(screen.getByText('我的应用')).toBeTruthy();
    expect(screen.getByText('最近访问')).toBeTruthy();
    expect((await screen.findAllByText('系统管理')).length).toBeGreaterThan(0);
  });
});