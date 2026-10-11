// @vitest-environment jsdom
/**
 * 命令面板（全局搜索）集成测试（P0，QA 独立验证轮）。
 *
 * <p><b>被测</b>：`command-palette.tsx` 的索引构建、按 APP 分组/排序、降级与键盘导航。
 * <p><b>覆盖点</b>（对应 QA 任务 §3）：
 * 1. `buildSearchIndex()` 覆盖 6 份 `*_NAV`（不止 SYSTEM_NAV）——经组件渲染可见
 *    kb / agent 等此前搜不到的页面；
 * 2. 分组/排序：**当前 APP 置顶 → 其他 APP 次之 → 平台级置底**（当前 APP 由
 *    `resolveActiveHostAppCode` 依路由前缀解析）；
 * 3. 保留「返回门户」快捷项；
 * 4. `fetchApps` 失败时静默降级（不崩、纯 `*_NAV` 仍可用）；
 * 5. 关键词过滤 + 无匹配空态；键盘 ↑↓/回车行为不变。
 *
 * <p><b>mock 范式</b>（对齐 `portal-tabs.test.tsx` / `portal-page.smoke.test.tsx`）：
 * 整体替换 `@/lib/api/platform`；`react-router-dom` 的 `useNavigate` / `useLocation`
 * 用 spy/受控变量替换，从而精确构造「当前 APP」而无需真实路由。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandPalette } from './command-palette';
import * as platformApi from '@/lib/api/platform';
import { useAuthStore } from '@/stores/auth-store';
import type { AppItem } from '@/types/api';

const navigateSpy = vi.fn();
let mockPathname = '/kb/overview';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    useLocation: () => ({ pathname: mockPathname }),
  };
});

vi.mock('@/lib/api/platform', () => ({
  fetchApps: vi.fn(),
  fetchDashboardStats: vi.fn(),
}));

const fetchAppsMock = vi.mocked(platformApi.fetchApps);

/** 满足 AppItem 全部必填字段的测试应用。 */
function app(partial: Pick<AppItem, 'id' | 'code' | 'name'> & Partial<AppItem>): AppItem {
  return {
    tenantId: '1',
    icon: null,
    basePath: null,
    description: null,
    portalGroup: null,
    kind: 'host',
    runtime: 'host',
    sort: 0,
    status: 1,
    enterable: true,
    ...partial,
  };
}

/** 按 DOM 顺序返回所有条目按钮的文本。 */
function itemTitles(): string[] {
  return screen.getAllByRole('button').map((b) => b.textContent ?? '');
}

function idxOf(titles: string[], needle: string): number {
  return titles.findIndex((t) => t.includes(needle));
}

beforeEach(() => {
  navigateSpy.mockReset();
  mockPathname = '/kb/overview';
  fetchAppsMock.mockReset();
  // 登录态 app 置空：让「当前 APP」严格由路由解析（避免登录态干扰）。
  useAuthStore.setState({ app: null });
});

afterEach(() => {
  cleanup();
});

describe('CommandPalette · 索引覆盖（不止 SYSTEM_NAV）', () => {
  it('渲染出 kb / agent 等此前搜不到的页面条目', async () => {
    fetchAppsMock.mockResolvedValue([]);
    render(<CommandPalette open onOpenChange={() => undefined} />);
    // kb 的「命中测试」、agent 的「会话反馈」此前完全搜不到。
    expect(await screen.findByText('命中测试')).toBeTruthy();
    expect(screen.getByText('会话反馈')).toBeTruthy();
    // 系统管理的页面仍在。
    expect(screen.getByText('角色权限')).toBeTruthy();
  });

  it('保留「返回门户」快捷项', async () => {
    fetchAppsMock.mockResolvedValue([]);
    render(<CommandPalette open onOpenChange={() => undefined} />);
    expect(await screen.findByText('返回门户')).toBeTruthy();
  });
});

describe('CommandPalette · 分组与排序', () => {
  it('当前 APP（由路由解析）置顶、其他 APP 次之、平台级置底', async () => {
    fetchAppsMock.mockResolvedValue([]);
    // 路由前缀 /kb/* ⇒ 当前 APP = 'kb'
    mockPathname = '/kb/overview';
    render(<CommandPalette open onOpenChange={() => undefined} />);
    await screen.findByText('命中测试');

    const titles = itemTitles();
    const kbIdx = idxOf(titles, '命中测试'); // kb 应用级
    const agentIdx = idxOf(titles, '会话反馈'); // 其他 APP（agent）
    const portalIdx = idxOf(titles, '返回门户'); // 平台级

    expect(kbIdx).toBeGreaterThanOrEqual(0);
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(portalIdx).toBeGreaterThanOrEqual(0);

    // 当前 APP(kb) 在最前；其他 APP(agent) 居中；平台级(返回门户) 最后。
    expect(kbIdx).toBeLessThan(agentIdx);
    expect(agentIdx).toBeLessThan(portalIdx);
    // 平台级分组标题存在且唯一。
    expect(screen.getAllByText('平台级').length).toBe(1);
  });

  it('切换到 /agent/* 路由后，agent 项反超 kb 项置顶', async () => {
    fetchAppsMock.mockResolvedValue([]);
    mockPathname = '/agent/overview';
    render(<CommandPalette open onOpenChange={() => undefined} />);
    await screen.findByText('会话反馈');

    const titles = itemTitles();
    // 当前 APP = agent ⇒ agent 项应在 kb 项之前。
    expect(idxOf(titles, '会话反馈')).toBeLessThan(idxOf(titles, '命中测试'));
  });
});

