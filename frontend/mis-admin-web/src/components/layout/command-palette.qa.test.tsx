// @vitest-environment jsdom
/**
 * 【QA 独立验证】命令面板 = 门户三入口 + 各业务 APP 菜单（排除工作台）。
 *
 * <p><b>本轮口径变更</b>：命令面板从「只保留门户三入口」**扩回**为「门户三入口 + 各 APP 菜单」，
 * 但**工作台（task）菜单排除**、**不并入 `type:'app'` 列表**。本文件从 QA 角度独立取证：
 * <ul>
 *   <li>条目集合：含 system / agent / kb / iqd / finance 菜单；含门户三入口；</li>
 *   <li>**排除取证**：无 `type==='app'` 项；无工作台菜单（黑名单）；</li>
 *   <li>门户项点击时序：`navigate` 当下 store 已写，且 `navigate` 仅一个实参 `/portal`；</li>
 *   <li>菜单项点击：直接 `navigate(path)`，且**不改**门户 Tab；</li>
 *   <li>过滤 / 空态 / 键盘边界。</li>
 * </ul>
 *
 * <p>mock 范式：`useNavigate` 用 spy 替换；`usePortalTabStore` 模块级单例，`beforeEach` 复位。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { CommandPalette } from './command-palette';
import { usePortalTabStore } from '@/stores/portal-tab-store';

const navigateSpy = vi.fn();
/** `navigate` 被调用瞬间的 store 快照（用于证明「先写 store 再 jump」的时序）。 */
let storeAtNavigate: string | null = null;

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

beforeEach(() => {
  navigateSpy.mockReset();
  storeAtNavigate = null;
  navigateSpy.mockImplementation(() => {
    storeAtNavigate = usePortalTabStore.getState().activeTab;
  });
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

function entryByTitle(title: string): HTMLElement {
  return within(dialog()).getByRole('button', { name: title });
}

/** 工作台（task）菜单标题黑名单：本轮必须全部不出现。 */
const TASK_MENU_NAMES = ['我的待办', '消息与待办', '我发起的', '我审批的'];

describe('[QA-A] CommandPalette · 条目集合', () => {
  it('含门户三入口，且「门户」分组标题渲染', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    for (const title of ['门户首页', '待办事项', '消息中心']) {
      expect(entryByTitle(title)).toBeTruthy();
    }
    expect(within(dialog()).getByText('门户')).toBeTruthy();
  });

  it('含 system / agent / kb / iqd / finance 的代表性菜单项', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    // 逐个 APP 抽一项，证明确实并回了菜单，而非仅有门户。
    expect(within(dialog()).getByText('用户管理')).toBeTruthy(); // system
    expect(within(dialog()).getByText('会话反馈')).toBeTruthy(); // agent
    expect(within(dialog()).getByText('命中测试')).toBeTruthy(); // kb
    expect(within(dialog()).getByRole('button', { name: '问数' })).toBeTruthy(); // iqd（分组头同名，须按菜单项按钮精确命中）
    expect(within(dialog()).getByText('终端管理')).toBeTruthy(); // finance
  });

  it('排除取证：无任何工作台（task）菜单', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    for (const name of TASK_MENU_NAMES) {
      expect(within(dialog()).queryByText(name)).toBeNull();
    }
  });
});

describe('[QA-A] CommandPalette · 门户项点击跳转时序（先写 store 再 navigate）', () => {
  it('点「待办事项」：navigate 当下 store 已为 todo，且 navigate("/portal") 单参', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.click(entryByTitle('待办事项'));
    expect(storeAtNavigate).toBe('todo');
    expect(usePortalTabStore.getState().activeTab).toBe('todo');
    expect(navigateSpy).toHaveBeenCalledWith('/portal');
    expect(navigateSpy.mock.calls[0]).toHaveLength(1);
  });

  it('点「消息中心」：navigate 当下 store 已为 message', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.click(entryByTitle('消息中心'));
    expect(storeAtNavigate).toBe('message');
    expect(navigateSpy).toHaveBeenCalledWith('/portal');
  });

  it('点「门户首页」：先切到 message 再点，store 被写回 home', () => {
    usePortalTabStore.setState({ activeTab: 'message' });
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.click(entryByTitle('门户首页'));
    expect(storeAtNavigate).toBe('home');
    expect(navigateSpy).toHaveBeenCalledWith('/portal');
  });
});

describe('[QA-A] CommandPalette · 菜单项点击跳转', () => {
  it('点「用户管理」→ navigate("/system/user")，且门户 Tab 不变', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.click(entryByTitle('用户管理'));
    expect(navigateSpy).toHaveBeenCalledWith('/system/user');
    expect(storeAtNavigate).toBe('home');
  });

  it('点「终端管理」→ navigate("/finance/bank-account/pos-account/terminals")', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.click(entryByTitle('终端管理'));
    expect(navigateSpy).toHaveBeenCalledWith('/finance/bank-account/pos-account/terminals');
  });
});

describe('[QA-A] CommandPalette · 关键词过滤与空态', () => {
  it('输入「消息中心」→ 仅该项（门户消息）', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.change(within(dialog()).getByPlaceholderText('搜索页面、菜单…'), {
      target: { value: '消息中心' },
    });
    const titles = within(dialog())
      .getAllByRole('button')
      .map((b) => (b.textContent ?? '').trim());
    expect(titles).toEqual(['消息中心']);
  });

  it('输入乱码 → 无条目且展示空态「无匹配结果」', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.change(within(dialog()).getByPlaceholderText('搜索页面、菜单…'), {
      target: { value: 'qwerty-不存在的页面' },
    });
    expect(within(dialog()).queryAllByRole('button')).toHaveLength(0);
    expect(within(dialog()).getByText('无匹配结果')).toBeTruthy();
  });
});

describe('[QA-A] CommandPalette · 键盘导航', () => {
  it('↓ 一次 + Enter → 高亮第 2 项（待办事项）', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    fireEvent.keyDown(dialog(), { key: 'ArrowDown' });
    fireEvent.keyDown(dialog(), { key: 'Enter' });
    expect(usePortalTabStore.getState().activeTab).toBe('todo');
    expect(storeAtNavigate).toBe('todo');
  });

  it('↑ 越界钳制在首项（Enter 跳门户首页）', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);
    for (let i = 0; i < 4; i++) fireEvent.keyDown(dialog(), { key: 'ArrowUp' });
    fireEvent.keyDown(dialog(), { key: 'Enter' });
    expect(usePortalTabStore.getState().activeTab).toBe('home');
    expect(navigateSpy).toHaveBeenCalledWith('/portal');
  });
});
