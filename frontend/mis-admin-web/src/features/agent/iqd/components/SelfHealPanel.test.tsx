// @vitest-environment jsdom
/**
 * SelfHealPanel.test.tsx — 运维自愈操作区（T04/T05）前端单元测试。
 *
 * 覆盖：
 * 1. gate：SYNCING / 构建进行中（build_status=running）时禁用强制重建按钮（Q2）。
 * 2. 二次确认 Dialog：未确认不发起请求；确认后发起 selfHealForceRebuild(connectionId)。
 * 3. 失败横幅：build_status=failed 时渲染人可读 build_error（复用 STALE_DRIFT 样式，REQ-7）。
 * 4. 5000ms 轮询：复用 CatalogSyncStatusBar 同源通道，每 5000ms 拉取一次同步状态（Q3）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SelfHealPanel from './SelfHealPanel';
import * as iqdApi from '@/lib/api/iqd';

vi.mock('@/lib/api/iqd', () => ({
  getIqdCatalogSyncStatus: vi.fn(),
  selfHealForceRebuild: vi.fn(),
  selfHealReindex: vi.fn(),
  selfHealValidate: vi.fn(),
}));

const m = vi.mocked(iqdApi);

beforeEach(() => {
  m.getIqdCatalogSyncStatus.mockResolvedValue({ edit_status: 'SYNCED', build_status: 'success' });
  m.selfHealForceRebuild.mockResolvedValue({ build_status: 'success' });
  m.selfHealReindex.mockResolvedValue({ build_status: 'success' });
  m.selfHealValidate.mockResolvedValue({ build_status: 'success' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('SelfHealPanel gate（Q2）', () => {
  it('SYNCING 时禁用强制重建按钮', async () => {
    m.getIqdCatalogSyncStatus.mockResolvedValue({ edit_status: 'SYNCING', build_status: 'success' });
    render(<SelfHealPanel connectionId={1} />);
    const btn = await screen.findByRole('button', { name: /强制重建/ });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
  });

  it('构建进行中（build_status=running）时禁用强制重建按钮', async () => {
    m.getIqdCatalogSyncStatus.mockResolvedValue({ edit_status: 'SYNCED', build_status: 'running' });
    render(<SelfHealPanel connectionId={1} />);
    const btn = await screen.findByRole('button', { name: /强制重建/ });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
  });

  it('SYNCED 时三按钮均可点', async () => {
    m.getIqdCatalogSyncStatus.mockResolvedValue({ edit_status: 'SYNCED', build_status: 'success' });
    render(<SelfHealPanel connectionId={1} />);
    const force = await screen.findByRole('button', { name: /强制重建/ });
    const reindex = await screen.findByRole('button', { name: /重新索引/ });
    const validate = await screen.findByRole('button', { name: /模型校验/ });
    await waitFor(() => {
      expect((force as HTMLButtonElement).disabled).toBe(false);
      expect((reindex as HTMLButtonElement).disabled).toBe(false);
      expect((validate as HTMLButtonElement).disabled).toBe(false);
    });
  });
});

describe('SelfHealPanel 二次确认（Q2）', () => {
  it('二次确认未确认不发起强制重建请求', async () => {
    render(<SelfHealPanel connectionId={1} />);
    const force = await screen.findByRole('button', { name: /强制重建/ });
    await waitFor(() => expect((force as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(force);
    const cancel = await screen.findByRole('button', { name: /取消/ });
    fireEvent.click(cancel);

    expect(m.selfHealForceRebuild).not.toHaveBeenCalled();
  });

  it('二次确认后发起 selfHealForceRebuild(connectionId)', async () => {
    render(<SelfHealPanel connectionId={1} />);
    const force = await screen.findByRole('button', { name: /强制重建/ });
    await waitFor(() => expect((force as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(force);
    const confirm = await screen.findByRole('button', { name: /确认重建/ });
    fireEvent.click(confirm);

    await waitFor(() => expect(m.selfHealForceRebuild).toHaveBeenCalledTimes(1));
    expect(m.selfHealForceRebuild).toHaveBeenCalledWith(1);
  });
});

describe('SelfHealPanel 失败横幅（REQ-7）', () => {
  it('build_status=failed 时渲染人可读 build_error 横幅', async () => {
    m.selfHealForceRebuild.mockResolvedValue({ build_status: 'failed', build_error: 'mdl hash 不匹配' });
    render(<SelfHealPanel connectionId={1} />);
    const force = await screen.findByRole('button', { name: /强制重建/ });
    await waitFor(() => expect((force as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(force);
    const confirm = await screen.findByRole('button', { name: /确认重建/ });
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getByText('mdl hash 不匹配')).toBeTruthy());
  });
});

describe('SelfHealPanel 模型校验警告', () => {
  it('success + warnings 时自动打开详情并逐条展示', async () => {
    m.selfHealValidate.mockResolvedValue({
      build_status: 'success',
      warnings: ['缺主键', '缺时间维', '未设 description'],
    });
    render(<SelfHealPanel connectionId={1} />);
    const validate = await screen.findByRole('button', { name: /模型校验/ });
    await waitFor(() => expect((validate as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(validate);

    await waitFor(() => expect(screen.getByText('模型校验警告')).toBeTruthy());
    expect(screen.getByText('缺主键')).toBeTruthy();
    expect(screen.getByText('缺时间维')).toBeTruthy();
    expect(screen.getByText('未设 description')).toBeTruthy();
  });
});

describe('SelfHealPanel 5000ms 轮询（Q3）', () => {
  it('复用 5000ms 轮询通道拉取同步状态', async () => {
    vi.useFakeTimers();
    const getStatus = vi.mocked(iqdApi).getIqdCatalogSyncStatus.mockResolvedValue({
      edit_status: 'SYNCED',
      build_status: 'success',
    });
    try {
      render(<SelfHealPanel connectionId={1} />);
      // 挂载时 load() 已触发一次；advance 5000ms 后间隔再次触发
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(getStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
