// @vitest-environment jsdom
/**
 * TaskListPage 单测（P3）：
 * 1. 渲染待办列表与统计角标
 * 2. 点击「同意」调用 handleTask 并刷新
 * 3. 无数据显示空态
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskListPage } from './task-list-page';
import * as tasksApi from '@/lib/api/tasks';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/lib/api/tasks', () => ({
  fetchMyTasks: vi.fn(),
  fetchTaskStats: vi.fn(),
  handleTask: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const sampleTask = {
  id: '5001',
  tenantId: '1',
  taskType: 'PURCHASE_APPROVAL',
  bizType: 'PURCHASE_ORDER',
  bizRefId: 'PO-001',
  bizTitle: '采购审批 - 服务器采购',
  targetEntity: 'PURCHASE_ORDER',
  assigneeId: '700001',
  assigneeName: '测试员',
  status: 'PENDING',
  priority: 4,
  dueDate: null,
  metadata: '{}',
  result: null,
  read: false,
  completedAt: null,
  createdAt: '2026-10-08T10:00:00',
};

describe('TaskListPage', () => {
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
    vi.mocked(tasksApi.fetchTaskStats).mockResolvedValue({ pending: 1, urgent: 1, overdue: 0 });
    vi.mocked(tasksApi.handleTask).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染待办列表与统计角标', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [sampleTask],
    });
    render(
      <MemoryRouter>
        <TaskListPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('采购审批 - 服务器采购')).toBeTruthy();
    expect(screen.getByText('紧急')).toBeTruthy();
  });

  it('点击同意调用 handleTask(APPROVE)', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [sampleTask],
    });
    render(
      <MemoryRouter>
        <TaskListPage />
      </MemoryRouter>,
    );

    const btn = await screen.findByText('同意');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(tasksApi.handleTask).toHaveBeenCalledWith('5001', '1', '700001', 'APPROVE', '同意'),
    );
  });

  it('无数据展示空态', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    render(
      <MemoryRouter>
        <TaskListPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('暂无待办')).toBeTruthy();
  });

  it('P0-7：批完自动续下一条 —— 处理后剩一条时列表就地推进且不出现完成态', async () => {
    const two = [sampleTask, { ...sampleTask, id: '5002', bizTitle: '采购审批 - 网络设备' }];
    // 服务端语义：处理掉 5001 后再拉就只剩 5002
    vi.mocked(tasksApi.fetchMyTasks)
      .mockResolvedValueOnce({ page: 1, size: 20, total: 2, list: two })
      .mockResolvedValue({ page: 1, size: 20, total: 1, list: [two[1]] });
    render(
      <MemoryRouter>
        <TaskListPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('采购审批 - 服务器采购')).toBeTruthy();
    expect(screen.getByText('采购审批 - 网络设备')).toBeTruthy();

    fireEvent.click(screen.getAllByText('同意')[0]);

    await waitFor(() => {
      expect(screen.queryByText('采购审批 - 服务器采购')).toBeNull();
    });
    // 下一条仍在队列里，没有进入完成态
    expect(screen.getByText('采购审批 - 网络设备')).toBeTruthy();
    expect(screen.queryByText(/本页待办已清空/)).toBeNull();
  });

  it('P0-7：队列耗尽展示完成态并给出返回工作台 / 查看已办出口', async () => {
    // 服务端语义：处理掉最后一条后再拉就空了
    vi.mocked(tasksApi.fetchMyTasks)
      .mockResolvedValueOnce({ page: 1, size: 20, total: 1, list: [sampleTask] })
      .mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    render(
      <MemoryRouter>
        <TaskListPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('同意'));

    expect(await screen.findByText(/本页待办已清空/)).toBeTruthy();
    expect(screen.getByText('返回工作台')).toBeTruthy();
    expect(screen.getByText('查看已办')).toBeTruthy();
  });
});