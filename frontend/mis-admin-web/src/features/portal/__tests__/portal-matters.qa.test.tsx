// @vitest-environment jsdom
/**
 * 【QA 独立验证 · 本轮 B1 / B2 / B4】门户「待办事项」子 Tab 结构 · 服务端聚合 · 发起人/参与人过滤。
 *
 * <p><b>为什么独立另写</b>：本轮要求「自己另写断言，别只复跑工程师的用例」。本文件**只 mock 最底层
 * axios 封装 `@/lib/api/client`**（不 mock `@/lib/api/tasks` 等业务 api 层）——因此可以在断言里
 * 看到**真实请求 URL 与 query 参数**，直接钉住「/tasks/matters 服务端聚合、无前端本地合并」这条
 * 需求红线（若走 api 层 mock，只能看到「调了 fetchPortalMatters」，看不到它到底打了哪个 URL）。
 *
 * <p>baseURL = `/api/v1`（见 `lib/api/client.ts`），故 `api.get('/tasks/matters')` 即
 * `GET /api/v1/tasks/matters`。
 *
 * <p>覆盖：
 * <ul>
 *   <li>{@link DEFAULT_TODO_TAB_KEY} = `'all'`、`TODO_TABS` 文案序列恰为 7 项、默认选中「全部」；</li>
 *   <li>「全部」只打 `/tasks/matters`，**零** `/tasks/my`、`/workflow/instances/my`、`/tasks/handled`；</li>
 *   <li>搜索 / 分页 / 切子 Tab 各只触发一次请求；打字不触发；</li>
 *   <li>发起人 / 参与人两参在「全部」与**既有子 Tab**（我发起的 / 我审批的）上均透传；</li>
 *   <li>清空 / 重置后两参**不透传**（URL 中无该键）。</li>
 * </ul>
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalTodoTab } from '../tabs/portal-todo-tab';
import api from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';
import { DEFAULT_TODO_TAB_KEY, usePortalTodoTabStore } from '@/stores/portal-todo-tab-store';
import { TODO_TABS } from '../lib/todo-tabs';

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: 'light' }),
}));

// 只 mock 最底层 axios 封装；业务 api 层（tasks/workflow/platform/biz-category）走真实现。
vi.mock('@/lib/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: ({ open, instanceId }: { open: boolean; instanceId: string | null }) =>
    open ? <div data-testid="todo-drawer" data-instance={instanceId ?? ''} /> : null,
}));

interface Cfg {
  params?: Record<string, unknown>;
}
const apiGet = api.get as unknown as {
  mockReset: () => void;
  mockImplementation: (fn: (url: string, config?: Cfg) => Promise<unknown>) => void;
  mock: { calls: Array<[string, Cfg?]> };
};

const emptyPage = { page: 1, size: 20, total: 0, list: [] as unknown[] };
function ok<T>(data: T): { data: { code: number; message: string; data: T } } {
  return { data: { code: 0, message: 'ok', data } };
}
function callsTo(url: string): Array<[string, Cfg?]> {
  return apiGet.mock.calls.filter((c) => c[0] === url);
}
function lastParams(url: string): Record<string, unknown> {
  const calls = callsTo(url);
  return calls[calls.length - 1]?.[1]?.params ?? {};
}

beforeEach(() => {
  useAuthStore.setState({
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
  // 子 Tab 是模块级单例，逐例复位到默认（「全部」）。
  usePortalTodoTabStore.setState({ activeKey: DEFAULT_TODO_TAB_KEY });
  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url === '/apps' || url === '/biz-categories') return Promise.resolve(ok([]));
    return Promise.resolve(ok(emptyPage));
  });
});

afterEach(() => {
  cleanup();
});

function renderTab() {
  return render(
    <MemoryRouter>
      <PortalTodoTab />
    </MemoryRouter>,
  );
}

describe('[QA·本轮 B1] 子 Tab 结构与默认选中「全部」', () => {
  it('子 Tab 文案序列恰为 [全部, 待处理, 审批中, 已通过, 已驳回, 抄送我的, 我发起的, 我审批的]', () => {
    renderTab();
    const labellist = within(screen.getByRole('tablist'))
      .getAllByRole('tab')
      .map((t) => (t.textContent ?? '').trim());
    expect(labellist).toEqual([
      '全部',
      '待处理',
      '审批中',
      '已通过',
      '已驳回',
      '抄送我的',
      '我发起的',
      '我审批的',
    ]);
    // 与配置源同序（防止 DOM 与 TODO_TABS 漂移）
    expect(TODO_TABS.map((t) => t.label)).toEqual(labellist);
  });

  it('进入即默认选中「全部」：DEFAULT_TODO_TAB_KEY=all，且「全部」aria-selected=true', async () => {
    renderTab();
    expect(DEFAULT_TODO_TAB_KEY).toBe('all');
    const allTab = screen.getByRole('tab', { name: '全部' });
    await waitFor(() => expect(allTab.getAttribute('aria-selected')).toBe('true'));
    expect(usePortalTodoTabStore.getState().activeKey).toBe('all');
  });
});

describe('[QA·本轮 B2] 「全部」走服务端聚合（无前端本地合并）', () => {
  it('「全部」调用 GET /api/v1/tasks/matters（服务端聚合端点）', async () => {
    renderTab();
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(1));
  });

  it('无前端本地合并：零 /tasks/my、零 /workflow/instances/my、零 /tasks/handled', async () => {
    renderTab();
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(1));
    expect(callsTo('/tasks/my')).toHaveLength(0);
    expect(callsTo('/workflow/instances/my')).toHaveLength(0);
    expect(callsTo('/tasks/handled')).toHaveLength(0);
  });

  it('搜索各触发且仅触发一次：打字不请求，回车才 +1（始终无本地合并）', async () => {
    renderTab();
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(1));

    const kw = screen.getByLabelText('待办关键词');
    fireEvent.change(kw, { target: { value: 'KW' } });
    expect(callsTo('/tasks/matters')).toHaveLength(1); // 打字不请求

    fireEvent.keyDown(kw, { key: 'Enter' });
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(2));
    // 即便搜索，也绝不回头打 /tasks/my 或 /workflow/instances/my
    expect(callsTo('/tasks/my')).toHaveLength(0);
    expect(callsTo('/workflow/instances/my')).toHaveLength(0);
  });

  it('分页「下一页」恰好再触发一次 /tasks/matters（page=2）', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/tasks/matters') return Promise.resolve(ok({ ...emptyPage, total: 25 }));
      if (url === '/apps' || url === '/biz-categories') return Promise.resolve(ok([]));
      return Promise.resolve(ok(emptyPage));
    });
    renderTab();
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(2));
    expect(lastParams('/tasks/matters').page).toBe(2);
  });

  it('切子 Tab「待处理」→ 恰好 1 次 /tasks/my（/tasks/matters 停在 1 次）', async () => {
    renderTab();
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(1));

    fireEvent.mouseDown(screen.getByRole('tab', { name: '待处理' }), { button: 0 });
    await waitFor(() => expect(callsTo('/tasks/my')).toHaveLength(1));
    expect(callsTo('/tasks/matters')).toHaveLength(1);
  });
});

describe('[QA·本轮 B4] 发起人 / 参与人过滤（作用于全部子 Tab）', () => {
  it('三个输入框存在，aria-label 与占位正确', () => {
    renderTab();
    expect(screen.getByLabelText('待办关键词').getAttribute('placeholder')).toBe('搜索标题 / 业务编号');
    expect(screen.getByLabelText('发起人').getAttribute('placeholder')).toBe('发起人');
    expect(screen.getByLabelText('参与人').getAttribute('placeholder')).toBe('参与人');
  });

  it('打字不请求；点「搜索」才把 initiatorName/participantName 透传给 /tasks/matters', async () => {
    renderTab();
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('发起人'), { target: { value: '张三' } });
    fireEvent.change(screen.getByLabelText('参与人'), { target: { value: '李四' } });
    expect(callsTo('/tasks/matters')).toHaveLength(1); // 打字不触发

    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(2));
    expect(lastParams('/tasks/matters')).toMatchObject({ initiatorName: '张三', participantName: '李四' });
  });

  it('既有子 Tab 同样带两参：我发起的→/workflow/instances/my、我审批的→/tasks/handled', async () => {
    renderTab();
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(1));

    fireEvent.mouseDown(screen.getByRole('tab', { name: '我发起的' }), { button: 0 });
    await waitFor(() => expect(callsTo('/workflow/instances/my')).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('发起人'), { target: { value: '王五' } });
    fireEvent.change(screen.getByLabelText('参与人'), { target: { value: '赵六' } });
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    await waitFor(() => expect(callsTo('/workflow/instances/my')).toHaveLength(2));
    expect(lastParams('/workflow/instances/my')).toMatchObject({ initiatorName: '王五', participantName: '赵六' });

    // 切到「我审批的」：搜索值跨子 Tab 保留，请求自动带上两参。
    fireEvent.mouseDown(screen.getByRole('tab', { name: '我审批的' }), { button: 0 });
    await waitFor(() => expect(callsTo('/tasks/handled')).toHaveLength(1));
    expect(lastParams('/tasks/handled')).toMatchObject({ initiatorName: '王五', participantName: '赵六' });
  });

  it('清空 / 重置后两参不透传（请求 URL 中无该键）', async () => {
    renderTab();
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('发起人'), { target: { value: '张三' } });
    fireEvent.change(screen.getByLabelText('参与人'), { target: { value: '李四' } });
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(2));
    expect(lastParams('/tasks/matters').initiatorName).toBe('张三');

    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    await waitFor(() => expect(callsTo('/tasks/matters')).toHaveLength(3));
    const p = lastParams('/tasks/matters');
    expect('initiatorName' in p).toBe(false);
    expect('participantName' in p).toBe(false);
  });
});
