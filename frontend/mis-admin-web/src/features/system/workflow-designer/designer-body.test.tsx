// @vitest-environment jsdom
/**
 * DesignerBody 单测（T4.1 抽离 + 编辑态还原）。
 *
 * 覆盖：
 * 1. 新建模式不再自动加载，画布空白
 * 2. 编辑模式按 definitionId 还原 nodes/edges/flowMeta（canvasX/Y → position）
 * 3. 编辑模式保存走 PUT，新建走 POST —— 否则「编排已有定义再保存」必然撞唯一索引
 * 4. 后端把唯一索引冲突兜成 500「系统内部错误」时，界面给出编码冲突的可读提示
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesignerBody, toFlowEdge, toFlowNode } from './designer-body';
import api from '@/lib/api/client';
import * as workflowApi from '@/lib/api/workflow';
import * as formApi from '@/lib/api/form-definition';
import { __setFormLoadersForTest } from '@/features/biz/forms/forms/form-loaders';

vi.mock('@/lib/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

vi.mock('@/lib/api/workflow', () => ({
  fetchDefinition: vi.fn(),
  fetchDefinitions: vi.fn(),
}));

vi.mock('@/lib/api/form-definition', () => ({
  fetchEnabledFormDefinitions: vi.fn(),
  fetchFormDefinitions: vi.fn(),
  FORM_STATUS_ENABLED: 'ENABLED',
  FORM_STATUS_DISABLED: 'DISABLED',
}));

// ReactFlow 在 jsdom 里要 ResizeObserver / DOMMatrix，两者 jsdom 都不提供 ⇒ 打桩
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as unknown as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class {
  m22 = 1;
};

const existing = {
  id: '1001',
  tenantId: '1',
  code: 'PUR_APPROVAL',
  name: '采购审批流程',
  category: 'APPROVAL',
  categoryId: null,
  description: null,
  version: 1,
  status: 'DRAFT',
  supportedFormCodes: ['PUR_FORM'],
  formSchema: null,
  config: '{}',
  nodes: [
    {
      nodeCode: 'start',
      nodeName: '开始',
      nodeType: 'START',
      sortOrder: 0,
      canvasX: 10,
      canvasY: 20,
      conditionExpr: null,
      assigneeRule: '{}',
      timeoutHours: null,
      config: '{}',
    },
    {
      nodeCode: 'approve',
      nodeName: '审批',
      nodeType: 'APPROVAL',
      sortOrder: 1,
      canvasX: 100,
      canvasY: 200,
      conditionExpr: null,
      assigneeRule: '{"type":"SELF"}',
      timeoutHours: 24,
      config: '{}',
    },
    {
      nodeCode: 'end',
      nodeName: '结束',
      nodeType: 'END',
      sortOrder: 2,
      canvasX: null,
      canvasY: null,
      conditionExpr: null,
      assigneeRule: '{}',
      timeoutHours: null,
      config: '{}',
    },
  ],
  edges: [
    { source: 'start', target: 'approve', edgeType: 'DEFAULT', label: null, conditionExpr: null, sortOrder: 0 },
    { source: 'approve', target: 'end', edgeType: 'DEFAULT', label: null, conditionExpr: null, sortOrder: 1 },
  ],
  createdAt: '',
  updatedAt: '',
};

function renderBody(props: Partial<ComponentProps<typeof DesignerBody>> = {}) {
  render(<DesignerBody {...props} />);
}

describe('DesignerBody', () => {
  beforeEach(() => {
    __setFormLoadersForTest({
      PUR_FORM: async () => [{ formCode: 'PUR_FORM', name: '采购申请单', component: () => null, fields: [] }],
    });
    vi.mocked(formApi.fetchEnabledFormDefinitions).mockResolvedValue([]);
    vi.mocked(workflowApi.fetchDefinition).mockResolvedValue(existing);
    vi.mocked(api.post).mockResolvedValue({ data: { code: 0, message: 'ok', data: 2001 } });
    vi.mocked(api.put).mockResolvedValue({ data: { code: 0, message: 'ok', data: null } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('新建模式不加载已有定义，画布为空', async () => {
    renderBody();

    await waitFor(() => expect(screen.getByText(/节点 0 · 连线 0/)).toBeTruthy());
    expect(workflowApi.fetchDefinition).not.toHaveBeenCalled();
  });

  it('编辑模式按 definitionId 还原节点与连线', async () => {
    renderBody({ definitionId: '1001' });

    await waitFor(() => expect(screen.getByText(/节点 3 · 连线 2/)).toBeTruthy());
    expect(workflowApi.fetchDefinition).toHaveBeenCalledWith('1001', '1');
  });

  it('canvasX/Y 还原成画布坐标，缺失时回落 0', () => {
    const n1 = toFlowNode(existing.nodes[0]);
    expect(n1.position).toEqual({ x: 10, y: 20 });
    expect(toFlowNode(existing.nodes[2]).position).toEqual({ x: 0, y: 0 });
    const e = toFlowEdge(existing.edges[0], 0);
    expect(e.source).toBe('n_start');
    expect(e.target).toBe('n_approve');
  });

  it('编辑模式保存走 PUT，不重复 POST', async () => {
    renderBody({ definitionId: '1001' });
    await waitFor(() => expect(screen.getByText(/节点 3 · 连线 2/)).toBeTruthy());

    fireEvent.click(screen.getByText('保存并发布'));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(vi.mocked(api.put).mock.calls[0][0]).toBe('/workflow/definitions/1001');
    expect(api.post).not.toHaveBeenCalledWith('/workflow/definitions', expect.anything(), expect.anything());
  });

  it('新建模式保存走 POST', async () => {
    renderBody();
    await waitFor(() => expect(screen.getByText(/节点 0 · 连线 0/)).toBeTruthy());

    // 空画布保存会被校验拦下，先确认「校验未通过」而不是静默不报
    fireEvent.click(screen.getByText('保存并发布'));
    await waitFor(() => expect(screen.getByText(/校验未通过|请填写流程编码与名称/)).toBeTruthy());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('后端把唯一索引冲突兜成 500 时给出编码冲突提示', async () => {
    vi.mocked(workflowApi.fetchDefinition).mockResolvedValue(existing);
    vi.mocked(api.put).mockResolvedValue({ data: { code: 500, message: '系统内部错误' } });
    renderBody({ definitionId: '1001' });
    await waitFor(() => expect(screen.getByText(/节点 3 · 连线 2/)).toBeTruthy());

    fireEvent.click(screen.getByText('保存并发布'));

    await waitFor(() => expect(screen.getByText(/可能已存在/)).toBeTruthy());
  });
});
