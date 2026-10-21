/**
 * 表发现导入向导：最后一步点「完成」必须关闭弹窗。
 *
 * <p>回归：此前 handleNext 在 STEPS[3] 直接 return，按钮文案是「完成」却无关闭动作。
 */
// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TableImportWizard } from './TableImportWizard';
import { useModelingStore } from '../../store/modeling-store';
import * as discoveryApi from '../../api/iqd-discovery';

vi.mock('../../api/iqd-discovery', () => ({
  listSchemas: vi.fn().mockResolvedValue([]),
  listTables: vi.fn().mockResolvedValue({ tables: [], total: 0, page: 1, size: 20 }),
  listColumns: vi.fn().mockResolvedValue([]),
  importTables: vi.fn(),
  isDiscoveryUnavailable: () => false,
  isDiscoveryValidation: () => false,
}));

/** 轻量替身：暴露 finish 按钮，直接调 onNext（不测 Dialog 壳）。 */
vi.mock('./WizardShell', () => ({
  WizardShell: ({
    onNext,
    finish,
    children,
  }: {
    onNext: () => void;
    finish?: boolean;
    children: ReactNode;
  }) => (
    <div>
      {children}
      <button type="button" onClick={onNext}>
        {finish ? '完成' : '下一步'}
      </button>
    </div>
  ),
}));

describe('TableImportWizard 完成关闭', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(discoveryApi.listSchemas).mockResolvedValue([]);
  });

  it('最后一步点「完成」→ onOpenChange(false)', async () => {
    const onOpenChange = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <TableImportWizard open connectionId={1} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    // open=true 的 effect 会把步骤重置到第一步；再拨到最后一步并触发重渲染
    await act(async () => {
      useModelingStore.setState({
        wizardStep: 'import:confirm',
        wizardHistory: ['import:schema', 'import:tables', 'import:columns', 'import:confirm'],
      });
    });

    const finish = await screen.findByRole('button', { name: '完成' });
    fireEvent.click(finish);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
