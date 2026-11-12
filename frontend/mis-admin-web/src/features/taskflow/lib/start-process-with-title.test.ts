import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as workflowApi from '@/lib/api/workflow';
import { startProcessWithTitle } from './start-process-with-title';

vi.mock('@/lib/api/workflow', () => ({
  startProcess: vi.fn(),
}));

describe('startProcessWithTitle', () => {
  beforeEach(() => {
    vi.mocked(workflowApi.startProcess).mockReset();
  });

  it('未确认 → 一律 needConfirm（即便能解析标题）', async () => {
    const r = await startProcessWithTitle({
      tenantId: '1',
      definitionCode: 'F1',
      businessType: 'PURCHASE_ORDER',
      businessId: 'PO-1',
      startedFormCode: 'PUR_FORM',
      formConfig: '{"titleField":"orderNo"}',
      formDataObject: { orderNo: 'PO-X' },
    });
    expect(r).toEqual({ ok: false, needConfirm: true, suggestedTitle: 'PO-X' });
    expect(workflowApi.startProcess).not.toHaveBeenCalled();
  });

  it('确认后带 title/priority/dueDate → 调用 startProcess', async () => {
    vi.mocked(workflowApi.startProcess).mockResolvedValue('99');
    const r = await startProcessWithTitle({
      tenantId: '1',
      definitionCode: 'F1',
      businessType: 'PURCHASE_ORDER',
      businessId: 'PO-1',
      startedFormCode: 'PUR_FORM',
      formConfig: '{"titleField":"orderNo"}',
      formDataObject: { orderNo: 'PO-X' },
      confirmed: true,
      explicitTitle: '自定义标题',
      priority: 3,
      dueDate: '2026-10-13T18:00:00',
    });
    expect(r).toEqual({ ok: true, instanceId: '99' });
    expect(workflowApi.startProcess).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        title: '自定义标题',
        startedFormCode: 'PUR_FORM',
        priority: 3,
        dueDate: '2026-10-13T18:00:00',
      }),
    );
  });

  it('确认但标题为空 → 仍 needConfirm', async () => {
    const r = await startProcessWithTitle({
      tenantId: '1',
      definitionCode: 'F1',
      businessType: 'PURCHASE_ORDER',
      businessId: 'PO-1',
      startedFormCode: 'PUR_FORM',
      formConfig: '{}',
      formDataObject: {},
      confirmed: true,
      explicitTitle: '  ',
    });
    expect(r).toEqual({ ok: false, needConfirm: true, suggestedTitle: '' });
    expect(workflowApi.startProcess).not.toHaveBeenCalled();
  });
});
