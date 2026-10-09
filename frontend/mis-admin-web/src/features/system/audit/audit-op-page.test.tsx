// @vitest-environment jsdom
/**
 * AuditOpPage 单测（P4）：
 * 1. 渲染审计列表与统计
 * 2. 点击行打开详情并展示变更对比
 * 3. diff JSON 解析容错
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuditOpPage } from './audit-op-page';
import * as auditApi from '@/lib/api/audit-ops';

vi.mock('@/lib/api/audit-ops', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/audit-ops')>();
  return {
    ...actual,
    fetchAuditOps: vi.fn(),
    fetchAuditOpDetail: vi.fn(),
    fetchAuditStats: vi.fn(),
  };
});

const sampleOp = {
  id: '9001',
  userId: '1',
  username: '张三',
  module: '采购管理',
  operationType: 'UPDATE',
  businessType: 'PURCHASE_ORDER',
  businessId: 'PO-001',
  description: '更新了采购单 PO-001',
  resultStatus: 'SUCCESS',
  durationMs: 45,
  operTime: '2026-10-08T10:30:15',
};

describe('AuditOpPage', () => {
  beforeEach(() => {
    vi.mocked(auditApi.fetchAuditStats).mockResolvedValue({ total: 128, failed: 3 });
    vi.mocked(auditApi.fetchAuditOps).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [sampleOp],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染审计列表与统计', async () => {
    render(
      <MemoryRouter>
        <AuditOpPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('更新了采购单 PO-001')).toBeTruthy();
    expect(screen.getByText('采购管理')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('128')).toBeTruthy());
  });

  it('点击行打开详情并展示字节变更对比', async () => {
    vi.mocked(auditApi.fetchAuditOpDetail).mockResolvedValue({
      ...sampleOp,
      beforeData: '{"amount":50000}',
      afterData: '{"amount":65000}',
      diffSummary: '[{"field":"amount","old":"50000","new":"65000"}]',
      traceId: null,
      errorMsg: null,
      extraContext: '{}',
    });
    render(
      <MemoryRouter>
        <AuditOpPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText('更新了采购单 PO-001'));
    expect(await screen.findByText('变更对比')).toBeTruthy();
    expect(await screen.findByText('amount')).toBeTruthy();
    expect(screen.getByText('50000')).toBeTruthy();
    expect(screen.getByText('65000')).toBeTruthy();
  });

  it('parseDiff 容错非法 JSON', () => {
    expect(auditApi.parseDiff('not-json')).toEqual([]);
    expect(auditApi.parseDiff(null)).toEqual([]);
    expect(auditApi.parseDiff('[{"field":"a","old":"1","new":"2"}]')).toHaveLength(1);
  });
});