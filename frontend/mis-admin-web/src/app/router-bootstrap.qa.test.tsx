// @vitest-environment jsdom
/**
 * 【QA 独立验证 · B7】真 Bug 回归门：已登录会话**每次整页加载都要刷新权限**。
 *
 * <p>根因（主理人已核实）：`SessionBootstrap` 旧写法
 * `if (menus.length > 0) { setReady(true); return; }` —— `auth-store` 是 zustand `persist`
 * （partialize 含 permissions + menus）。登录后 `menus` 落 localStorage，此后每次刷页
 * 都命中早退、**从不调用** `bootstrapSession()` ⇒ permissions 恒为上次登录的旧集合 ⇒
 * `PermissionGate` 隐藏「业务分类」新增/编辑按钮。
 *
 * <p>本文件由 **QA 独立撰写**（与工程师的 `router.test.tsx` 分离），渲染**真实 `AppRouter`**，
 * 分两组覆盖：①已登录 + **非空 menus** → `bootstrapSession` **必被调用**（旧实现下必失败）；
 * ②已登录 + **空 menus** → 亦被调用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { AppRouter } from './router';
import { useAuthStore } from '@/stores/auth-store';
import { bootstrapSession } from '@/lib/auth/bootstrap';
import type { RouterNode } from '@/types/api';

vi.mock('@/lib/auth/bootstrap', () => ({
  bootstrapSession: vi.fn(async () => undefined),
}));
vi.mock('@/features/ai/ai-context', () => ({
  AIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// 重子组件替换为轻量替身：本测试只关心 SessionBootstrap 的引导副作用，不拉起真实页面。
vi.mock('@/components/layout/app-layout', () => ({
  AppLayout: () => <div data-testid="app-layout" />,
}));
vi.mock('@/features/auth/login-page', () => ({ LoginPage: () => <div data-testid="login-page" /> }));
vi.mock('@/features/auth/change-password-page', () => ({
  ChangePasswordPage: () => <div data-testid="change-password-page" />,
}));
vi.mock('@/features/portal/portal-page', () => ({ PortalPage: () => <div data-testid="portal-page" /> }));

function signIn(menus: RouterNode[]) {
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
    menus,
  });
}

function goto(path: string) {
  window.history.pushState({}, '', path);
  return render(<AppRouter />);
}

beforeEach(() => {
  // mock 工厂内已用 vi.fn(async...)；afterEach 用 clearAllMocks（非 restore），
  // 但仍在 beforeEach 显式复位实现，避免跨用例残留。
  vi.mocked(bootstrapSession).mockClear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('[QA·独立] B7 已登录会话刷新权限（menus 缓存不得早退）', () => {
  it('已登录 + 非空 menus：仍调用 bootstrapSession()（旧实现下必失败）', async () => {
    signIn([
      { id: '1', name: '系统', path: '/system', component: null, meta: { title: '系统' } },
      { id: '2', name: '业务分类', path: '/system/biz-category', component: null, meta: { title: '业务分类' } },
    ]);
    goto('/portal');
    await waitFor(() => expect(bootstrapSession).toHaveBeenCalled());
    expect(vi.mocked(bootstrapSession).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('已登录 + 空 menus：亦调用 bootstrapSession()', async () => {
    signIn([]);
    goto('/portal');
    await waitFor(() => expect(bootstrapSession).toHaveBeenCalled());
  });
});
