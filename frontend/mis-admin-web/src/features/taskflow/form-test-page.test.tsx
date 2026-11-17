// @vitest-environment jsdom
/**
 * 测试表单：LOCAL 绑定已发布流程后方可新建；列表走 form-records。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FormTestPage } from './form-test-page';
import * as workflowApi from '@/lib/api/workflow';
import * as formDefApi from '@/lib/api/form-definition';
import * as formRecordApi from '@/lib/api/form-records';
import { useAuthStore } from '@/stores/auth-store';
import { __resetRegistryForTest, registerForms } from '@/features/biz/forms/registry';
import { __setFormLoadersForTest } from '@/features/biz/forms/forms/form-loaders';
import type { FormRegistryEntry } from '@/features/biz/forms/types';

vi.mock('@/lib/api/workflow', () => ({
  fetchDefinitions: vi.fn(),
  fetchDefinition: vi.fn(),
}));

vi.mock('@/lib/api/form-definition', () => ({
  fetchEnabledFormDefinitions: vi.fn(),
}));

vi.mock('@/lib/api/form-records', () => ({
  fetchFormRecords: vi.fn(),
  createFormRecord: vi.fn(),
  updateFormRecord: vi.fn(),
  startFormRecordProcess: vi.fn(),
}));

vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: () => null,
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const purEntry: FormRegistryEntry = {
  formCode: 'PUR_FORM',
  name: '采购申请',
  component: (() => null) as FormRegistryEntry['component'],
  fields: [
    { key: 'orderNo', label: '采购单号' },
    { key: 'amount', label: '申请金额', type: 'number', unit: '元' },
  ],
};

const activeDef = {
  id: '950001',
  tenantId: '1',
  code: 'PURCHASE_APPROVAL_DEMO',
  name: '采购审批（示例）',
  category: 'APPROVAL',
  categoryId: null,
  description: null,
  version: 1,
  status: 'ACTIVE',
  supportedFormCodes: [] as string[],
  formSchema: null,
  config: '{}',
  nodes: [],
  edges: [],
  createdAt: '2026-10-01T00:00:00',
  updatedAt: '2026-10-01T00:00:00',
};

describe('FormTestPage', () => {
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
      permissions: [],
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
        workflowBindingType: 'LOCAL',
        workflowDefinitionId: '950001',
        aiAgentId: 'mis-copilot',
        aiSkillId: 'form-assist',
        createdAt: '2026-10-01T00:00:00',
        updatedAt: '2026-10-01T00:00:00',
      },
    ]);
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 100,
      total: 1,
      list: [activeDef as never],
    });
    vi.mocked(workflowApi.fetchDefinition).mockResolvedValue(activeDef as never);
    vi.mocked(formRecordApi.fetchFormRecords).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [
        {
          id: '128',
          formCode: 'PUR_FORM',
          status: 'IN_PROCESS',
          storageTable: 'biz_form_pur_form',
          dataId: '9',
          currentInstanceId: 'inst-1',
          lastInstanceId: 'inst-1',
          title: '防火墙采购',
          values: { orderNo: 'PO-9', amount: 128000 },
          payloadSnapshot: null,
          createdBy: '700001',
          createdByName: '测试员',
          createdAt: '2026-10-13T08:38:00',
          updatedAt: '2026-10-13T08:38:00',
          canEdit: false,
          canStartProcess: false,
          canWithdraw: false,
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('以表格展示表单字段与单据状态', async () => {
    render(
      <MemoryRouter>
        <FormTestPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('form-process-table')).toBeTruthy();
    expect(await screen.findByText('采购单号')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('PO-9')).toBeTruthy());
    expect(screen.getByText('PUR_FORM')).toBeTruthy();
    expect(screen.getAllByText('审批中').length).toBeGreaterThan(0);
  });

  it('表单 LOCAL 绑定已发布流程时可打开新建单据', async () => {
    render(
      <MemoryRouter>
        <FormTestPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('form-process-table');
    fireEvent.click(screen.getByRole('button', { name: '新建单据' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('选择表单')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '辅助录入' })).toBeNull();
  });

  it('配了 Agent/Skill 且有执行权时显示辅助录入', async () => {
    useAuthStore.setState({ permissions: ['ai:skill:form-assist:run'] });
    render(
      <MemoryRouter>
        <FormTestPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('form-process-table');
    fireEvent.click(screen.getByRole('button', { name: '新建单据' }));
    expect(await screen.findByRole('button', { name: '辅助录入' })).toBeTruthy();
  });
});
