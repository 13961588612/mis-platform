// @vitest-environment jsdom
/**
 * TaskMySentPage 单测（P5）：渲染流程实例列表与状态徽标。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskMySentPage } from './my-sent-page';
import * as workflowApi from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/lib/api/workflow', () => ({
  fetchMyProcesses: vi.fn(),
}));

const runningInstance = {
  id: '128',
  definitionCode: 'PURCHASE_APPROVAL',
  startedFormCode: 'PUR_FORM',
  businessType: 'PURCHASE_ORDER',
  businessId: 'PO-001',
  status: 'RUNNING',
  initiatorId: '700001',
  initiatorName: '测试员',
  currentNodeCode: 'finance',
  currentNodeName: null,
  progress: '50%',
  postProcessStatus: 'WAITING',
  postRetryCount: 0,
  createdAt: '2026-10-08T10:00:00',
  completedAt: null,
  appCode: null,
};

describe('TaskMySentPage', () => {
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

  it('渲染流程实例并展示进行中状态', async () => {
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({
      page: 1, size: 20, total: 1, list: [runningInstance],
    });
    render(
      <MemoryRouter>
        <TaskMySentPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('PURCHASE_ORDER / PO-001')).toBeTruthy();
    expect(screen.getByText('进行中')).toBeTruthy();
    expect(screen.getByText('表单 PUR_FORM')).toBeTruthy();
  });

  it('无数据展示空态', async () => {
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    render(
      <MemoryRouter>
        <TaskMySentPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('暂无发起的流程')).toBeTruthy();
  });
});