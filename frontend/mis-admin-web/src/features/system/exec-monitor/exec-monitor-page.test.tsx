// @vitest-environment jsdom
/**
 * ExecMonitorPage 单测（P6）：
 * 1. 渲染执行任务与状态
 * 2. 失败任务展示手动重试/强制归档并触发接口
 * 3. 无数据空态
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExecMonitorPage } from './exec-monitor-page';
import * as execApi from '@/lib/api/exec-monitor';

vi.mock('@/lib/api/exec-monitor', () => ({
  fetchExecTasks: vi.fn(),
  retryExecTask: vi.fn(),
  forceArchiveExecTask: vi.fn(),
}));

const failedTask = {
  id: '8001',
  sourceInstanceId: '128',
  actionType: 'FINALIZE_BIZ',
  bizType: 'PURCHASE_ORDER',
  bizRefId: 'PO-001',
  txStatus: 'FAILED',
  retryCount: 2,
  nextRetryAt: null,
  errorMsg: '模拟执行失败',
  createdAt: '2026-10-08T10:00:00',
  updatedAt: '2026-10-08T10:05:00',
};

describe('ExecMonitorPage', () => {
  beforeEach(() => {
    vi.mocked(execApi.retryExecTask).mockResolvedValue(undefined);
    vi.mocked(execApi.forceArchiveExecTask).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染执行任务与失败信息', async () => {
    vi.mocked(execApi.fetchExecTasks).mockResolvedValue({ page: 1, size: 20, total: 1, list: [failedTask] });
    render(
      <MemoryRouter>
        <ExecMonitorPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('FINALIZE_BIZ')).toBeTruthy();
    expect(screen.getByText('执行失败')).toBeTruthy();
    expect(screen.getByText('已重试 2 次')).toBeTruthy();
    expect(screen.getByText('模拟执行失败')).toBeTruthy();
  });

  it('失败任务点击手动重试触发接口', async () => {
    vi.mocked(execApi.fetchExecTasks).mockResolvedValue({ page: 1, size: 20, total: 1, list: [failedTask] });
    render(
      <MemoryRouter>
        <ExecMonitorPage />
      </MemoryRouter>,
    );
    const btn = await screen.findByText('手动重试');
    fireEvent.click(btn);
    await waitFor(() => expect(execApi.retryExecTask).toHaveBeenCalledWith('8001', '1'));
  });

  it('失败任务点击强制归档触发接口', async () => {
    vi.mocked(execApi.fetchExecTasks).mockResolvedValue({ page: 1, size: 20, total: 1, list: [failedTask] });
    render(
      <MemoryRouter>
        <ExecMonitorPage />
      </MemoryRouter>,
    );
    const btn = await screen.findByText('强制归档');
    fireEvent.click(btn);
    await waitFor(() => expect(execApi.forceArchiveExecTask).toHaveBeenCalledWith('8001', '1'));
  });

  it('无数据展示空态', async () => {
    vi.mocked(execApi.fetchExecTasks).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    render(
      <MemoryRouter>
        <ExecMonitorPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('暂无执行任务')).toBeTruthy();
  });
});