// @vitest-environment jsdom
/**
 * 路由结构测试（T3 + P0-5：为「门户外壳归位」铺路并锁定归位结果）。
 *
 * 断言 `src/app/router.tsx` 的真实嵌套关系：
 * - `/portal` 与 `/task/*` 同挂AppLayout（P0-5 归位后）
 * - `/system/*` 等命中 AppLayout
 * - `/` 与未匹配路径都重定向到 /portal
 *
 * 实现取舍：不用 matchRoutes 手搓路由表（那样断言的是测试自己写的副本，
 * 没有价值），而是**渲染真实 AppRouter**，但把全部重子组件替换为轻量替身，
 * 既验证真实 router.tsx，又不拉起任何真实页面 / 接口。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppRouter } from './router';
import { useAuthStore } from '@/stores/auth-store';
// 真实解析逻辑（PAGE_MAP + DYNAMIC_PAGES），回归测试必须打真实实现而非替身。
import {
  resolveDynamicPageMeta,
  resolvePageComponent,
} from '@/components/layout/keep-alive-outlet';
import { ProcessDetailPage } from '@/features/taskflow/process-detail-page';
import { TaskListPage } from '@/features/taskflow/task-list-page';

/**
 * AppLayout 的替身：真实实现渲染的是 `KeepAliveOutlet`（而非 `<Outlet/>`），
 * 由 PAGE_MAP / DYNAMIC_PAGES 把 pathname 映射到页面组件。替身照抄这个结构，
 * 否则子路由 element={null} 会渲染成空，无法断言页面命中。
 *
 * <p>关键：这里**调用真实的 resolvePageComponent**，不自己写路径表。
 * 上一版替身只认`/portal` 与 `/task/pending` 两个字面量，等于把被测的解析逻辑
 * 换成了测试自己的副本——真实 Bug（`/task/process/:id`错放在 PAGE_MAP 导致
 * `/task/process/128` 渲染「页面不存在」）在那样的替身下测不出来。
 */
vi.mock('@/components/layout/app-layout', () => ({
  AppLayout: () => (
    <div data-testid="app-layout">
      <Outlet />
      <FakeKeepAliveOutlet />
    </div>
  ),
}));

function FakeKeepAliveOutlet() {
  const { pathname } = useLocation();
  const Comp = resolvePageComponent(pathname);
  // 与真实 KeepAliveOutlet 一致：解析不到就渲染「页面不存在」
  if (!Comp) return <div data-testid="page-not-found">页面不存在</div>;
  return (
    <div data-testid="keep-alive-host">
      <Comp />
    </div>
  );
}

vi.mock('@/features/portal/portal-page', () => ({
  PortalPage: () => <div data-testid="portal-page" />,
}));

// 任务流页面替身：真实页面挂载即发请求，本测试只关心「 pathname 能否解析出组件」。
// 替身仍保留原data-testid，使既有断言（pending-page）继续成立。
vi.mock('@/features/taskflow/task-list-page', () => ({
  TaskListPage: () => <div data-testid="pending-page" />,
}));

vi.mock('@/features/taskflow/process-detail-page', () => ({
  ProcessDetailPage: () => <div data-testid="process-detail-page" />,
}));

// 替身改用真实 resolvePageComponent 后，命中路径会真的渲染页面组件。
// 这两个页面挂载即用 useQuery / 发请求（需 QueryClientProvider），本测试不关心其内部，
// 只关心「路由命中了 AppLayout 且能解析出组件」，故替换为轻量替身。
vi.mock('@/features/dashboard/dashboard-page', () => ({
  DashboardPage: () => <div data-testid="dashboard-page" />,
}));

vi.mock('@/features/system/user/user-list-page', () => ({
  UserListPage: () => <div data-testid="user-list-page" />,
}));

vi.mock('@/features/auth/login-page', () => ({
  LoginPage: () => <div data-testid="login-page" />,
}));

vi.mock('@/features/auth/change-password-page', () => ({
  ChangePasswordPage: () => <div data-testid="change-password-page" />,
}));

vi.mock('@/features/ai/ai-context', () => ({
  AIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/auth/bootstrap', () => ({
  bootstrapSession: vi.fn(async () => undefined),
}));

function goto(path: string) {
  window.history.pushState({}, '', path);
  return render(<AppRouter />);
}

