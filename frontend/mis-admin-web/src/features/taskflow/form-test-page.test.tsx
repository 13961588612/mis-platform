// @vitest-environment jsdom
/**
 * 测试表单列表：表格展示表单字段 + 流程审批列，而不是门户待办卡片。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FormTestPage } from './form-test-page';
import * as workflowApi from '@/lib/api/workflow';
import * as formDefApi from '@/lib/api/form-definition';
import { useAuthStore } from '@/stores/auth-store';
import { __resetRegistryForTest, registerForms } from '@/features/biz/forms/registry';
import { __setFormLoadersForTest } from '@/features/biz/forms/forms/form-loaders';
import type { FormRegistryEntry } from '@/features/biz/forms/types';

vi.mock('@/lib/api/workflow', () => ({
  fetchMyProcesses: vi.fn(),
  fetchDefinitions: vi.fn(),
  fetchDefinition: vi.fn(),
  fetchProcessDetail: vi.fn(),
}));

vi.mock('@/lib/api/form-definition', () => ({
  fetchEnabledFormDefinitions: vi.fn(),
}));

vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: () => null,
}));

const purEntry: FormRegistryEntry = {
  formCode: 'PUR_FORM',
  name: '采购申请',
  component: (() => null) as FormRegistryEntry['component'],
  fields: [
    { key: 'orderNo', label: '采购单号' },
    { key: 'amount', label: '申请金额', type: 'number', unit: '元' },
  ],
};

describe('FormTestPage 列表表格', () => {
  beforeEach(() => {
    __resetRegistryForTest();
    __setFormLoadersForTest({
      PUR_FORM: async () => [purEntry],
    });
    registerForms([purEntry]);
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
    vi.mocked(formDefApi.fetchEnabledFormDefinitions).mockResolvedValue([
      {
        id: '1',
        tenantId: '1',
        code: 'PUR_FORM',
        name: '采购申请',
        status: 'ENABLED',
        categoryId: null,
        description: null,
        sortOrder: 1,
        config: '{}',
        createdAt: '2026-10-01T00:00:00',
        updatedAt: '2026-10-01T00:00:00',
      },
    ] as never);
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [],
    } as never);
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [
        {
          id: '128',
          definitionCode: 'PURCHASE_APPROVAL_DEMO',
          startedFormCode: 'PUR_FORM',
          businessType: 'PUR_FORM',
          businessId: 'TEST-1',
          status: 'RUNNING',
          initiatorId: '700001',
          initiatorName: '测试员',
          initiatorOrgName: '江苏华地',
          currentNodeCode: 'approve',
          currentNodeName: null,
          progress: '50%',
          postProcessStatus: 'WAITING',
          postRetryCount: 0,
          createdAt: '2026-10-13T08:38:00',
          completedAt: null,
          appCode: null,
          title: '防火墙采购',
          formData: '{"orderNo":"PO-9","amount":128000}',
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('以表格展示表单字段与流程审批列', async () => {
    render(
      <MemoryRouter>
        <FormTestPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('form-process-table')).toBeTruthy();
    expect(await screen.findByText('采购单号')).toBeTruthy();
    expect(screen.getByText('申请金额')).toBeTruthy();
    expect(screen.getByText('流程代码')).toBeTruthy();
    expect(screen.getByText('表单代码')).toBeTruthy();
    expect(screen.getByText('PURCHASE_APPROVAL_DEMO')).toBeTruthy();
    expect(screen.getAllByText('PUR_FORM').length).toBeGreaterThan(0);
    expect(screen.getByText('发起人')).toBeTruthy();
    expect(screen.getByText('发起时间')).toBeTruthy();
    expect(screen.getByText('审批状态')).toBeTruthy();
    expect(screen.getByText('当前审批节点')).toBeTruthy();
    expect(screen.getByText('结束审批时间')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('PO-9')).toBeTruthy());
    expect(screen.getByText('128,000 元')).toBeTruthy();
    expect(screen.getByText('测试员（江苏华地）')).toBeTruthy();
    expect(screen.getByText('2026-10-13 08:38')).toBeTruthy();
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0);
    expect(screen.getByText('approve')).toBeTruthy();
    expect(screen.getByText('查看进度')).toBeTruthy();
    expect(workflowApi.fetchMyProcesses).toHaveBeenCalledWith(
      '1',
      '700001',
      undefined,
      1,
      20,
      null,
      null,
      null,
      null,
      null,
      true,
    );
  });
});
