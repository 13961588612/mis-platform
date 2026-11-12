// @vitest-environment jsdom
/**
 * 命令面板集成测试（门户三入口 + 各业务 APP 菜单）。
 *
 * <p><b>被测</b>：`command-palette.tsx`——渲染门户三入口与各 APP 菜单、点击门户项先写
 * `portal-tab-store` 再 `navigate('/portal')`、点击菜单项直接 `navigate(path)`、
 * 关键词过滤、空态、键盘导航；**不含工作台菜单 / 不含 `type:'app'` 项**。
 *
 * <p><b>mock 范式</b>：`react-router-dom` 的 `useNavigate` 用 spy 替换；
 * `usePortalTabStore` 是模块级单例，`beforeEach` 复位。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CommandPalette } from './command-palette';
import { usePortalTabStore } from '@/stores/portal-tab-store';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

beforeEach(() => {
  navigateSpy.mockReset();
  usePortalTabStore.setState({ activeTab: 'home' });
});

afterEach(() => {
  cleanup();
});

function dialog(): HTMLElement {
  const el = document.querySelector('[role="dialog"]');
  if (!el) throw new Error('命令面板对话框未渲染');
  return el as HTMLElement;
}

/** 按名称取条目按钮（accessible name = 标题文本）。 */
function entryButton(name: string): HTMLElement {
  return within(dialog()).getByRole('button', { name });
}

describe('CommandPalette · 门户三入口', () => {
  it('渲染门户首页 / 待办事项 / 消息中心，且带「门户」分组标题', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    expect(entryButton('门户首页')).toBeTruthy();
    expect(entryButton('待办事项')).toBeTruthy();
    expect(entryButton('消息中心')).toBeTruthy();
    expect(within(dialog()).getByText('门户')).toBeTruthy();
  });
});

describe('CommandPalette · 各 APP 菜单', () => {
  it('含 kb / agent / iqd / finance / system 的菜单项', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    for (const title of ['用户管理', '会话反馈', '命中测试', '问数', '终端管理']) {
      // 菜单项是 <button>；iqd 分组头与菜单项同名「问数」，须按按钮角色精确命中，避免 getByText 多匹配。
      expect(within(dialog()).getByRole('button', { name: title })).toBeTruthy();
    }
  });

  it('不含工作台菜单（task 被排除）', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    for (const gone of ['我的待办', '消息与待办', '我发起的', '我审批的']) {
      expect(within(dialog()).queryByText(gone)).toBeNull();
    }
  });
});

describe('CommandPalette · 点击跳转（门户项先写 store 再 navigate）', () => {
  it('点「待办事项」→ activeTab=todo 且 navigate("/portal")', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.click(entryButton('待办事项'));
    expect(usePortalTabStore.getState().activeTab).toBe('todo');
    expect(navigateSpy).toHaveBeenCalledWith('/portal');
  });

  it('点「消息中心」→ activeTab=message 且 navigate("/portal")', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.click(entryButton('消息中心'));
    expect(usePortalTabStore.getState().activeTab).toBe('message');
    expect(navigateSpy).toHaveBeenCalledWith('/portal');
  });

  it('点「门户首页」→ activeTab=home 且 navigate("/portal")', () => {
    usePortalTabStore.setState({ activeTab: 'todo' });
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.click(entryButton('门户首页'));
    expect(usePortalTabStore.getState().activeTab).toBe('home');
    expect(navigateSpy).toHaveBeenCalledWith('/portal');
  });

  it('点菜单项「用户管理」→ 直接 navigate("/system/user")，不改门户 Tab', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.click(entryButton('用户管理'));
    expect(navigateSpy).toHaveBeenCalledWith('/system/user');
    expect(usePortalTabStore.getState().activeTab).toBe('home');
  });
});

describe('CommandPalette · 关键词过滤与空态', () => {
  it('输入关键词只保留匹配项', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('搜索页面、菜单…'), { target: { value: '消息中心' } });
    expect(screen.getByText('消息中心')).toBeTruthy();
    expect(screen.queryByText('待办事项')).toBeNull();
    expect(screen.queryByText('门户首页')).toBeNull();
  });

  it('无匹配时展示「无匹配结果」', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('搜索页面、菜单…'), {
      target: { value: 'zzz-绝无此页面-zzz' },
    });
    expect(screen.getByText('无匹配结果')).toBeTruthy();
  });
});

describe('CommandPalette · 键盘导航', () => {
  it('↓ 移动高亮，回车跳转当前高亮项（默认首项=门户首页）', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    const dlg = dialog();

    // 默认高亮首项（门户首页），↓ 到「待办事项」。
    fireEvent.keyDown(dlg, { key: 'ArrowDown' });
    fireEvent.keyDown(dlg, { key: 'Enter' });

    expect(usePortalTabStore.getState().activeTab).toBe('todo');
    expect(navigateSpy).toHaveBeenCalledWith('/portal');
  });

  it('方向键不越界（顶部继续 ↑ 仍稳定），回车跳首项=home', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    const dlg = dialog();
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(dlg, { key: 'ArrowUp' });
    }
    fireEvent.keyDown(dlg, { key: 'Enter' });
    expect(usePortalTabStore.getState().activeTab).toBe('home');
    expect(navigateSpy).toHaveBeenCalledWith('/portal');
  });
});