describe('router 路由结构', () => {
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
      menus: [
        { id: '1', name: '系统', path: '/system', component: null, meta: { title: '系统' } },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('/portal 命中 PortalPage', async () => {
    goto('/portal');
    expect(await screen.findByTestId('portal-page')).toBeTruthy();
  });

  it('P0-5：/portal 与 /task/* 同挂 AppLayout（祖先链含 app-layout）', async () => {
    goto('/portal');
    const portal = await screen.findByTestId('portal-page');
    // 归位后：PortalPage 的祖先链上有 AppLayout
    expect(portal.closest('[data-testid="app-layout"]')).toBeTruthy();
    expect(screen.getByTestId('app-layout')).toBeTruthy();
  });

  it('/task/pending 命中 AppLayout（子路由由 KeepAliveOutlet 渲染，element 为 null）', async () => {
    goto('/task/pending');
    expect(await screen.findByTestId('app-layout')).toBeTruthy();
    expect(await screen.findByTestId('pending-page')).toBeTruthy();
  });

  it.each(['/system/user', '/monitor/online', '/kb/doc', '/agent/overview', '/finance/report'])(
    '%s 命中 AppLayout',
    async (path) => {
      goto(path);
      expect(await screen.findByTestId('app-layout')).toBeTruthy();
    },
  );

  it('/dashboard 命中 AppLayout', async () => {
    goto('/dashboard');
    expect(await screen.findByTestId('app-layout')).toBeTruthy();
  });

  it('/change-password 不在 AppLayout 内（裸挂）', async () => {
    goto('/change-password');
    expect(await screen.findByTestId('change-password-page')).toBeTruthy();
    expect(screen.queryByTestId('app-layout')).toBeNull();
  });

  it('/ 重定向到 /portal（并落在 AppLayout 内）', async () => {
    goto('/');
    await waitFor(() => expect(screen.getByTestId('portal-page')).toBeTruthy());
    expect(screen.getByTestId('portal-page').closest('[data-testid="app-layout"]')).toBeTruthy();
  });

  it('未匹配路径重定向到 /portal', async () => {
    goto('/no-such-page');
    await waitFor(() => expect(screen.getByTestId('portal-page')).toBeTruthy());
  });

  it('已登录访问 /login 被弹回 /portal', async () => {
    goto('/login');
    await waitFor(() => expect(screen.getByTestId('portal-page')).toBeTruthy());
    expect(screen.queryByTestId('login-page')).toBeNull();
  });

  it('未登录访问 /portal 被弹到 /login', async () => {
    useAuthStore.setState({ accessToken: null, expiresAt: null, user: null, menus: [] });
    goto('/portal');
    expect(await screen.findByTestId('login-page')).toBeTruthy();
  });

  it.todo('归位后 /change-password 是否也移入 AppLayout 需产品确认（当前裸挂）');
});

/**
 * 回归：流程详情 `/task/process/:id` 曾被错放进 PAGE_MAP。
 *
 * PAGE_MAP 是**字面量精确匹配**表，`/task/process/128` 永远 ≠ `/task/process/:id`
 * ⇒ resolvePageComponent 返回 null ⇒ KeepAliveOutlet 渲染「页面不存在」，
 * 同时 resolveDynamicPageMeta 返回 null ⇒ Tab 标题回落到兜底「概览」。
 * 门户卡片 / 我的待办（待办态+已办态）/ 我发起的 / 我审批的 共 7 处跳转全部通向死链。
 */
describe('回归：/task/process/:id 动态明细路由（错放 PAGE_MAP → 页面不存在）', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: 'test-token', expiresAt: Date.now() + 3_600_000 });
  });

  afterEach(() => {
    cleanup();
  });

  it('/task/process/128 能解析出 ProcessDetailPage（不是 null / 页面不存在）', () => {
    expect(resolvePageComponent('/task/process/128')).toBe(ProcessDetailPage);
  });

  it('路由实渲染：/task/process/128 命中页面而非「页面不存在」', async () => {
    goto('/task/process/128');
    expect(await screen.findByTestId('process-detail-page')).toBeTruthy();
    expect(screen.queryByTestId('page-not-found')).toBeNull();
  });

  it.each(['/task/process/128', '/task/process/9', '/task/process/abc-1'])(
    '%s 的动态元信息 title 非空且非兜底值（守住 Tab 标题变「概览」的症状）',
    (path) => {
      const meta = resolveDynamicPageMeta(path);
      expect(meta).not.toBeNull();
      expect(meta?.title).toBeTruthy();
      // app-layout.tsx 的兜底标题是「概览」，命中兜底即说明动态规则没登记
      expect(meta?.title).not.toBe('概览');
      expect(meta?.icon).toBeTruthy();
    },
  );

  it('图标名在 icons.ts 有真实登记（漏登记会静默回退成 LayoutDashboard）', async () => {
    const { resolveNavIcon } = await import('@/lib/nav/icons');
    const icon = resolveDynamicPageMeta('/task/process/128')?.icon;
    expect(icon).toBeTruthy();
    expect(resolveNavIcon(icon)).not.toBe(resolveNavIcon('__not_registered__'));
  });

  it('静态页对照：/task/pending 仍走 PAGE_MAP，且不命中动态规则', () => {
    expect(resolvePageComponent('/task/pending')).toBe(TaskListPage);
    // 静态页不该有动态元信息，否则会盖掉侧栏清单里的标题
    expect(resolveDynamicPageMeta('/task/pending')).toBeNull();
  });

  it('/task/process 前缀本身不是页面（无ID 时不误吞）', () => {
    expect(resolvePageComponent('/task/process/')).toBeNull();
    expect(resolveDynamicPageMeta('/task/process/')).toBeNull();
  });

  it('过深路径不被误吞（maxSegments 缺省 1）', () => {
    expect(resolvePageComponent('/task/process/128/extra')).toBeNull();
  });

  it('既有两张表的原有明细规则未被破坏', () => {
    expect(resolvePageComponent('/kb/libraries/12')).not.toBeNull();
    expect(resolvePageComponent('/agent/agents/7')).not.toBeNull();
    expect(resolvePageComponent('/agent/agents/7/skills')).not.toBeNull();
  });
});