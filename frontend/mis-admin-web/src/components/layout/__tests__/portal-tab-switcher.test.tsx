// @vitest-environment jsdom
/**
 * 顶栏门户三 Tab 切换器测试（本轮新增：tab 条从 `features/portal/portal-page.tsx`
 * 搬到 `components/layout/portal-tab-switcher.tsx`）。
 *
 * 覆盖：
 * 1. **仅 `/portal` 渲染**：门户页能查到三个 tab；非门户页（`/task/pending`）组件整体
 *    返回 null（连 tablist 容器都不在 DOM 里）；
 * 2. 三个 tab 均为「图标 + 文字」（断言 lucide 渲染出的真实 `svg[data-testid]`，
 *    不只断文本——断文本锁不住「图标被删」的回归）；
 * 3. **选中态观感**：选中 tab 的类含 `bg-background`，且**不含** `bg-card` / `bg-muted`
 *    （前者纯白接不上工作区，后者 93% 比工作区 95.5% 深一档会露色差）；
 *    未选中 tab 不含 `bg-background`；
 * 4. **两态盒模型类完全一致 ⇒ 切 tab 零跳动**（前两轮反复踩的坑）：
 *    把三个 tab 的 className 拆成 token 集合、剔除纯颜色类后**逐个判等**；
 *    并断言 `-mb-px` 挂在容器上（常量）而不是 per-tab（「只有 active 带 −mb-px」
 *    正是当初跳 2px 的根因）；
 * 5. **无关闭按钮**（门户三 Tab 常驻，不提供关闭语义）；
 * 6. 点击 tab → `usePortalTabStore.activeTab` 变化；且**不发生路由跳转**（三 Tab 不进 URL）；
 * 7. 外部 `setActiveTab` 也能驱动顶栏选中态（`aria-selected`）——数据源唯一 = store；
 * 8. 手写 tab 语义（`role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls`）
 *    补齐了「不再是 Radix TabsTrigger」后丢掉的可访问性。
 *
 * mock 范式（对齐 `app-layout-portal.test.tsx`）：
 * - `useNavigate` 用 spy 替换，用于断言「未发生跳转」；`useLocation` 用真实实现
 *   （组件靠它判断是否在 `/portal`）；
 * - 本组件不碰接口，无需 mock api。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalTabSwitcher, PORTAL_TAB_PANEL_ID } from '../portal-tab-switcher';
import { usePortalTabStore } from '@/stores/portal-tab-store';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PortalTabSwitcher />
    </MemoryRouter>,
  );
}

/**
 * 把 className 拆成**精确的类名 token 集合**。
 *
 * <p>🔴 必须按 token 判等、不能用 `className.toContain(...)` 子串匹配：
 * `border-x-transparent` 里**包含**子串 `border-t`，`hover:text-foreground` 里包含
 * `text-foreground`… 子串匹配会让「有 `border-t`」这种断言假阳性通过，也会让
 * 「不含 `border-t`」假失败（上一轮就踩过这个坑）。
 */
function classesOf(el: Element): Set<string> {
  return new Set(el.className.split(/\s+/).filter(Boolean));
}

/** 允许两态不同的**纯颜色** token（都不影响盒模型）。 */
const COLOR_ONLY_TOKENS = ['bg-background', 'text-primary', 'text-foreground', 'border-x-border', 'border-x-transparent'];

