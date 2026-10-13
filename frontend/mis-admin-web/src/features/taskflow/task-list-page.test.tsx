// @vitest-environment jsdom
/**
 * TaskListPage 单测（P3）：
 * 1. 渲染待办列表与统计角标
 * 2. 点击「同意」调用 handleTask 并刷新
 * 3. 无数据显示空态
 * 4. 整行可点（R-1）：已办态点行跳流程详情；行内按钮不冒泡到行
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
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

/** 记录跳转结果，断言整行点击是否真的进了流程详情。 */
function LocationProbe({ sink }: { sink: { current: Location | null } }) {
  const loc = useLocation();
  sink.current = loc;
  return null;
}

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
  appCode: null,
  initiatorName: null,
  initiatorOrgName: null,
};

/** 已办态：流程已结束，行内只剩状态徽标（曾因无 onClick 而完全点不动）。 */
const doneTask = {
  ...sampleTask,
  id: '5002',
  bizTitle: '采购审批 - 已通过的',
  status: 'APPROVED',
  metadata: '{"wfInstanceId":128}',
  completedAt: '2026-10-08T12:00:00',
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

  it('R-1 回归：已办态整行点击跳流程详情（修复前该行完全点不动）', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [doneTask],
    });
    const loc = { current: null as Location | null };
    render(
      <MemoryRouter>
        <LocationProbe sink={loc} />
        <TaskListPage />
      </MemoryRouter>,
    );

    // 已办态渲染中文状态徽标，不再是英文原始值 APPROVED
    expect(await screen.findByText('已通过')).toBeTruthy();

    fireEvent.click(screen.getByText('采购审批 - 已通过的'));

    await waitFor(() => {
      expect(loc.current?.pathname).toBe('/task/process/128');
    });
  });

  it('R-1：待办态点「同意」只触发 handle，不冒泡触发行跳转', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [sampleTask],
    });
    const loc = { current: null as Location | null };
    render(
      <MemoryRouter>
        <LocationProbe sink={loc} />
        <TaskListPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('同意'));

    await waitFor(() =>
      expect(tasksApi.handleTask).toHaveBeenCalledWith('5001', '1', '700001', 'APPROVE', '同意'),
    );
    // sampleTask 无 wfInstanceId，若按钮点击冒泡到行会跳去 /task/my-processed
    expect(loc.current?.pathname).not.toBe('/task/my-processed');
  });

  it('R-1：整行可键盘触发（Enter）', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [doneTask],
    });
    const loc = { current: null as Location | null };
    render(
      <MemoryRouter>
        <LocationProbe sink={loc} />
        <TaskListPage />
      </MemoryRouter>,
    );

    const row = (await screen.findByText('采购审批 - 已通过的')).closest('li');
    expect(row?.getAttribute('role')).toBe('button');
    expect(row?.getAttribute('tabindex')).toBe('0');

    fireEvent.keyDown(row as HTMLElement, { key: 'Enter' });

    await waitFor(() => {
      expect(loc.current?.pathname).toBe('/task/process/128');
    });
  });
});