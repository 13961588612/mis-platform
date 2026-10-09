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

/**
 * AppLayout 的替身：真实实现渲染的是 `KeepAliveOutlet`（而非 `<Outlet/>`），
 * 由 PAGE_MAP 把 pathname 映射到页面组件。替身照抄这个结构，
 * 否则子路由 element={null} 会渲染成空，无法断言页面命中。
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
  if (pathname === '/portal') return <div data-testid="portal-page" />;
  if (pathname === '/task/pending') return <div data-testid="pending-page" />;
  return null;
}

vi.mock('@/features/portal/portal-page', () => ({
  PortalPage: () => <div data-testid="portal-page" />,
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