// @vitest-environment jsdom
/**
 * ProcessShell 单测（P7 + P0-6）：
 * 1. 渲染流程进度、只读业务数据与审批历史
 * 2. 处理人本人可见审批栏（同意/驳回）
 * 3. 非处理人（或流程已结束）不显示审批栏
 * 4. P0-6：面包屑首级取跳转来源（state.from），直接输 URL 时回落 /task/pending
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProcessShell } from './process-shell';
import * as workflowApi from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/lib/api/workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/workflow')>();
  return { ...actual, fetchProcessDetail: vi.fn() };
});

const baseDetail = {
  instance: {
    id: '128',
    definitionCode: 'PURCHASE_APPROVAL',
    startedFormCode: 'PUR_FORM',
    businessType: 'PURCHASE_ORDER',
    businessId: 'PO-001',
    status: 'RUNNING',
    initiatorId: '100',
    initiatorName: '发起人',
    currentNodeCode: 'approve',
    currentNodeName: null,
    progress: '50%',
    postProcessStatus: 'WAITING',
    postRetryCount: 0,
    createdAt: '2026-10-08T10:00:00',
    completedAt: null,
  },
  tasks: [
    {
      id: '501',
      instanceId: '128',
      nodeCode: 'approve',
      nodeName: '主管审批',
      taskType: 'APPROVE',
      sysTaskId: '9001',
      assigneeId: '700001',
      assigneeName: '主管',
      status: 'PENDING',
      dueDate: null,
      createdAt: '2026-10-08T10:00:00',
      completedAt: null,
    },
  ],
  history: [
    {
      id: '1',
      nodeCode: 'start',
      operatorId: '100',
      operatorName: '发起人',
      operation: 'SUBMIT',
      fromNode: null,
      toNode: 'start',
      comment: null,
      createdAt: '2026-10-08T10:00:00',
    },
  ],
};

function setUser(id: string) {
  useAuthStore.setState({
    user: {
      id, employeeId: 'E1', username: 'u', realName: 'u', avatarUrl: null,
      deptId: null, deptName: null, roles: [], mustChangePassword: false,
    },
  });
}

describe('ProcessShell', () => {
  beforeEach(() => {
    vi.mocked(workflowApi.fetchProcessDetail).mockResolvedValue(baseDetail);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染进度与只读业务数据', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    expect((await screen.findAllByText('PO-001')).length).toBeGreaterThan(0);
    expect(screen.getByText('主管审批')).toBeTruthy();
    expect(screen.getByText('业务数据（只读）')).toBeTruthy();
    expect(screen.getByText('PURCHASE_ORDER')).toBeTruthy();
  });

  it('处理人本人显示审批栏', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('同意')).toBeTruthy();
    expect(screen.getByText('驳回')).toBeTruthy();
  });

  it('非处理人不显示审批栏', async () => {
    setUser('999999');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('当前节点由他人处理')).toBeTruthy();
    expect(screen.queryByText('同意')).toBeNull();
  });

  it('P0-6：直接输 URL（无 state）时回落「工作台」且不报错', async () => {
    setUser('700001');
    render(
      <MemoryRouter initialEntries={['/task/process/128']}>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('工作台')).toBeTruthy());
    expect(screen.getByText('流程详情')).toBeTruthy();
  });

  it('P0-6：面包屑首级取 state.from / fromLabel', async () => {
    setUser('700001');
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/task/process/128', state: { from: '/task/my-sent', fromLabel: '我发起的' } },
        ]}
      >
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('我发起的')).toBeTruthy();
    expect(screen.queryByText('工作台')).toBeNull();
  });

  it('P0-6：非法 state（from 非绝对路径）也回落，不抛错', async () => {
    setUser('700001');
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/task/process/128', state: { from: 'evil', fromLabel: 'x' } }]}
      >
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('工作台')).toBeTruthy();
  });
});