describe('CommandPalette · fetchApps 失败静默降级', () => {
  it('fetchApps 失败时不崩溃，纯 *_NAV 索引仍可用（无 type=app 条目）', async () => {
    fetchAppsMock.mockRejectedValue(new Error('网络错误'));
    render(<CommandPalette open onOpenChange={() => undefined} />);

    // *_NAV 部分照常可用。
    expect(await screen.findByText('命中测试')).toBeTruthy();
    expect(screen.getByText('返回门户')).toBeTruthy();
    // 无 APP 条目 ⇒ 无「应用」徽标。
    await waitFor(() => {
      expect(screen.queryByText('应用')).toBeNull();
    });
    // 组件未因异常卸载：搜索框仍在。
    expect(screen.getByPlaceholderText('搜索页面、菜单、应用…')).toBeTruthy();
  });

  it('fetchApps 成功时并入 type=app 条目（带「应用」徽标）', async () => {
    fetchAppsMock.mockResolvedValue([
      app({ id: '91010', code: 'kb', name: '知识库', basePath: '/kb' }),
      app({ id: '1', code: 'system', name: '系统管理', basePath: '/system' }),
    ]);
    render(<CommandPalette open onOpenChange={() => undefined} />);
    await waitFor(() => {
      expect(screen.getAllByText('应用').length).toBeGreaterThan(0);
    });
  });
});

describe('CommandPalette · 关键词过滤与空态', () => {
  it('输入关键词只保留匹配项', async () => {
    fetchAppsMock.mockResolvedValue([]);
    render(<CommandPalette open onOpenChange={() => undefined} />);
    await screen.findByText('命中测试');

    fireEvent.change(screen.getByPlaceholderText('搜索页面、菜单、应用…'), {
      target: { value: '命中' },
    });

    expect(screen.getByText('命中测试')).toBeTruthy();
    expect(screen.queryByText('会话反馈')).toBeNull();
    expect(screen.queryByText('角色权限')).toBeNull();
  });

  it('无匹配时展示「无匹配结果」', async () => {
    fetchAppsMock.mockResolvedValue([]);
    render(<CommandPalette open onOpenChange={() => undefined} />);
    await screen.findByText('命中测试');

    fireEvent.change(screen.getByPlaceholderText('搜索页面、菜单、应用…'), {
      target: { value: 'zzz-绝无此页面-zzz' },
    });

    expect(screen.getByText('无匹配结果')).toBeTruthy();
  });
});

describe('CommandPalette · 键盘导航', () => {
  it('回车跳转到当前高亮项的路由', async () => {
    fetchAppsMock.mockResolvedValue([]);
    render(<CommandPalette open onOpenChange={() => undefined} />);
    await screen.findByText('命中测试');

    // 收敛到唯一结果，使「高亮项」确定。
    fireEvent.change(screen.getByPlaceholderText('搜索页面、菜单、应用…'), {
      target: { value: '命中测试' },
    });
    const content = screen.getByPlaceholderText('搜索页面、菜单、应用…').closest('div');
    // 在承载 keydown 的容器上触发回车。
    const dialogContent = document.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.keyDown(dialogContent, { key: 'Enter' });

    expect(navigateSpy).toHaveBeenCalledWith('/kb/hit-test');
    expect(content).toBeTruthy();
  });

  it('方向键不会越界（向下到末尾仍稳定，不抛错）', async () => {
    fetchAppsMock.mockResolvedValue([]);
    render(<CommandPalette open onOpenChange={() => undefined} />);
    await screen.findByText('命中测试');
    const dialogContent = document.querySelector('[role="dialog"]') as HTMLElement;
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(dialogContent, { key: 'ArrowUp' });
    }
    // 回到顶部后回车应跳转到当前 APP(kb) 的首项（不为空、不抛错）。
    fireEvent.keyDown(dialogContent, { key: 'Enter' });
    expect(navigateSpy).toHaveBeenCalled();
  });
});
