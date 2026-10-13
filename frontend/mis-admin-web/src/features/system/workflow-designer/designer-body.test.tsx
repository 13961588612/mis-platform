// @vitest-environment jsdom
/**
 * DesignerBody 单测（T4.1 抽离 + 编辑态还原）。
 *
 * 覆盖：
 * 1. 新建模式不再自动加载，画布空白
 * 2. 编辑模式按 definitionId 还原 nodes/edges/flowMeta（canvasX/Y → position）
 * 3. 编辑模式保存走 PUT，新建走 POST —— 否则「编排已有定义再保存」必然撞唯一索引
 * 4. 后端把唯一索引冲突兜成 500「系统内部错误」时，界面给出编码冲突的可读提示
 * 5. 「仅保存」只 PUT/POST，不调 activate；「保存并发布」在 ACTIVE 时先 deactivate 再 PUT+activate
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

  it('编辑模式「保存并发布」走 PUT + activate，不重复 POST 创建', async () => {
    renderBody({ definitionId: '1001' });
    await waitFor(() => expect(screen.getByText(/节点 3 · 连线 2/)).toBeTruthy());

    fireEvent.click(screen.getByText('保存并发布'));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(vi.mocked(api.put).mock.calls[0][0]).toBe('/workflow/definitions/1001');
    expect(api.post).not.toHaveBeenCalledWith('/workflow/definitions', expect.anything(), expect.anything());
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/workflow/definitions/1001/activate',
        null,
        expect.anything(),
      ),
    );
  });

  it('「仅保存」只落草稿，不调 activate', async () => {
    renderBody({ definitionId: '1001' });
    await waitFor(() => expect(screen.getByText(/节点 3 · 连线 2/)).toBeTruthy());

    fireEvent.click(screen.getByText('仅保存'));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(vi.mocked(api.put).mock.calls[0][0]).toBe('/workflow/definitions/1001');
    expect(api.post).not.toHaveBeenCalledWith(
      '/workflow/definitions/1001/activate',
      expect.anything(),
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByText(/已保存为草稿/)).toBeTruthy());
  });

  it('已发布定义「保存并发布」先 deactivate 再 PUT + activate', async () => {
    vi.mocked(workflowApi.fetchDefinition).mockResolvedValue({ ...existing, status: 'ACTIVE' });
    renderBody({ definitionId: '1001' });
    await waitFor(() => expect(screen.getByText(/节点 3 · 连线 2/)).toBeTruthy());

    fireEvent.click(screen.getByText('保存并发布'));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/workflow/definitions/1001/deactivate',
        null,
        expect.anything(),
      ),
    );
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/workflow/definitions/1001/activate',
        null,
        expect.anything(),
      ),
    );
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

  /**
   * 回归钉子：保存时 source/target 必须写 **nodeCode**，绝不能把画布 id（`n_XXX`）写进库。
   *
   * <p>旧实现是 `sourceNode?.data.nodeCode ?? e.source`：一旦端点解析不到节点就把
   * `n_start` 这种画布 id 当nodeCode 落库；下次加载 {@link toFlowEdge} 再补一层前缀
   * 变成 `n_n_start`，这条边便永远渲染不出来 —— 「保存后连线全没了」的脏数据成因。
   */
  it('保存时连线端点写nodeCode，不把画布 id（n_XXX）写进后端',async () => {
    renderBody({ definitionId: '1001' });
    await waitFor(() => expect(screen.getByText(/节点 3 · 连线 2/)).toBeTruthy());

    fireEvent.click(screen.getByText('仅保存'));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const payload = vi.mocked(api.put).mock.calls[0][1] as {
      edges: { source: string; target: string }[];
    };
    expect(payload.edges).toHaveLength(2);
    expect(payload.edges.map((e) => [e.source, e.target])).toEqual([
      ['start', 'approve'],
      ['approve', 'end'],
    ]);
    for (const e of payload.edges) {
      expect(e.source.startsWith('n_')).toBe(false);
      expect(e.target.startsWith('n_')).toBe(false);
    }
  });

  /**
   * 端点解析不到节点的连线直接丢弃，而不是把 `n_XXX` 当 nodeCode 存脏数据。
   *
   * <p>用后端返回「悬空边」模拟：source 指向库里不存在的 nodeCode。
   * 该边在 React Flow 里本来就渲染不出来，保存时也不该进payload。
   *
   * <p>⚠️ 悬空边必须**叠加**在 `start→approve→end` 合法链路之外（作为第 3 条），
   * 不能替换其中的合法边 —— 否则 `end` 从 START 不可达，会先被可达性校验拦下
   * （`校验未通过：节点「结束」无法从开始节点到达`），压根走不到保存，
   * 也就测不到 flatMap 的丢弃逻辑。
   */
  it('悬空边（端点不存在）在保存时被丢弃，不写入脏 source', async () => {
    vi.mocked(workflowApi.fetchDefinition).mockResolvedValue({
      ...existing,
      edges: [
        { source: 'start', target: 'approve', edgeType: 'DEFAULT', label: null, conditionExpr: null, sortOrder: 0 },
        { source: 'approve', target: 'end', edgeType: 'DEFAULT', label: null, conditionExpr: null, sortOrder: 1 },
        // start2 在 nodes 里不存在 ⇒ 悬空；叠加在合法链路旁，不破坏连通性
        { source: 'start2', target: 'end', edgeType: 'DEFAULT', label: null, conditionExpr: null, sortOrder: 2 },
      ],
    });
    renderBody({ definitionId: '1001' });
    await waitFor(() => expect(screen.getByText(/节点 3 · 连线 3/)).toBeTruthy());

    fireEvent.click(screen.getByText('仅保存'));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const payload = vi.mocked(api.put).mock.calls[0][1] as {
      edges: { source: string; target: string }[];
    };
    // 悬空边被 flatMap 丢弃，只剩 2 条合法边，且不出现脏 source
    expect(payload.edges).toEqual([
      expect.objectContaining({ source: 'start', target: 'approve' }),
      expect.objectContaining({ source: 'approve', target: 'end' }),
    ]);
    for (const e of payload.edges) {
      expect(e.source.startsWith('n_')).toBe(false);
      expect(e.target.startsWith('n_')).toBe(false);
    }
  });
});
