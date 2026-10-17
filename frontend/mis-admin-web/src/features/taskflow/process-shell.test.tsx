// @vitest-environment jsdom
/**
 * ProcessShell单测（P7 + P0-6 + P0-7）：
 * 1. 渲染流程进度、只读业务数据与审批历史
 * 2. 处理人本人可见审批栏（同意/驳回）
 * 3. 非处理人（或流程已结束）不显示审批栏
 * 4. P0-6：面包屑首级取跳转来源（`state.from`），直接输 URL 时回落 /task/pending
 * 5. P0-7：批完自动续下一条（跳队列里的下一个流程实例，并带上 return path）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, type Location } from 'react-router-dom';
import { ProcessShell } from './process-shell';
import * as workflowApi from '@/lib/api/workflow';
import * as tasksApi from '@/lib/api/tasks';
import api from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';
import { __resetRegistryForTest, registerForms } from '@/features/biz/forms/registry';
import { __setFormLoadersForTest } from '@/features/biz/forms/forms/form-loaders';
import type { FormComponent } from '@/features/biz/forms/types';

vi.mock('@/lib/api/workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/workflow')>();
  return {
    ...actual,
    fetchProcessDetail: vi.fn(),
    fetchDefinitions: vi.fn(),
    fetchDefinition: vi.fn(),
  };
});

vi.mock('@/lib/api/tasks', () => ({
  fetchMyTasks: vi.fn(),
  fetchTaskStats: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  default: { post: vi.fn() },
}));

// sonner 在 jsdom 里无 Toaster 宿主，直接 mock 掉避免噪声
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const baseDetail = {
  instance: {
    id: '128',
    definitionCode: 'PURCHASE_APPROVAL',
    startedFormCode: 'PUR_FORM',
    businessType: 'PURCHASE_ORDER',
    businessId: 'PO-001',
    status: 'RUNNING',
    initiatorId: '100',
    initiatorName: '发起人',
    initiatorOrgName: null,
    currentNodeCode: 'approve',
    currentNodeName: null,
    progress: '50%',
    postProcessStatus: 'WAITING',
    postRetryCount: 0,
    createdAt: '2026-10-08T10:00:00',
    completedAt: null,
    appCode: null,
    title: '华东电子采购申请',
  },
  tasks: [
    {
      id: '501',
      instanceId: '128',
      nodeCode: 'approve',
      nodeName: '主管审批',
      taskType: 'APPROVE',
      sysTaskId: '9001',
      assigneeId: '700001',
      assigneeName: '主管',
      status: 'PENDING',
      dueDate: null,
      createdAt: '2026-10-08T10:00:00',
      completedAt: null,
    },
  ],
  history: [
    {
      id: '1',
      nodeCode: 'start',
      operatorId: '100',
      operatorName: '发起人',
      operation: 'SUBMIT',
      fromNode: null,
      toNode: 'start',
      comment: null,
      createdAt: '2026-10-08T10:00:00',
    },
  ],
  // ⚠️ 是 JSON **字符串**（后端 JSONB 的字符串形态），不是对象
  formData: JSON.stringify({
    orderNo: 'PO-001',
    supplier: '华东电子',
    amount: 128000,
    applyDate: '2026-10-09',
    priority: 'HIGH',
    urgent: true,
  }),
  canWithdraw: false,
};

/** 造一条带 wfInstanceId 的待办。 */
function pendingTask(id: string, instanceId: string) {
  return {
    id,
    tenantId: '1',
    taskType: 'PURCHASE_APPROVAL',
    bizType: 'PURCHASE_ORDER',
    bizRefId: 'PO-001',
    bizTitle: `待办 ${id}`,
    targetEntity: null,
    assigneeId: '700001',
    assigneeName: '主管',
    status: 'PENDING',
    priority: 2,
    dueDate: null,
    metadata: JSON.stringify({ wfInstanceId: instanceId }),
    result: null,
    read: false,
    completedAt: null,
    createdAt: '2026-10-08T10:00:00',
    appCode: null,
    initiatorName: null,
    initiatorOrgName: null,
  };
}

