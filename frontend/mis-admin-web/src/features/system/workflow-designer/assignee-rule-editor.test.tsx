// @vitest-environment jsdom
/**
 * AssigneeRuleEditor：类型下拉 + 按钮弹窗选人，不再内联 Popover。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssigneeRuleEditor } from './assignee-rule-editor';
import * as usersApi from '@/lib/api/users';
import * as orgsApi from '@/lib/api/orgs';
import * as deptsApi from '@/lib/api/depts';
import * as postsApi from '@/lib/api/posts';

vi.mock('@/lib/api/users', () => ({
  pageUsers: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/lib/api/orgs', () => ({
  listOrgs: vi.fn(),
}));

vi.mock('@/lib/api/depts', () => ({
  fetchDeptTree: vi.fn(),
}));

vi.mock('@/lib/api/posts', () => ({
  listPosts: vi.fn(),
}));

describe('AssigneeRuleEditor', () => {
  beforeEach(() => {
    vi.mocked(usersApi.pageUsers).mockResolvedValue({
      page: 1,
      size: 50,
      total: 1,
      list: [
        {
          id: '700001',
          username: 'zhangsan',
          realName: '张三',
          employeeNo: null,
          employeeId: null,
          deptId: '2',
          deptName: '研发部',
          orgId: '1',
          orgName: '总部',
          email: null,
          phone: '138****0001',
          status: 1,
          isTenantAdmin: null,
          roles: [],
          postName: '研发经理',
          createdAt: null,
        },
      ],
    });
    vi.mocked(usersApi.getUser).mockResolvedValue({
      id: '700001',
      username: 'zhangsan',
      realName: '张三',
      employeeNo: null,
      employeeId: null,
      deptId: '2',
      deptName: '研发部',
      orgId: '1',
      orgName: '总部',
      email: null,
      phone: '138****0001',
      status: 1,
      isTenantAdmin: null,
      roles: [],
      postName: '研发经理',
      createdAt: null,
    });
    vi.mocked(orgsApi.listOrgs).mockResolvedValue([
      {
        id: '1',
        tenantId: '1',
        code: 'HQ',
        name: '总部',
        parentId: '0',
        sort: 0,
        status: 1,
        remark: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    vi.mocked(deptsApi.fetchDeptTree).mockResolvedValue([
      {
        id: '2',
        tenantId: '1',
        orgId: '1',
        parentId: '0',
        code: 'RD',
        name: '研发部',
        categoryId: null,
        ancestors: null,
        sort: 0,
        status: 1,
        isRoot: 1,
        leaderEmployeeId: null,
        linkedOrgId: null,
        linkedOrgName: null,
        children: [],
      },
    ]);
    vi.mocked(postsApi.listPosts).mockResolvedValue([
      {
        id: '3',
        tenantId: '1',
        deptId: '2',
        deptName: '研发部',
        postTypeId: '1',
        postTypeName: null,
        code: 'DEV_LEAD',
        name: '研发经理',
        sort: 0,
        status: 1,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('不渲染 JSON textarea；下拉不含指定人员/指定角色', () => {
    render(<AssigneeRuleEditor value='{"type":"SELF"}' onChange={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/FIXED/)).toBeNull();
    const select = screen.getByLabelText('审批人规则类型') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).not.toContain('指定人员');
    expect(labels).not.toContain('指定角色');
    expect(labels).toContain('指定人员列表');
  });

  it('旧 FIXED 规则提示已停用并可改选', () => {
    render(<AssigneeRuleEditor value='{"type":"FIXED","value":1}' onChange={vi.fn()} />);
    expect(screen.getByText(/指定人员 \/ 指定角色」已停用/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /选择人员/ })).toBeNull();
  });

  it('公司+部门+岗位：添加岗位到已选后回写数组', async () => {
    const onChange = vi.fn();
    render(<AssigneeRuleEditor value='{"type":"ORG_POST"}' onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /选择岗位范围/ }));
    await waitFor(() => expect(orgsApi.listOrgs).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('选择组织'), { target: { value: '1' } });
    await waitFor(() => expect(deptsApi.fetchDeptTree).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('org-post-dept-option'));
    await waitFor(() => expect(postsApi.listPosts).toHaveBeenCalled());
    expect(screen.getByText('可选岗位')).toBeTruthy();
    expect(screen.getByText('已选岗位')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /添加 研发经理/ }));
    expect(await screen.findByTestId('org-post-selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        '{"type":"ORG_POST","value":[{"orgId":1,"deptId":2,"postId":3}]}',
      ),
    );
  });

  it('USER_LIST 在普通审批节点展示任一人通过提示', () => {
    render(
      <AssigneeRuleEditor
        value='{"type":"USER_LIST","value":[1]}'
        onChange={vi.fn()}
        nodeKind="APPROVAL"
      />,
    );
    expect(screen.getByText(/任一人通过即推进流程/)).toBeTruthy();
  });

  it('指定人员列表：添加/删除按钮，右侧展示完整信息', async () => {
    const onChange = vi.fn();
    render(
      <AssigneeRuleEditor value='{"type":"USER_LIST","value":[]}' onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /选择人员/ }));
    await waitFor(() => expect(usersApi.pageUsers).toHaveBeenCalled());
    expect(screen.getByText('已选人员')).toBeTruthy();
    expect(await screen.findByText(/手机 138\*\*\*\*0001/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /添加 张三/ }));
    const selected = await screen.findByTestId('user-selected');
    expect(selected.textContent).toMatch(/张三/);
    expect(selected.textContent).toMatch(/手机 138\*\*\*\*0001/);
    expect(selected.textContent).toMatch(/公司 总部/);
    expect(selected.textContent).toMatch(/部门 研发部/);
    expect(selected.textContent).toMatch(/岗位 研发经理/);
    expect((screen.getByRole('button', { name: /已添加 张三/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: /删除 张三/ }));
    expect(screen.queryByTestId('user-selected')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /添加 张三/ }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('{"type":"USER_LIST","value":[700001]}'),
    );
  });

  it('公司+部门+岗位：部门树有展开/收起', async () => {
    vi.mocked(deptsApi.fetchDeptTree).mockResolvedValue([
      {
        id: '2',
        tenantId: '1',
        orgId: '1',
        parentId: '0',
        code: 'RD',
        name: '研发部',
        categoryId: null,
        ancestors: null,
        sort: 0,
        status: 1,
        isRoot: 1,
        leaderEmployeeId: null,
        linkedOrgId: null,
        linkedOrgName: null,
        children: [
          {
            id: '21',
            tenantId: '1',
            orgId: '1',
            parentId: '2',
            code: 'FE',
            name: '前端组',
            categoryId: null,
            ancestors: null,
            sort: 0,
            status: 1,
            isRoot: 0,
            leaderEmployeeId: null,
            linkedOrgId: null,
            linkedOrgName: null,
            children: [],
          },
        ],
      },
    ]);
    render(<AssigneeRuleEditor value='{"type":"ORG_POST"}' onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /选择岗位范围/ }));
    await waitFor(() => expect(deptsApi.fetchDeptTree).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '全部展开' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '全部收起' })).toBeTruthy();
    expect((await screen.findAllByText('启用')).length).toBeGreaterThan(0);
    expect(screen.getByText('前端组')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '全部收起' }));
    expect(screen.queryByText('前端组')).toBeNull();
  });
});
