// @vitest-environment jsdom
/**
 * iqd-mapping-page.test.tsx — 维度值映射页（/iqd/mapping）页面级验证。
 *
 * 覆盖：列表渲染、解析预览（resolved/dropped）、新增映射提交 payload（含 covers_subtree）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IqdMappingPage } from './iqd-mapping-page';
import * as iqdApi from '@/lib/api/iqd';
import { useModelingStore } from './store/modeling-store';

vi.mock('@/features/agent/iqd/api/iqd-modeling', () => ({
  listConnections: vi.fn(async () => [{ id: 900001, name: 'default', enabled: true, mcp_status: 'running' }]),
}));

vi.mock('@/lib/api/iqd', () => ({
  listIqdDimensions: vi.fn(async () => [
    { dimension_code: 'dept', dimension_name: '部门', enabled: true },
    { dimension_code: 'store', dimension_name: '门店', enabled: true },
  ]),
  listIqdDimensionValueMaps: vi.fn(async () => [
    { id: 1, connection_id: 900001, dimension_code: 'dept', mis_value: '1001', external_value: 'D001', effective: true, covers_subtree: true },
  ]),
  saveIqdDimensionValueMap: vi.fn(async () => ({ id: 2 })),
  deleteIqdDimensionValueMap: vi.fn(async () => undefined),
  resolveIqdDimensionValues: vi.fn(async () => ({
    resolved: ['D001', 'D002'],
    dropped: ['1009'],
    empty: false,
  })),
}));

const m = vi.mocked(iqdApi);

beforeEach(() => {
  useModelingStore.getState().setConnectionId('900001');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IqdMappingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('维度值映射页', () => {
  it('渲染已有映射列表', async () => {
    renderPage();
    expect(await screen.findByText('D001')).toBeTruthy();
    expect(await screen.findByText('1001')).toBeTruthy();
  });

  it('解析预览展示最终范围与丢弃值', async () => {
    renderPage();
    const input = await screen.findByPlaceholderText(/例如/);
    fireEvent.change(input, { target: { value: '1001 1009' } });
    fireEvent.click(screen.getByRole('button', { name: '解析' }));
    await waitFor(() => expect(m.resolveIqdDimensionValues).toHaveBeenCalled());
    expect(await screen.findByText('D002')).toBeTruthy();
    expect(await screen.findByText('1009')).toBeTruthy();
  });

  it('新增映射提交 covers_subtree', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '新增映射' }));
    const misInput = await screen.findByPlaceholderText('例如：1001');
    fireEvent.change(misInput, { target: { value: '1002' } });
    const extInput = await screen.findByPlaceholderText(/D001/);
    fireEvent.change(extInput, { target: { value: 'D002' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.saveIqdDimensionValueMap).toHaveBeenCalled());
    const body = m.saveIqdDimensionValueMap.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(body.connection_id).toBe(900001);
    expect(body.mis_value).toBe('1002');
    expect(body.external_value).toBe('D002');
    expect(body.covers_subtree).toBe(true);
  });
});
