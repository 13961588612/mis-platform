// @vitest-environment jsdom
/**
 * ProcessDetailPage 路由 ID 回归测试。
 *
 * <p>**Bug**：`useParams` 在本应用恒返回空对象。页面由 `KeepAliveOutlet` 按路径直挂
 * （`keep-alive-outlet.tsx` 渲染 `<Comp />`），而 `router.tsx` 对 `/task/*` 只登记了
 * `element={null}` 的通配路由 ⇒ 页面**不在任何 `<Route>` 上下文内** ⇒
 * `useParams()` 恒为 `{}` ⇒ `id` 恒undefined ⇒ 点开任何流程都显示「缺少流程实例 ID」。
 *
 * <p>**测试写法（关键，勿改成给替身包 `<Route>`）**：本组用例一律
 * `<MemoryRouter><ProcessDetailPage/></MemoryRouter>`，**不套`<Route>`**。
 * 真实环境里页面就是被裸渲染的；一旦给替身包上带 `path="/task/process/:id"` 的 Route，
 * `useParams` 就有值了，测到的将是「有 Route 上下文」这条永远不会发生的路径，
 * 恰好把这个 Bug漏掉。同理，真实环境下 `useLocation().pathname` 就是当前地址的
 * pathname（react-router 已剥离 query/hash），故用 `MemoryRouter initialEntries`
 * 喂完整 URL 即可，无需手工 mock `useLocation`（mock 形态反而容易与真实不一致）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProcessDetailPage, parseInstancePath } from './process-detail-page';

/**
 * ProcessShell 替身：真实组件挂载即发接口（fetchProcessDetail），本测试只关心
 * 「页面能否把 ID 从 pathname 取出来」，故替换为记录instanceId 的轻量替身，
 * 顺带用 `calls` 断言「非法/缺失 ID 时压根不挂载详情壳、不发请求」。
 */
const calls: string[] = [];
vi.mock('./process-shell', () => ({
  ProcessShell: ({ instanceId }: { instanceId: string }) => {
    calls.push(instanceId);
    return <div data-testid="process-shell">{instanceId}</div>;
  },
}));

/** 裸渲染（无 Route 上下文），与 KeepAliveOutlet 的真实渲染方式一致。 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProcessDetailPage />
    </MemoryRouter>,
  );
}

describe('ProcessDetailPage：无 Route 上下文时从 pathname 取实例 ID', () => {
  afterEach(() => {
    cleanup();
    calls.length = 0;
  });

  it('回归：/task/process/128 能拿到 ID 128（修复前恒显示「缺少流程实例 ID」）', () => {
    renderAt('/task/process/128');
    expect(screen.getByTestId('process-shell').textContent).toBe('128');
    expect(calls).toEqual(['128']);
    expect(screen.queryByText(/缺少流程实例 ID/)).toBeNull();
  });

  it.each([
    ['/task/process/1', '1'],
    ['/task/process/999999', '999999'],
    // 带query / hash：react-router 的 pathname 已剥离，解析器再兜一层
    ['/task/process/128?from=/portal', '128'],
    ['/task/process/128#top', '128'],
    // 重复斜杠：不该把空段当 ID
    ['/task/process//128', '128'],
    // 前导 '0' 归一，避免同一实例开出两个 Tab
    ['/task/process/0128', '128'],
  ])('%s ⇒ instanceId %s', (path, expected) => {
    renderAt(path);
    expect(screen.getByTestId('process-shell').textContent).toBe(expected);
  });

  it('空尾段 /task/process/ ⇒ 走错误分支，不崩、不挂详情壳', () => {
    renderAt('/task/process/');
    expect(screen.getByText('缺少流程实例 ID')).toBeTruthy();
    expect(calls).toEqual([]);
    expect(screen.queryByTestId('process-shell')).toBeNull();
  });

  it.each([
    ['非法 ID /task/process/abc', '/task/process/abc'],
    ['零/负数/小数 /task/process/0', '/task/process/0'],
    ['负数 /task/process/-1', '/task/process/-1'],
    ['小数 /task/process/12.5', '/task/process/12.5'],
    ['前后带空白 /task/process/%20128', '/task/process/%20128'],
    ['坏编码 /task/process/%zz', '/task/process/%zz'],
  ])('%s ⇒ 判非法，不拉接口', (_label, path) => {
    renderAt(path);
    expect(screen.getByText('流程实例 ID 非法')).toBeTruthy();
    expect(calls).toEqual([]);
    expect(screen.queryByTestId('process-shell')).toBeNull();
  });

  it('错误文案能区分「缺失」与「非法」，并给出期望地址', () => {
    const { unmount } = renderAt('/task/process/');
    expect(screen.getByText(/地址应为 \/task\/process\/\{实例ID\}/)).toBeTruthy();
    unmount();
    cleanup();
    renderAt('/task/process/abc');
    expect(screen.getByText('流程实例 ID 应为数字，请检查地址栏')).toBeTruthy();
  });
});

/** 纯函数单测：不依赖渲染，直接锁死解析口径。 */
describe('parseInstancePath', () => {
  it.each([
    ['/task/process/128', '128', 'ok'],
    ['/task/process/128/', '128', 'ok'],
    ['/task/process/128?a=1#b', '128', 'ok'],
    ['/task/process//128', '128', 'ok'],
    ['/task/process/%31%32%38', '128', 'ok'],
    ['/task/process/', null, 'missing'],
    ['/task/process', null, 'missing'],
    ['/task/process//', null, 'missing'],
    ['/task/process/128/extra', null, 'missing'],
    ['/task/process/abc', null, 'invalid'],
    ['/task/process/0', null, 'invalid'],
    ['/task/process/-1', null, 'invalid'],
    ['/task/process/12.5', null, 'invalid'],
    ['/task/process/%zz', null, 'invalid'],
    // 前缀不符（非本组件路由）
    ['/kb/libraries/12', null, 'missing'],
    ['/task/pending', null, 'missing'],
  ])('%s ⇒ %s / %s', (path, instanceId, reason) => {
    expect(parseInstancePath(path)).toEqual({ instanceId, reason });
  });
});