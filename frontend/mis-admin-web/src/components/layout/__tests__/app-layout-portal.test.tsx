// @vitest-environment jsdom
/**
 * AppLayout 左栏条件渲染测试（T01：仅 `/portal` 隐藏左栏）。
 *
 * 断言：
 * 1. `/portal` 下 **不渲染** `<aside>`（`queryByRole('complementary')` 为空），但顶栏仍保留；
 * 2. 非门户路径（`/task/pending`）下 `<aside>` **原样渲染**（左栏恢复）；
 * 3. 只包 `<aside>`：无论是否隐藏左栏，主区（含 TabBar + KeepAliveOutlet 主槽）都在。
 *
 * mock 范式（对齐 `portal-page.smoke.test.tsx` / `router.test.tsx`）：
 * - `next-themes` 显式 mock；
 * - 重组件（HeaderToolkit / CommandPalette / CopilotPanel）用轻量替身；
 * - `keep-alive-outlet` 整体替换——本测试只关心 `<aside>` 有无，不需要真实页面渲染，
 *   替换后既轻量又确定性。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from '../app-layout';
import { useAuthStore } from '@/stores/auth-store';
import * as platformApi from '@/lib/api/platform';

// TabBar 在挂载时会 `new ResizeObserver`（量标签滚动区）并在切换时 `activeBtn.scrollIntoView`，
// jsdom 两者都不提供 ⇒ 打桩。非门户路径会打开一个 Tab（AppLayout 的 openTab 副作用）从而
// 走到这两处；不打桩则本文件会「依赖其它测试文件先泄漏全局」而变成顺序相关的脆弱用例。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: 'light' }),
}));

vi.mock('@/lib/api/auth', () => ({
  logout: vi.fn(),
}));

vi.mock('@/lib/api/platform', () => ({
  fetchApps: vi.fn(),
  fetchDashboardStats: vi.fn(),
}));

vi.mock('@/lib/nav/iframe-apps', () => ({
  getIframeApp: vi.fn(() => null),
  registerIframeApps: vi.fn(),
  useIframeRegistryVersion: vi.fn(() => 0),
}));

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

// 只关心 <aside> 条件渲染；替换 KeepAliveOutlet，避免拉起真实页面 + 接口。
vi.mock('@/components/layout/keep-alive-outlet', () => ({
  KeepAliveOutlet: () => <div data-testid="keep-alive-outlet" />,
  KEEP_ALIVE_META: {},
  registerIframeApps: vi.fn(),
  resolveDynamicPageMeta: () => null,
}));

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
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout />
    </MemoryRouter>,
  );
}

describe('AppLayout 仅 /portal 隐藏左栏', () => {
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('/portal 不渲染 <aside>（左栏隐藏），但顶栏与主区仍在', async () => {
    renderAt('/portal');

    // 顶栏（AppLayout 独有元素）保留
    expect(await screen.findByText('返回门户')).toBeTruthy();
    // 左栏（<aside> 隐式 role=complementary）被隐藏
    expect(screen.queryByRole('complementary')).toBeNull();
    // 主区仍在（TabBar 之上的 KeepAliveOutlet 主槽）
    expect(screen.getByTestId('keep-alive-outlet')).toBeTruthy();
  });

  it('/task/pending 渲染 <aside>（左栏原样恢复）', async () => {
    renderAt('/task/pending');

    expect(await screen.findByRole('complementary')).toBeTruthy();
    expect(screen.getByText('返回门户')).toBeTruthy();
    expect(screen.getByTestId('keep-alive-outlet')).toBeTruthy();
  });

  it('非门户的其它子系统路径同样渲染左栏', async () => {
    renderAt('/kb/doc');
    expect(await screen.findByRole('complementary')).toBeTruthy();
  });
});
