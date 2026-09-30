// @vitest-environment jsdom
/**
 * iqd-scope-page.test.tsx — M-G6 「行级维度徽标 + 谓词预览」组件级验证。
 *
 * <p>为何单独钉：此前 M-G6 只有 `rowScopeUtils` 的纯函数单测（徽标判定 /
 * 谓词拼接），**页面真实渲染与后端预览接线从未验过**。
 * 2026-09-28 预览改走后端真端点（POST /iqd/scope/preview）后，本用例钉住三件事：
 * <ol>
 *   <li>行级维度徽标确实渲染（dept + store）；</li>
 *   <li>展开后调的是**后端预览端点**（而非前端推导）；</li>
 *   <li>后端返回的 WHERE 片段被**原样展示**，并标「后端真实生成」（非「降级」）。</li>
 * </ol>
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IqdScopePage } from './iqd-scope-page';
import * as iqdApi from '@/lib/api/iqd';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/features/agent/iqd/api/iqd-modeling', () => ({
  listConnections: vi.fn(async () => [{ id: 900001, name: 'default', mcp_status: 'running' }]),
}));

vi.mock('@/lib/api/iqd', () => ({
  getIqdConfig: vi.fn(),
  listIqdScopePolicies: vi.fn(),
  listIqdAcls: vi.fn(),
  listIqdDimensions: vi.fn(),
  previewIqdRowScope: vi.fn(),
  saveIqdScopePolicies: vi.fn(),
  saveIqdAcls: vi.fn(),
  deleteIqdAcl: vi.fn(),
}));

const m = vi.mocked(iqdApi);

const BACKEND_WHERE =
  "(EXISTS (SELECT 1 FROM mis_dept_scope rs WHERE rs.dept_id = dept_id AND " +
  "((rs.dept_path = '/0/1/A/' OR rs.dept_path LIKE '/0/1/A/%')))) AND (store_id IN ('S1'))";

beforeEach(() => {
  useAuthStore.getState().setPermissions(['iqd:scope:view', 'iqd:acl:view', 'iqd:dimension:view']);
  m.getIqdConfig.mockResolvedValue({ name: 'x', id: 900001 } as never);
  m.listIqdScopePolicies.mockResolvedValue([]);
  m.listIqdDimensions.mockResolvedValue([
    {
      dimension_code: 'dept',
      dimension_name: '部门',
      predicate_type: 'PATH_PREFIX',
      column_name: 'dept_id',
      header_name: 'X-Mis-Dept-Scope',
      dict_table: 'mis_dept_scope',
      enabled: true,
      sort: 1,
    },
    {
      dimension_code: 'store',
      dimension_name: '门店',
      predicate_type: 'ENUM',
      column_name: 'store_id',
      header_name: 'X-Mis-Stores',
      dict_table: 'mis_store_scope',
      enabled: true,
      sort: 2,
    },
  ] as never);
  m.listIqdAcls.mockResolvedValue([
    {
      id: 1,
      subject_type: 'role',
      subject_id: 'SALES',
      item_key: 'ads_df',
      action: 'ask',
      row_scope: '{"dimensions":[{"dimension":"dept","scope":"dept_subtree"},{"dimension":"store","scope":"store"}]}',
    },
  ] as never);
  m.previewIqdRowScope.mockResolvedValue({
    degraded: false,
    note: '后端按当前身份真实生成的谓词',
    items: [
      {
        item_key: 'ads_df',
        dimensions: ['dept', 'store'],
        predicates: [],
        where: BACKEND_WHERE,
        strategy: 'PATH_PREFIX, ENUM',
        denied_reason: null,
        source: 'draft',
      },
    ],
  } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthStore.getState().setPermissions([]);
});

describe('M-G6 scope 页徽标 + 后端谓词预览', () => {
  /** 徽标元格按钮（按 title 精确定位，避开主体类型 <option>同名文案）。 */
  async function expandBadgeCell() {
    const btn = await screen.findByTitle('点击展开行级谓词预览');
    fireEvent.click(btn);
  }

  function renderPage() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <IqdScopePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('ACL 行渲染 dept + store 两个行级维度徽标', async () => {
    renderPage();
    await screen.findByText(/表级 ACL/);
    // 徽标在展开按钮内（与主体类型下拉的「部门」选项同名，故限定作用域）
    const btn = await screen.findByTitle('点击展开行级谓词预览');
    expect(btn.textContent).toContain('部门');
    expect(btn.textContent).toContain('门店');
    expect(btn.textContent).toContain('AND');
  });

  it('展开后调后端预览端点，并原样展示返回的 WHERE', async () => {
    renderPage();
    await expandBadgeCell();

    await waitFor(() => expect(m.previewIqdRowScope).toHaveBeenCalled());
    const arg = m.previewIqdRowScope.mock.calls[0][0];
    expect(arg.item_key).toBe('ads_df');
    expect(arg.draft_rules?.[0]?.item_key).toBe('ads_df');

    await waitFor(() => expect(m.previewIqdRowScope).toHaveBeenCalled());
    expect(await screen.findByText('后端真实生成', {}, { timeout: 4000 })).toBeTruthy();
    expect(await screen.findByText(new RegExp('mis_dept_scope'))).toBeTruthy();
    // 不再标「示意 / 降级」
    expect(screen.queryByText('示意 / 降级')).toBeNull();
  });

  it('后端返回 denied_reason 时，展示「后端提示：…」', async () => {
    m.previewIqdRowScope.mockResolvedValue({
      degraded: false,
      note: '',
      items: [
        {
          item_key: 'ads_df',
          dimensions: [],
          predicates: [],
          where: '',
          strategy: 'NONE',
          denied_reason: '缺少维度授权范围: dept',
          source: 'draft',
        },
      ],
    } as never);
    renderPage();
    await expandBadgeCell();

    expect(
      await screen.findByText(/后端提示：缺少维度授权范围/),
    ).toBeTruthy();
  });
});