function setUser(id: string) {
  useAuthStore.setState({
    user: {
      id, employeeId: 'E1', username: 'u', realName: 'u', avatarUrl: null,
      deptId: null, deptName: null, roles: [], mustChangePassword: false,
    },
  });
}

/** 记录当前 location，便于断言 return path 是否被带上。 */
function LocationProbe({ sink }: { sink: { current: Location | null } }) {
  sink.current = useLocation();
  return null;
}

describe('ProcessShell', () => {
  beforeEach(() => {
    vi.mocked(workflowApi.fetchProcessDetail).mockResolvedValue(baseDetail);
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    // 审批动作走 api.post（axios），给个 code=0 的成功响应
    vi.mocked(api.post).mockResolvedValue({
      data: { code: 0, data: null, message: '' },
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('渲染进度与只读业务数据', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    // page 变体 PageHeader 展示流程 title
    expect(await screen.findByText('华东电子采购申请')).toBeTruthy();
    expect((await screen.findAllByText('PO-001')).length).toBeGreaterThan(0);
    // 完整页「节点处理」列表展示当前节点名
    expect(screen.getAllByText('主管审批').length).toBeGreaterThan(0);
    expect(screen.getByText('业务表单')).toBeTruthy();
    // 业务类型在「流程信息」面板，默认表单态不展示
    expect(screen.queryByText('PURCHASE_ORDER')).toBeNull();
  });

  it('bare 变体顶部展示流程 title', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" variant="bare" />
      </MemoryRouter>,
    );
    const bare = await screen.findByTestId('process-bare-title');
    expect(within(bare).getByRole('heading', { level: 1 }).textContent).toBe('华东电子采购申请');
    expect(within(bare).queryByText(/单号 PO-001/)).toBeNull();
  });

  it('流程信息内图标切换：审批历史与待办 ⇄ 进度情况', async () => {
    setUser('700001');
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [
        {
          id: 'def-1',
          tenantId: '1',
          code: 'PURCHASE_APPROVAL',
          name: '采购审批',
          category: '',
          categoryId: null,
          description: null,
          version: 1,
          status: 'ACTIVE',
          supportedFormCodes: ['PUR_FORM'],
          formSchema: null,
          config: '{}',
          nodes: [
            {
              nodeCode: 'start',
              nodeName: '开始',
              nodeType: 'START',
              sortOrder: 0,
              canvasX: null,
              canvasY: null,
              conditionExpr: null,
              assigneeRule: '{}',
              timeoutHours: null,
              config: '{}',
            },
            {
              nodeCode: 'approve',
              nodeName: '主管审批',
              nodeType: 'APPROVAL',
              sortOrder: 1,
              canvasX: null,
              canvasY: null,
              conditionExpr: null,
              assigneeRule: '{"type":"SUPERVISOR"}',
              timeoutHours: null,
              config: '{}',
            },
          ],
          edges: null,
          createdAt: '2026-10-01T00:00:00',
          updatedAt: '2026-10-01T00:00:00',
        },
      ],
    } as never);
    vi.mocked(workflowApi.fetchDefinition).mockResolvedValue({
      id: 'def-1',
      tenantId: '1',
      code: 'PURCHASE_APPROVAL',
      name: '采购审批',
      category: '',
      categoryId: null,
      description: null,
      version: 1,
      status: 'ACTIVE',
      supportedFormCodes: ['PUR_FORM'],
      formSchema: null,
      config: '{}',
      nodes: [
        {
          nodeCode: 'start',
          nodeName: '开始',
          nodeType: 'START',
          sortOrder: 0,
          canvasX: null,
          canvasY: null,
          conditionExpr: null,
          assigneeRule: '{}',
          timeoutHours: null,
          config: '{}',
        },
        {
          nodeCode: 'approve',
          nodeName: '主管审批',
          nodeType: 'APPROVAL',
          sortOrder: 1,
          canvasX: null,
          canvasY: null,
          conditionExpr: null,
          assigneeRule: '{"type":"SUPERVISOR"}',
          timeoutHours: null,
          config: '{}',
        },
      ],
      edges: null,
      createdAt: '2026-10-01T00:00:00',
      updatedAt: '2026-10-01T00:00:00',
    } as never);

    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    await screen.findByTestId('form-shell');
    expect(screen.queryByRole('button', { name: /查看进度情况/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /查看流程信息/ }));
    const meta = await screen.findByTestId('process-meta');
    expect(within(meta).getByTestId('process-meta-timeline')).toBeTruthy();
    expect(within(meta).queryByTestId('process-progress-board')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切换到进度情况' }));
    expect(await within(meta).findByTestId('process-progress-board')).toBeTruthy();
    expect(within(meta).queryByTestId('process-meta-timeline')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切换到审批历史与待办' }));
    expect(await within(meta).findByTestId('process-meta-timeline')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /返回表单/ }));
    expect(await screen.findByTestId('form-shell')).toBeTruthy();
    expect(screen.queryByTestId('process-progress-board')).toBeNull();
  });

  it('处理人本人显示右栏本次审批', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    const panel = await screen.findByTestId('process-approve-panel');
    expect(within(panel).getByText('本次审批')).toBeTruthy();
    expect(within(panel).getByLabelText('审批建议')).toBeTruthy();
    expect(within(panel).getByText('同意')).toBeTruthy();
    expect(within(panel).getByText('驳回')).toBeTruthy();
  });

  it('同意时提交审批建议 comment', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    const panel = await screen.findByTestId('process-approve-panel');
    fireEvent.change(within(panel).getByLabelText('审批建议'), {
      target: { value: '资料齐全，同意归档' },
    });
    fireEvent.click(within(panel).getByText('同意'));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/workflow/tasks/501/complete',
        { action: 'APPROVE', comment: '资料齐全，同意归档' },
        expect.objectContaining({ params: expect.objectContaining({ tenantId: '1', operatorId: '700001' }) }),
      );
    });
  });

  it('非处理人不显示审批栏', async () => {
    setUser('999999');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('当前节点由他人处理')).toBeTruthy();
    expect(screen.queryByText('同意')).toBeNull();
  });

  it('P0-6：面包屑首级取 state.from（来自门户），直接输 URL 时回落工作台', async () => {
    setUser('700001');
    // 从门户进来：state带from=/portal
    const { unmount } = render(
      <MemoryRouter
        initialEntries={[{ pathname: '/task/process/128', state: { from: '/portal', fromLabel: '工作台' } }]}
      >
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('工作台')).toBeTruthy();
    unmount();

    // 直接输 URL：无 state，必须回落 /task/pending 且不报错
    render(
      <MemoryRouter initialEntries={['/task/process/128']}>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('工作台')).toBeTruthy());
    expect(screen.getByText('流程详情')).toBeTruthy();
  });

  it('P0-7：批完自动续下一条，跳到队列里的下一个流程并保留 return path', async () => {
    setUser('700001');
    // 队列里有一个「下一条」实例 129
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [pendingTask('6001', '129')],
    });

    const loc = { current: null as Location | null };
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/task/process/128', state: { from: '/task/my-processed', fromLabel: '我审批的' } }]}
      >
        <LocationProbe sink={loc} />
        <Routes>
          <Route path="/task/process/:id" element={<ProcessShell instanceId="128" />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('同意'));

    await waitFor(() => {
      expect(loc.current?.pathname).toBe('/task/process/129');
    });
    // return path 不能在「续下一条」时丢掉
    expect((loc.current?.state as { from?: string } | null)?.from).toBe('/task/my-processed');
  });

  it('P0-7：队列为空时批完停留在原地并给出队列清空文案', async () => {
    setUser('700001');
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    // 处理后详情变为「我已处理完」：无 PENDING 任务
    vi.mocked(workflowApi.fetchProcessDetail)
      .mockResolvedValueOnce(baseDetail)
      .mockResolvedValue({
        ...baseDetail,
        tasks: [{ ...baseDetail.tasks[0], status: 'COMPLETED' }],
      });

    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('同意'));

    expect(await screen.findByText(/待处理队列已清空/)).toBeTruthy();
    expect(screen.getByText('查看已办')).toBeTruthy();
  });
});