describe('PortalTabSwitcher 顶栏门户三 Tab', () => {
  beforeEach(() => {
    // 模块级全局 store（跨测试文件/用例共享），逐例复位到默认「首页」。
    usePortalTabStore.setState({ activeTab: 'home' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('/portal 渲染「首页 / 待办事项 / 消息中心」三个 tab', () => {
    renderAt('/portal');
    expect(screen.getByRole('tab', { name: '首页' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '待办事项' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '消息中心' })).toBeTruthy();
  });

  it('非门户路径（/task/pending）完全不渲染顶栏 tab', () => {
    renderAt('/task/pending');
    expect(screen.queryByTestId('portal-tab-switcher')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('首页')).toBeNull();
  });

  it('三个 tab 均为「图标 + 文字」（断言真实 svg，不只断文本）', () => {
    renderAt('/portal');
    const home = screen.getByRole('tab', { name: '首页' });
    const todo = screen.getByRole('tab', { name: '待办事项' });
    const msg = screen.getByRole('tab', { name: '消息中心' });

    for (const [tab, testid] of [
      [home, 'portal-tab-icon-home'],
      [todo, 'portal-tab-icon-todo'],
      [msg, 'portal-tab-icon-message'],
    ] as const) {
      const icon = tab.querySelector(`[data-testid="${testid}"]`);
      expect(icon).toBeTruthy();
      // tagName 断言可防「用 div 假冒图标」的假绿。
      expect(icon!.tagName.toLowerCase()).toBe('svg');
      // 图标与文字同色（继承 currentColor）⇒ 靠 text- 类而非固定 fill。
      expect(icon!.getAttribute('fill')).toBe('none');
      expect(icon!.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('选中 tab 含 bg-background，且不含 bg-card / bg-muted', () => {
    renderAt('/portal');
    const home = screen.getByRole('tab', { name: '首页' });
    const todo = screen.getByRole('tab', { name: '待办事项' });

    const activeCls = classesOf(home);
    expect(activeCls.has('bg-background')).toBe(true);
    expect(activeCls.has('bg-card')).toBe(false);
    expect(activeCls.has('bg-muted')).toBe(false);

    // 未选中态不带工作区底色（其余背景只出现在 hover 变体上）。
    const inactiveCls = classesOf(todo);
    expect(inactiveCls.has('bg-background')).toBe(false);
    expect(inactiveCls.has('bg-card')).toBe(false);
    expect(inactiveCls.has('bg-muted')).toBe(false);

    // 选中态的边框色必须**由 tailwind-merge 真正覆盖**基类：否则 `border-x-transparent`
    // 与 `border-x-border` 共存，胜负取决于 CSS 源码顺序而不是类顺序（不可控）。
    expect(activeCls.has('border-x-border')).toBe(true);
    expect(activeCls.has('border-x-transparent')).toBe(false);
    expect(inactiveCls.has('border-x-transparent')).toBe(true);
    expect(inactiveCls.has('border-x-border')).toBe(false);
  });

  it('两态盒模型类完全一致（防「切 tab 跳动」回归）+ 无关闭按钮', () => {
    renderAt('/portal');
    const home = screen.getByRole('tab', { name: '首页' });
    const todo = screen.getByRole('tab', { name: '待办事项' });
    const msg = screen.getByRole('tab', { name: '消息中心' });

    /**
     * 剔除纯颜色 token 后，三个 tab（无论选中与否）的**其余类名必须逐一相等**。
     * 这条断言直接钉死「active 变体只能改颜色」——一旦有人往 active 上加
     * `py-*`/`border-b*`/`-mb-px`/`h-*`/`text-[*px]`，这里立刻失败。
     */
    const strip = (el: Element): string[] =>
      [...classesOf(el)].filter((t) => !COLOR_ONLY_TOKENS.includes(t)).sort();
    expect(strip(home)).toEqual(strip(todo));
    expect(strip(home)).toEqual(strip(msg));

    // 两态共享的盒模型类：高度来自 h-full（父容器确定高），padding/字号两态同源。
    for (const tab of [home, todo, msg]) {
      const cls = classesOf(tab);
      expect(cls.has('h-full')).toBe(true);
      expect(cls.has('px-3.5')).toBe(true);
      expect(cls.has('py-2')).toBe(true);
      expect(cls.has('text-[13px]')).toBe(true);
      expect(cls.has('rounded-t')).toBe(true);
      // 上下 border 恒为 0（只有左右 border-x），且宽度两态相同。
      expect(cls.has('border-x')).toBe(true);
      expect(cls.has('border')).toBe(false);
      expect(cls.has('border-b')).toBe(false);
      // 🔴 压盖 header border-b 的 -mb-px 必须只在**容器**上（常量），不能 per-tab。
      expect(cls.has('-mb-px')).toBe(false);
      expect(cls.has('mb-px')).toBe(false);
      // 无关闭按钮：tab 内不渲染任何嵌套 button。
      expect(tab.querySelector('button')).toBeNull();
    }

    // 容器：竖向撑满 header（self-stretch）+ 负外边距压盖 header 的 1px border-b。
    const list = screen.getByTestId('portal-tab-switcher');
    const listCls = classesOf(list);
    expect(listCls.has('self-stretch')).toBe(true);
    expect(listCls.has('-mb-px')).toBe(true);
    expect(listCls.has('items-stretch')).toBe(true);
  });

  it('点击顶栏 tab → 写 store（activeTab 变化），且不发生路由跳转', () => {
    renderAt('/portal');
    expect(usePortalTabStore.getState().activeTab).toBe('home');

    fireEvent.click(screen.getByRole('tab', { name: '待办事项' }));
    expect(usePortalTabStore.getState().activeTab).toBe('todo');

    fireEvent.click(screen.getByRole('tab', { name: '消息中心' }));
    expect(usePortalTabStore.getState().activeTab).toBe('message');

    fireEvent.click(screen.getByRole('tab', { name: '首页' }));
    expect(usePortalTabStore.getState().activeTab).toBe('home');

    // 三 Tab 绝不入 URL（规避 keep-alive PAGE_MAP / useParams 坑）。
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('外部 setActiveTab 驱动顶栏选中态（数据源唯一 = store）', () => {
    renderAt('/portal');
    expect(screen.getByRole('tab', { name: '首页' }).getAttribute('aria-selected')).toBe('true');

    act(() => {
      usePortalTabStore.getState().setActiveTab('message');
    });

    expect(screen.getByRole('tab', { name: '消息中心' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '首页' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: '待办事项' }).getAttribute('aria-selected')).toBe('false');
    expect(classesOf(screen.getByRole('tab', { name: '消息中心' })).has('bg-background')).toBe(true);
    expect(classesOf(screen.getByRole('tab', { name: '首页' })).has('bg-background')).toBe(false);
  });

  it('手写 tab 语义齐全：tablist + tab + aria-selected + aria-controls', () => {
    renderAt('/portal');
    const list = screen.getByTestId('portal-tab-switcher');
    expect(list.getAttribute('role')).toBe('tablist');
    expect(list.getAttribute('aria-label')).toBeTruthy();

    for (const [name, id] of [
      ['首页', 'portal-tab-home'],
      ['待办事项', 'portal-tab-todo'],
      ['消息中心', 'portal-tab-message'],
    ] as const) {
      const tab = screen.getByRole('tab', { name });
      // 稳定 id：供门户内容区 role="tabpanel" 的 aria-labelledby 反向引用。
      expect(tab.getAttribute('id')).toBe(id);
      // aria-controls 指向门户内容区（跨 React 树但同 document，IDREF 有效）。
      expect(tab.getAttribute('aria-controls')).toBe(PORTAL_TAB_PANEL_ID);
      expect(tab.getAttribute('aria-selected')).not.toBeNull();
      // 保持默认 tabIndex（可 Tab 键直接聚焦），不用 roving tabindex。
      expect(tab.hasAttribute('disabled')).toBe(false);
    }
  });
});
