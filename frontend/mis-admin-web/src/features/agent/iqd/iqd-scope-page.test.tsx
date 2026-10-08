// @vitest-environment jsdom
/**
 * iqd-scope-page.test.tsx — 页面级验证（v1.12 UI 重构后）。
 *
 * 覆盖：
 * 1. 新增范围策略三步向导（主体 -> 对象 -> 字段）能走通并提交正确 payload；
 * 2. 过滤区按角色多选过滤生效；
 * 3. 字段默认全选、可清空。
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
  listIqdScopePolicies: vi.fn(async () => []),
  listIqdAcls: vi.fn(async () => []),
  listIqdDimensions: vi.fn(async () => [
    { dimension_code: 'dept', dimension_name: '部门', predicate_type: 'PATH_PREFIX', column_name: 'dept_id', header_name: 'X-Mis-Dept-Scope', enabled: true },
    { dimension_code: 'store', dimension_name: '门店', predicate_type: 'ENUM', column_name: 'store_id', header_name: 'X-Mis-Stores', enabled: true },
  ]),
  saveIqdScopePolicies: vi.fn(async () => ({ count: 1 })),
  saveIqdAcls: vi.fn(async () => ({ count: 1 })),
  deleteIqdAcl: vi.fn(async () => undefined),
  deleteIqdScopePolicy: vi.fn(async () => undefined),
  deleteIqdScopePoliciesBatch: vi.fn(async () => ({ count: 1 })),
  listIqdCatalog: vi.fn(async () => [
    { kind: 'table', item_key: 'pg.public.orders', display_name: '订单表', in_scope: true },
    { kind: 'column', item_key: 'pg.public.orders.amount', display_name: '金额', parent_key: 'pg.public.orders' },
    { kind: 'column', item_key: 'pg.public.orders.store_id', display_name: '门店', parent_key: 'pg.public.orders' },
    { kind: 'model', item_key: 'mdl:model:orders', display_name: '订单模型', model_ref: 'pg.public.orders', in_scope: true },
    { kind: 'cube', item_key: 'mdl:cube:sales', display_name: '销售 Cube', in_scope: true },
  ]),
}));

vi.mock('@/lib/api/roles', () => ({
  listEnabledRoles: vi.fn(async () => [
    { id: '1', code: 'SALES', name: '销售' },
    { id: '2', code: 'ADMIN', name: '管理员' },
  ]),
}));

vi.mock('@/lib/api/users', () => ({
  getUser: vi.fn(async () => ({ id: 'u1', username: 'u1', realName: '张三' })),
  pageUsers: vi.fn(async () => ({
    page: 1, size: 20, total: 1,
    list: [{ id: 'u1', username: 'u1', realName: '张三' }],
  })),
}));

const m = vi.mocked(iqdApi);

beforeEach(() => {
  useAuthStore.getState().setPermissions(['iqd:scope:view', 'iqd:acl:view']);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthStore.getState().setPermissions([]);
});

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

describe('M-G6 scope 页面（v1.12 重构）', () => {
  it('页面渲染两个权限区块', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: '范围策略' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: '行级范围' })).toBeTruthy();
  });

  it('范围策略：三步向导能走通并提交正确的 payload（默认全选字段）', async () => {
    renderPage();
    const addBtn = await screen.findByRole('button', { name: '新增范围策略' });
    fireEvent.click(addBtn);

    // Step 1: 选择角色
    const roleBtn = await screen.findByRole('button', { name: /角色/ });
    fireEvent.click(roleBtn);
    const roleOpt = await screen.findByRole('button', { name: /销售/ });
    fireEvent.click(roleOpt);
    expect(roleOpt.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('已选：')).toBeTruthy();
    const confirmRole = await screen.findByRole('button', { name: '确定' });
    fireEvent.click(confirmRole);

    // Step 2: 选择对象
    const nextBtn = await screen.findByRole('button', { name: '下一步' });
    fireEvent.click(nextBtn);
    const tableOpt = await screen.findByText('订单表');
    fireEvent.click(tableOpt);
    const next2 = await screen.findByRole('button', { name: '下一步' });
    fireEvent.click(next2);

    // Step 3: 默认全选字段 -> 确认
    const createBtn = await screen.findByRole('button', { name: '确认创建' });
    fireEvent.click(createBtn);

    await waitFor(() => expect(m.saveIqdScopePolicies).toHaveBeenCalled());
    const [connId, payload] = m.saveIqdScopePolicies.mock.calls[0];
    expect(connId).toBe(900001);
    const keys = (payload as Array<{ item_key: string; subject_type: string; subject_id: string }>).map((p) => p.item_key);
    expect(keys).toContain('pg.public.orders');
    expect(keys).toContain('pg.public.orders.amount');
    expect(keys).toContain('pg.public.orders.store_id');
    for (const p of payload as Array<{ subject_type: string; subject_id: string }>) {
      expect(p.subject_type).toBe('role');
      expect(p.subject_id).toBe('SALES');
    }
  });


  it('编辑范围策略：跳过主体/对象步骤，取消勾选字段时调用批量删除', async () => {
    m.listIqdScopePolicies.mockResolvedValueOnce([
      { id: 11, subject_type: 'role', subject_id: 'SALES', item_key: 'pg.public.orders', allow: true, effective: true },
      { id: 12, subject_type: 'role', subject_id: 'SALES', item_key: 'pg.public.orders.amount', allow: true, effective: true },
      { id: 13, subject_type: 'role', subject_id: 'SALES', item_key: 'pg.public.orders.store_id', allow: true, effective: true },
    ] as never);
    m.deleteIqdScopePoliciesBatch.mockResolvedValueOnce({ count: 1 } as never);
    renderPage();

    const editBtn = await screen.findByTitle('编辑');
    fireEvent.click(editBtn);

    // 直接进入字段步骤
    const createBtn = await screen.findByRole('button', { name: '确认创建' });
    // 取消勾选“金额”
    const amountBox = screen.getByRole('checkbox', { name: '金额' });
    fireEvent.click(amountBox);
    fireEvent.click(createBtn);

    await waitFor(() => expect(m.saveIqdScopePolicies).toHaveBeenCalled());
    const payload = m.saveIqdScopePolicies.mock.calls.at(-1)![1] as Array<{ item_key: string }>;
    const keys = payload.map((p) => p.item_key);
    expect(keys).toContain('pg.public.orders');
    expect(keys).toContain('pg.public.orders.store_id');
    expect(keys).not.toContain('pg.public.orders.amount');
    expect(m.deleteIqdScopePoliciesBatch).toHaveBeenCalledWith(
      900001,
      'role',
      'SALES',
      ['pg.public.orders.amount'],
    );
  });

  it('列表直接使用后端回填的 subject_name，不再前端逐用户查名', async () => {
    m.listIqdScopePolicies.mockResolvedValueOnce([
      {
        id: 21,
        subject_type: 'user',
        subject_id: 'u1',
        subject_name: '张三',
        item_key: 'pg.public.orders',
        allow: true,
        effective: true,
      },
    ] as never);
    renderPage();

    expect(await screen.findByText('张三')).toBeTruthy();
  });

  it('范围策略可显示 global，并支持「只看全局」过滤', async () => {
    m.listIqdScopePolicies.mockResolvedValueOnce([
      {
        id: 1,
        subject_type: 'global',
        subject_id: 'global',
        subject_name: '全局',
        item_key: 'pg.public.orders',
        allow: true,
        effective: true,
      },
      {
        id: 2,
        subject_type: 'role',
        subject_id: 'SALES',
        subject_name: '销售',
        item_key: 'pg.public.orders',
        allow: true,
        effective: true,
      },
    ] as never);
    renderPage();

    expect(await screen.findByText('销售')).toBeTruthy();
    expect(screen.getAllByText('全局').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('主体类型过滤'), { target: { value: 'global' } });
    expect(screen.getAllByText('全局').length).toBeGreaterThan(0);
    expect(screen.queryByText('销售')).toBeNull();
  });

  it('范围策略：多选行后一起删除', async () => {
    m.listIqdScopePolicies.mockResolvedValueOnce([
      { id: 11, subject_type: 'role', subject_id: 'SALES', subject_name: '销售', item_key: 'pg.public.orders', allow: true, effective: true },
      { id: 12, subject_type: 'role', subject_id: 'SALES', subject_name: '销售', item_key: 'mdl:model:orders', allow: true, effective: true },
    ] as never);
    renderPage();

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 销售 订单表' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 销售 订单模型' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除选中' }));

    await waitFor(() => expect(m.deleteIqdScopePolicy).toHaveBeenCalledTimes(2));
    expect(m.deleteIqdScopePolicy).toHaveBeenCalledWith(11);
    expect(m.deleteIqdScopePolicy).toHaveBeenCalledWith(12);
  });

  it('行级范围：多选行后一起删除', async () => {
    m.listIqdAcls.mockResolvedValueOnce([
      { id: 21, subject_type: 'role', subject_id: 'SALES', subject_name: '销售', item_key: 'pg.public.orders', action: 'ask' },
      { id: 22, subject_type: 'role', subject_id: 'SALES', subject_name: '销售', item_key: 'mdl:model:orders', action: 'ask' },
    ] as never);
    renderPage();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: '行级范围' }));

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 销售 订单表' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 销售 订单模型' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除选中' }));

    await waitFor(() => expect(m.deleteIqdAcl).toHaveBeenCalledTimes(2));
    expect(m.deleteIqdAcl).toHaveBeenCalledWith(21);
    expect(m.deleteIqdAcl).toHaveBeenCalledWith(22);
  });

  it('行级范围：提交 action=ask', async () => {
    renderPage();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: '行级范围' }));
    const addBtn = await screen.findByRole('button', { name: '新增行级范围' });
    fireEvent.click(addBtn);

    const userBtn = await screen.findByRole('button', { name: /用户/ });
    fireEvent.click(userBtn);
    const userOpt = await screen.findByRole('button', { name: /张三/ });
    fireEvent.click(userOpt);
    const confirmUser = await screen.findByRole('button', { name: '确定' });
    fireEvent.click(confirmUser);

    const nextBtn = await screen.findByRole('button', { name: '下一步' });
    fireEvent.click(nextBtn);
    const tableOpt = await screen.findByText('订单表');
    fireEvent.click(tableOpt);
    const next2 = await screen.findByRole('button', { name: '下一步' });
    fireEvent.click(next2);
    const createBtn = await screen.findByRole('button', { name: '确认创建' });
    fireEvent.click(createBtn);

    await waitFor(() => expect(m.saveIqdAcls).toHaveBeenCalled());
    const payload = m.saveIqdAcls.mock.calls[0][1] as Array<{ action?: string; subject_type: string; subject_id: string; object_type: string; object_key: string; field_key?: string | null }>;
    expect(payload.length).toBeGreaterThan(0);
    for (const p of payload) {
      expect(p.action).toBe('ask');
      expect(p.subject_type).toBe('user');
      expect(p.subject_id).toBe('u1');
      expect(p.object_type).toBe('table');
      expect(p.object_key).toBe('pg.public.orders');
      expect(p.field_key ?? null).toBeNull();
    }
  });
});