/**
 * T3.2：套壳接入后的结构保证。
 *
 * 这组断言的价值在于它们是**结构性的**，不是快照式的：
 * 「审批栏在套壳之外」这件事一旦被破坏，表现是审批功能整体不可用，
 * 而肉眼看 UI 很容易漏过去。
 */
describe('ProcessShell · 套壳接入（T3.2）', () => {
  beforeEach(() => {
    vi.mocked(workflowApi.fetchProcessDetail).mockResolvedValue(baseDetail);
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    vi.mocked(api.post).mockResolvedValue({ data: { code: 0, data: null, message: '' } } as never);
    __resetRegistryForTest();
    __setFormLoadersForTest({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('表单在左栏主列；节点处理与审批历史在表单下方纵向排列；可审时右栏有操作框', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );

    const main = await screen.findByTestId('process-main-column');
    expect(within(main).getByTestId('form-shell')).toBeTruthy();
    expect(within(main).getByTestId('process-node-timeline')).toBeTruthy();
    expect(within(main).getByText('审批历史')).toBeTruthy();
    // 可审：操作在右栏，不在主列内
    const panel = screen.getByTestId('process-approve-panel');
    expect(panel).toBeTruthy();
    expect(within(panel).getByText('同意')).toBeTruthy();
    expect(within(main).queryByText('同意')).toBeNull();
  });

  it('查看流程信息 ⇄ 返回表单：元信息在独立面板', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );

    await screen.findByTestId('form-shell');
    // 默认表单面板，不展示流程信息字段
    expect(screen.queryByTestId('process-meta')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /查看流程信息/ }));
    const meta = await screen.findByTestId('process-meta');
    const fields = within(meta).getByTestId('process-meta-fields');
    expect(within(fields).getByText('业务类型')).toBeTruthy();
    expect(within(fields).getByText('业务单号')).toBeTruthy();
    expect(within(fields).getByText('流程编码')).toBeTruthy();
    expect(within(fields).getByText('PURCHASE_APPROVAL')).toBeTruthy();
    expect(within(fields).getByText('表单')).toBeTruthy();
    expect(within(fields).getByText('PUR_FORM')).toBeTruthy();
    expect(within(fields).getByText('当前节点')).toBeTruthy();
    expect(within(fields).getByText('发起人（公司）')).toBeTruthy();
    expect(within(fields).getByText('发起人')).toBeTruthy();
    expect(screen.queryByTestId('form-shell')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /返回表单/ }));
    expect(await screen.findByTestId('form-shell')).toBeTruthy();
    expect(screen.queryByTestId('process-meta')).toBeNull();
  });

  it('⚠️ 表单渲染抛错时，同意/驳回依然可点并真的发起审批', async () => {
    setUser('700001');
    // 让 schema 在读取时抛错 ⇒ 套壳内 ErrorBoundary 兜底，套壳外不受影响
    const entry = {
      formCode: 'PUR_FORM',
      name: '会炸的表单',
      component: (() => <div />) as FormComponent,
      fields: [],
    };
    Object.defineProperty(entry, 'fields', {
      get() {
        throw new Error('schema 读取失败');
      },
    });
    registerForms([entry]);

    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );

    // 表单区域已降级
    expect((await screen.findByTestId('form-missing')).getAttribute('data-reason')).toBe('render-error');

    // ⚠️ 审批动作照常发出——这是硬要求，不是优化
    fireEvent.click(screen.getByText('同意'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][0]).toContain('/workflow/tasks/501/complete');
  });

  it('⚠️ 表单未注册（发版漏了）时审批栏同样可点', async () => {
    setUser('700001');

    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );

    expect((await screen.findByTestId('form-missing')).getAttribute('data-reason')).toBe('not-registered');

    fireEvent.click(screen.getByText('同意'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
  });

  it('单层滚动：外层网格是滚动容器，套壳内部不再套 overflow-auto', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );

    const shell = await screen.findByTestId('form-shell');
    expect(shell.className).not.toContain('overflow');
    // 外层网格承担滚动
    expect(shell.closest('.overflow-auto')).toBeTruthy();
  });
});
