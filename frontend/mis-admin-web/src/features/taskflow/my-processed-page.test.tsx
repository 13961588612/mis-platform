// @vitest-environment jsdom
/**
 * TaskMyProcessedPage 单测（我审批的）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskMyProcessedPage } from './my-processed-page';
import * as tasksApi from '@/lib/api/tasks';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/lib/api/tasks', () => ({
  fetchHandledTasks: vi.fn(),
}));

const approved = {
  id: '6001',
  tenantId: '1',
  taskType: 'PURCHASE_APPROVAL',
  bizType: 'PURCHASE_ORDER',
  bizRefId: 'PO-900',
  bizTitle: '采购审批 - 已通过的',
  targetEntity: null,
  assigneeId: '700001',
  assigneeName: '测试员',
  status: 'APPROVED',
  priority: 2,
  dueDate: null,
  metadata: '{"wfInstanceId":123}',
  result: null,
  read: true,
  completedAt: '2026-10-08T12:00:00',
  createdAt: '2026-10-08T10:00:00',
};

const rejected = { ...approved, id: '6002', bizTitle: '采购审批 - 已驳回的', status: 'REJECTED' };

describe('TaskMyProcessedPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
        id: '700001', employeeId: 'E1', username: 'tester', realName: '测试员',
        avatarUrl: null, deptId: null, deptName: null, roles: [], mustChangePassword: false,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染已通过/已驳回历史', async () => {
    vi.mocked(tasksApi.fetchHandledTasks).mockResolvedValue({
      page: 1, size: 20, total: 2, list: [approved, rejected],
    });
    render(
      <MemoryRouter>
        <TaskMyProcessedPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('采购审批 - 已通过的')).toBeTruthy();
    expect(screen.getByText('已通过')).toBeTruthy();
    expect(screen.getByText('已驳回')).toBeTruthy();
  });

  it('无记录展示空态', async () => {
    vi.mocked(tasksApi.fetchHandledTasks).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    render(
      <MemoryRouter>
        <TaskMyProcessedPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('暂无审批记录')).toBeTruthy();
  });
});
