// @vitest-environment jsdom
/**
 * AppLayout 左栏条件渲染测试（T01：仅 `/portal` 隐藏左栏）
 * + 本轮顶栏三项改造的集成断言。
 *
 * 断言：
 * 1. `/portal` 下 **不渲染** `<aside>`（`queryByRole('complementary')` 为空），但顶栏仍保留；
 * 2. 非门户路径（`/task/pending`）下 `<aside>` **原样渲染**（左栏恢复）；
 * 3. 只包 `<aside>`：无论是否隐藏左栏，主区（含 TabBar + KeepAliveOutlet 主槽）都在；
 * 4. ①「返回门户」：`/portal` 下**禁用且灰化**（真正 `disabled` 的 `<button>`，
 *    不是 `pointer-events-none` 的假禁用）；非门户路径下是**可点**的 `/portal` 链接；
 * 5. ② APP 切换按钮文案为「切换APP」；下拉打开后每组**两列**（容器含 `grid-cols-2`），
 *    分组标题仍独占一行；
 * 6. ③ 门户三 Tab **仅** `/portal` 渲染：门户页能查到三个 `role="tab"`，
 *    非门户页一个都查不到；且选中 tab 含 `bg-background`、不含 `bg-card`/`bg-muted`。
 *
 * mock 范式（对齐 `portal-page.smoke.test.tsx` / `router.test.tsx`）：
 * - `next-themes` 显式 mock；
 * - 重组件（HeaderToolkit / CommandPalette / CopilotPanel）用轻量替身；
 * - `keep-alive-outlet` 整体替换——本测试只关心 `<aside>` 有无，不需要真实页面渲染，
 *   替换后既轻量又确定性。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from '../app-layout';
import { useAuthStore } from '@/stores/auth-store';
import { usePortalTabStore } from '@/stores/portal-tab-store';
import * as platformApi from '@/lib/api/platform';

/** 精确类名 token 集合（避免 `border-x-transparent` 命中 `border-t` 这类子串假阳性）。 */
function classesOf(el: Element): Set<string> {
  return new Set(el.className.split(/\s+/).filter(Boolean));
}

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
    // 门户 Tab 激活态是**模块级全局 store**（跨测试文件/用例共享），逐例复位到默认
    // 「首页」，否则顶栏选中态断言会被上一例污染。
    usePortalTabStore.setState({ activeTab: 'home' });
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

  // ---------------------------------------------------------------------
  // 本轮顶栏三项改造
  // ---------------------------------------------------------------------

  it('① /portal 时「返回门户」禁用且灰化；非门户时可点（真链接）', async () => {
    renderAt('/portal');
    const disabled = (await screen.findByText('返回门户')).closest('button');
    expect(disabled).toBeTruthy();
    // 必须是真正 disabled 的 <button>：不可聚焦、不可激活、读屏朗读为 dimmed。
    expect(disabled!.hasAttribute('disabled')).toBe(true);
    expect(disabled!.getAttribute('aria-disabled')).toBe('true');
    // 灰化沿用下拉项里已有的禁用视觉（cursor-not-allowed + opacity-50）。
    const cls = classesOf(disabled!);
    expect(cls.has('cursor-not-allowed')).toBe(true);
    expect(cls.has('opacity-50')).toBe(true);

    cleanup();

    renderAt('/task/pending');
    const link = screen.getByText('返回门户');
    // 非门户页仍是链接：有 href、没有 disabled。
    expect(link.tagName.toLowerCase()).toBe('a');
    expect(link.getAttribute('href')).toBe('/portal');
    expect(link.closest('button')).toBeNull();
  });

  it('② APP 切换按钮文案为「切换APP」，下拉每组两列（grid-cols-2）', async () => {
    renderAt('/portal');
    const trigger = await screen.findByText('切换APP');
    // 当前 APP 名不再出现在按钮文案上；改用 title 提供「当前应用」提示（低成本补救）。
    expect(trigger.closest('button')!.getAttribute('title')).toContain('当前应用');

    fireEvent.click(trigger.closest('button')!);

    const item = (await screen.findByText('系统管理')).closest('button');
    expect(item).toBeTruthy();
    // 每项所在的容器必须是两列网格（不是单列纵向）。
    const grid = item!.parentElement;
    expect(grid).toBeTruthy();
    expect(classesOf(grid!).has('grid-cols-2')).toBe(true);
    expect(classesOf(grid!).has('grid')).toBe(true);
    // 分组标题仍独占一行：它是网格容器的**兄弟节点**，不在网格里。
    const groupTitle = grid!.parentElement!.querySelector('.uppercase, .tracking-wide');
    expect(groupTitle).toBeTruthy();
    expect(groupTitle).not.toBe(grid);
  });

  it('③ 顶栏门户三 Tab 仅 /portal 渲染，且选中态为 bg-background', async () => {
    renderAt('/portal');
    expect(await screen.findByRole('tab', { name: '首页' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '待办事项' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '消息中心' })).toBeTruthy();

    const activeCls = classesOf(screen.getByRole('tab', { name: '首页' }));
    expect(activeCls.has('bg-background')).toBe(true);
    expect(activeCls.has('bg-card')).toBe(false);
    expect(activeCls.has('bg-muted')).toBe(false);

    cleanup();

    // 非门户页：顶栏完全不出现这三个 tab（组件自门限返回 null）。
    renderAt('/task/pending');
    await screen.findByText('返回门户');
    expect(screen.queryByRole('tab', { name: '首页' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '待办事项' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '消息中心' })).toBeNull();
    expect(screen.queryByTestId('portal-tab-switcher')).toBeNull();
  });

  it('③ 点顶栏 tab 只写 store，不触发路由跳转（三 Tab 不进 URL）', async () => {
    renderAt('/portal');
    fireEvent.click(await screen.findByRole('tab', { name: '待办事项' }));
    expect(usePortalTabStore.getState().activeTab).toBe('todo');
    expect(screen.getByRole('tab', { name: '待办事项' }).getAttribute('aria-selected')).toBe('true');
    expect(classesOf(screen.getByRole('tab', { name: '待办事项' })).has('bg-background')).toBe(true);
    expect(classesOf(screen.getByRole('tab', { name: '首页' })).has('bg-background')).toBe(false);
  });
});
