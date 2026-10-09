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
});