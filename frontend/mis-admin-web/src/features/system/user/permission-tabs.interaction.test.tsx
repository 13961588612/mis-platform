// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import type { DeptNode, OrgItem, RoleItem } from '@/types/api';
import { PermissionTabs, type PermSelection } from './permission-tabs';

vi.mock('@/lib/api/depts', () => ({
  fetchDeptTree: vi.fn(),
}));
import { fetchDeptTree } from '@/lib/api/depts';

const orgs: OrgItem[] = [
  {
    id: '1',
    tenantId: 't1',
    code: 'O1',
    name: '组织一',
    parentId: '0',
    sort: 0,
    status: 1,
    remark: null,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: '2',
    tenantId: 't1',
    code: 'O2',
    name: '组织二',
    parentId: '0',
    sort: 0,
    status: 1,
    remark: null,
    createdAt: null,
    updatedAt: null,
  },
];

const roles: RoleItem[] = [
  {
    id: '10',
    tenantId: 't1',
    appId: '1',
    code: 'ADMIN',
    name: '管理员',
    type: 1,
    dataScope: 1,
    status: 1,
    remark: null,
    createdAt: null,
  },
  {
    id: '11',
    tenantId: 't1',
    appId: '1',
    code: 'OP',
    name: '运营',
    type: 1,
    dataScope: 1,
    status: 1,
    remark: null,
    createdAt: null,
  },
];

function dept(id: string, name: string, children?: DeptNode[]): DeptNode {
  return {
    id,
    tenantId: 't1',
    orgId: '1',
    parentId: '0',
    code: id,
    name,
    categoryId: null,
    ancestors: null,
    sort: 0,
    status: 1,
    isRoot: null,
    leaderEmployeeId: null,
    linkedOrgId: null,
    linkedOrgName: null,
    createdAt: null,
    updatedAt: null,
    children: children?.length ? children : null,
  };
}

const emptyValue: PermSelection = { orgIds: [], deptIds: [], roleIds: [] };

async function flushDeptLoad(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('PermissionTabs 交互（组织/部门/角色三 TAB）', () => {
  beforeEach(() => {
    vi.mocked(fetchDeptTree).mockReset();
    vi.mocked(fetchDeptTree).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('点击组织 checkbox 触发 onChange 且受控值可回显', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<PermissionTabs orgs={orgs} roles={roles} value={emptyValue} onChange={onChange} />);

    // Radix Tabs 的 Trigger 在 onMouseDown 里触发 onValueChange，须用 mouseDown 模拟点击
    fireEvent.mouseDown(screen.getByRole('tab', { name: '组织' }));

    const orgCheckbox = screen.getByRole('checkbox', { name: '组织一' });
    fireEvent.click(orgCheckbox);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as PermSelection;
    expect(next.orgIds).toEqual(['1']);

    // 父组件按受控协议回传新 value 后，checkbox 应勾选
    rerender(<PermissionTabs orgs={orgs} roles={roles} value={{ ...emptyValue, orgIds: ['1'] }} onChange={onChange} />);
    expect((screen.getByRole('checkbox', { name: '组织一' }) as HTMLInputElement).checked).toBe(true);

    // 再次点击应取消勾选
    fireEvent.click(screen.getByRole('checkbox', { name: '组织一' }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0].orgIds).toEqual([]);
  });

  it('切换角色 tab 点击角色 checkbox 触发 onChange', async () => {
    const onChange = vi.fn();
    render(<PermissionTabs orgs={orgs} roles={roles} value={emptyValue} onChange={onChange} />);

    fireEvent.mouseDown(screen.getByRole('tab', { name: '角色' }));
    const roleCheckbox = await screen.findByRole('checkbox', { name: /管理员/ });
    fireEvent.click(roleCheckbox);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].roleIds).toEqual(['10']);
  });

  it('部门树：默认全部收起，展开后点击部门 checkbox 触发 onChange 且仅切换本节点', async () => {
    const roots = [dept('d1', '研发部', [dept('d11', '前端组'), dept('d12', '后端组')]), dept('d2', '市场部')];
    // 组织一有部门树、组织二为空：避免同一棵树渲染两份导致 role 查询歧义
    vi.mocked(fetchDeptTree).mockResolvedValueOnce(roots).mockResolvedValue([]);

    const onChange = vi.fn();
    const { rerender } = render(<PermissionTabs orgs={orgs} roles={roles} value={emptyValue} onChange={onChange} />);
    await flushDeptLoad();

    fireEvent.mouseDown(screen.getByRole('tab', { name: '部门' }));

    // 默认收起：仅显示根节点，看不到「前端组」/「后端组」
    expect(await screen.findByRole('checkbox', { name: '研发部' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '前端组' })).toBeNull();

    // 展开根节点
    fireEvent.click(await screen.findByRole('button', { name: '展开' }));
    expect(await screen.findByRole('checkbox', { name: '前端组' })).toBeTruthy();

    // 点击「研发部」仅切换自身，不级联子孙
    fireEvent.click(screen.getByRole('checkbox', { name: '研发部' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next1 = onChange.mock.calls[0][0] as PermSelection;
    expect(next1.deptIds).toEqual(['d1']);

    rerender(
      <PermissionTabs
        orgs={orgs}
        roles={roles}
        value={{ ...emptyValue, deptIds: ['d1'] }}
        onChange={onChange}
      />,
    );
    expect((screen.getByRole('checkbox', { name: '研发部' }) as HTMLInputElement).checked).toBe(true);

    // 点击子节点「前端组」
    fireEvent.click(screen.getByRole('checkbox', { name: '前端组' }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0].deptIds).toEqual(['d1', 'd11']);
  });

  it('组织已勾选时回填勾选态正确', () => {
    render(
      <PermissionTabs
        orgs={orgs}
        roles={roles}
        value={{ orgIds: ['2'], deptIds: [], roleIds: [] }}
        onChange={vi.fn()}
      />,
    );
    expect((screen.getByRole('checkbox', { name: '组织二' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: '组织一' }) as HTMLInputElement).checked).toBe(false);
  });

  it('部门树半选态：选中子节点时父节点 indeterminate（三态）', async () => {
    const roots = [dept('d1', '研发部', [dept('d11', '前端组')])];
    vi.mocked(fetchDeptTree).mockResolvedValueOnce(roots).mockResolvedValue([]);

    render(
      <PermissionTabs
        orgs={orgs}
        roles={roles}
        value={{ orgIds: [], deptIds: ['d11'], roleIds: [] }}
        onChange={vi.fn()}
      />,
    );
    await flushDeptLoad();

    fireEvent.mouseDown(screen.getByRole('tab', { name: '部门' }));
    fireEvent.click(await screen.findByRole('button', { name: '展开' }));

    const parent = (await screen.findByRole('checkbox', { name: '研发部' })) as HTMLInputElement;
    expect(parent.indeterminate).toBe(true);
    expect(parent.checked).toBe(false);
  });

  it('Tabs 三个 TAB 均可切换，且 checkbox 不被 disabled', () => {
    render(<PermissionTabs orgs={orgs} roles={roles} value={emptyValue} onChange={vi.fn()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
    for (const cb of checkboxes) {
      expect((cb as HTMLInputElement).disabled).toBe(false);
    }
  });
});
