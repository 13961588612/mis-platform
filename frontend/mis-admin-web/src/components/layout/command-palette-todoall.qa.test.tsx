// @vitest-environment jsdom
/**
 * 【QA 独立验证 · 本轮 B3】命令面板（⌘K）「待办事项」跳转**时序**取证。
 *
 * <p>需求：点「待办事项」→ 门户「待办事项」主 Tab + 子 Tab 落「全部」。
 *
 * <p><b>与工程师/上轮用例的区别</b>：本文件不满足于「两个 store 最终值对」，而是用一个
 * 记录型 `useNavigate` spy，在 `navigate` 被调用的**那一刻**快照两个 store —— 证明确实
 * **先写子 Tab（all）再写主 Tab（todo）再 navigate**（顺序反了会让待办面板以旧键挂载、
 * 多打一轮请求）。同时断言 `navigate` **仅一个实参 `/portal`**。
 *
 * <p>另断言：点「消息中心 / 门户首页」**不触碰**子 Tab store（保持原值），即只有「待办事项」
 * 落「全部」，首页三板块的「查看全部」口径不受本改动影响。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from './command-palette';
import { usePortalTabStore } from '@/stores/portal-tab-store';
import { usePortalTodoTabStore } from '@/stores/portal-todo-tab-store';

const navigateSpy = vi.fn();
/** navigate 被调用瞬间的两个 store 快照（时序证据）。 */
let snap: { todoKey: string; activeTab: string } | null = null;

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

beforeEach(() => {
  navigateSpy.mockReset();
  snap = null;
  navigateSpy.mockImplementation(() => {
    snap = {
      todoKey: usePortalTodoTabStore.getState().activeKey,
      activeTab: usePortalTabStore.getState().activeTab,
    };
  });
  // 模块级单例复位：主 Tab 置非 todo、子 Tab 置非 all（证明确实被本次点击改写）。
  usePortalTabStore.setState({ activeTab: 'home' });
  usePortalTodoTabStore.setState({ activeKey: 'pending' });
});

afterEach(() => {
  cleanup();
});

describe('[QA·本轮 B3] 命令面板「待办事项」跳转时序', () => {
  it('点「待办事项」：navigate 当下 子Tab=all 且 主Tab=todo；navigate 仅 1 个实参 /portal', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '待办事项' }));

    // 时序证据：navigate 被调用的那一刻，两个 store 都已是目标值。
    expect(snap).toEqual({ todoKey: 'all', activeTab: 'todo' });
    // 终值一致。
    expect(usePortalTodoTabStore.getState().activeKey).toBe('all');
    expect(usePortalTabStore.getState().activeTab).toBe('todo');
    // 参数恰为单参 '/portal'。
    expect(navigateSpy).toHaveBeenCalledWith('/portal');
    expect(navigateSpy.mock.calls[0]).toHaveLength(1);
    expect(navigateSpy.mock.calls[0][0]).toBe('/portal');
  });

  it('点「待办事项」会把旧子 Tab（mySent）覆写为 all', () => {
    usePortalTodoTabStore.setState({ activeKey: 'mySent' });
    render(<CommandPalette open onOpenChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '待办事项' }));

    expect(usePortalTodoTabStore.getState().activeKey).toBe('all');
    expect(snap).toEqual({ todoKey: 'all', activeTab: 'todo' });
  });

  it('点「消息中心」不触碰子 Tab store（保持原值 pending），仅主 Tab=message', () => {
    render(<CommandPalette open onOpenChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '消息中心' }));

    expect(usePortalTabStore.getState().activeTab).toBe('message');
    expect(usePortalTodoTabStore.getState().activeKey).toBe('pending');
    expect(snap).toEqual({ todoKey: 'pending', activeTab: 'message' });
  });

  it('点「门户首页」不触碰子 Tab store（保持原值 mySent），主 Tab=home', () => {
    usePortalTodoTabStore.setState({ activeKey: 'mySent' });
    render(<CommandPalette open onOpenChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '门户首页' }));

    expect(usePortalTabStore.getState().activeTab).toBe('home');
    expect(usePortalTodoTabStore.getState().activeKey).toBe('mySent');
    expect(snap).toEqual({ todoKey: 'mySent', activeTab: 'home' });
  });
});
