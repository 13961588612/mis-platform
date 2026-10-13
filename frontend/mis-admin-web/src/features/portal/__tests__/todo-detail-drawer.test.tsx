// @vitest-environment jsdom
/**
 * 待办详情抽屉（T03b，设计 §2.1 / §2.2 / §2.4）。
 *
 * 覆盖：
 * 1. 打开抽屉 → 拉流程详情，`SheetHeader` 由 `onLoaded` 填流程 title + 状态徽标；单号等字段在流程信息面板；
 * 2. 内容体渲染 **embedded** ProcessShell：纵向（表单→底部操作；审批历史在「流程信息」内），
 *    且**无 `PageHeader`**（面包屑「流程详情」不出现）；
 * 3. 同意/驳回走 **wfTask** 端点 `/workflow/tasks/{wfTaskId}/complete`，成功后回调 `onDone`；
 * 4. 转办走 **sysTask** 端点 `transferTask(sysTaskId, ...)`；
 * 5. `sysTaskId == null` → 转办按钮**置灰**（降级，不发请求）；
 * 6. 抽屉宽度 `max-w-[560px]`，底部「在完整页打开」用命名 window.open 复用标签。
 *
 * mock 范式：真实 `ProcessShell`（是 embedded 变体的集成验证），故需 mock 其全部接口依赖：
 * `@/lib/api/workflow` 只换 `fetchProcessDetail`；`@/lib/api/tasks` 提供 `fetchMyTasks`（embedded 不用，
 * 但 import 需存在）+ `transferTask`；`@/lib/api/client` 提供 `post`（同意/驳回）；`sonner` 打桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { TodoDetailDrawer } from '../components/todo-detail-drawer';
import * as workflowApi from '@/lib/api/workflow';
import * as tasksApi from '@/lib/api/tasks';
import api from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';
import { __resetRegistryForTest } from '@/features/biz/forms/registry';
import { __setFormLoadersForTest } from '@/features/biz/forms/forms/form-loaders';

// Radix Dialog / 相关浮层在 jsdom 里可能触达 ResizeObserver；打桩避免噪声（仓库既有范式）。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView ??= () => {};

vi.mock('@/lib/api/workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/workflow')>();
  return {
    ...actual,
    fetchProcessDetail: vi.fn(),
    fetchDefinitions: vi.fn(),
    fetchDefinition: vi.fn(),
  };
});

/** 进度看板 / 待办后续节点共用的定义 fixture。 */
const defFixture = {
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
};

vi.mock('@/lib/api/tasks', () => ({
  fetchMyTasks: vi.fn(),
  transferTask: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  default: { post: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

/** 流程详情 fixture：当前用户 700001 是「主管审批」节点的处理人（sysTaskId=9001）。 */
function detailFixture(overrides: { sysTaskId?: string | null } = {}) {
  return {
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
        sysTaskId: overrides.sysTaskId === undefined ? '9001' : overrides.sysTaskId,
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
    formData: JSON.stringify({ orderNo: 'PO-001', amount: 128000 }),
  };
}

function setUser(id: string) {
  useAuthStore.setState({
    user: {
      id,
      employeeId: 'E1',
      username: 'u',
      realName: 'u',
      avatarUrl: null,
      deptId: null,
      deptName: null,
      roles: [],
      mustChangePassword: false,
    },
  });
}

function renderDrawer(props: { instanceId?: string | null; onDone?: () => void } = {}) {
  const onDone = props.onDone ?? vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <MemoryRouter>
      <TodoDetailDrawer
        open
        onOpenChange={onOpenChange}
        instanceId={props.instanceId === undefined ? '128' : props.instanceId}
        onDone={onDone}
      />
    </MemoryRouter>,
  );
  return { ...utils, onDone, onOpenChange };
}

describe('TodoDetailDrawer（T03b）', () => {
  beforeEach(() => {
    setUser('700001');
    __resetRegistryForTest();
    __setFormLoadersForTest({});
    vi.mocked(workflowApi.fetchProcessDetail).mockResolvedValue(detailFixture() as never);
    vi.mocked(workflowApi.fetchDefinitions).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [defFixture],
    } as never);
    vi.mocked(workflowApi.fetchDefinition).mockResolvedValue(defFixture as never);
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({ page: 1, size: 20, total: 0, list: [] });
    vi.mocked(tasksApi.transferTask).mockResolvedValue(undefined);
    vi.mocked(api.post).mockResolvedValue({ data: { code: 0, data: null, message: '' } } as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('打开抽屉：拉流程详情，SheetHeader 填业务单号 + 状态徽标，三区竖向渲染', async () => {
    renderDrawer();

    // 抽屉以 dialog 形态存在，宽度锁定 560px
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0));
    expect(screen.getAllByRole('dialog')[0].className).toContain('max-w-[560px]');

    // onLoaded → SheetTitle 优先展示流程 title
    await waitFor(() => expect(screen.getByText('华东电子采购申请')).toBeTruthy());
    const dialog = screen.getAllByRole('dialog')[0];
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('华东电子采购申请');
    expect(screen.queryByText(/单号 PO-001/)).toBeNull();
    expect(screen.getByText('进行中')).toBeTruthy();
    // 抽屉布局：默认表单 + 底部「当前待办」与同意；审批历史在「流程信息」面板内
    expect(screen.getByText(/当前待办：\s*主管审批/)).toBeTruthy();
    expect(screen.getByText('业务表单')).toBeTruthy();
    expect(screen.queryByText('审批历史')).toBeNull();
    expect(screen.getByText('同意')).toBeTruthy();
    expect(screen.queryByTestId('process-approve-panel')).toBeNull();
    expect(screen.queryByTestId('process-node-timeline')).toBeNull();

    expect(workflowApi.fetchProcessDetail).toHaveBeenCalledWith('128', '1');
  });

  it('embedded 变体：不渲染 PageHeader（无面包屑「流程详情」）', async () => {
    renderDrawer();
    await screen.findByText('业务表单');
    expect(screen.queryByLabelText('面包屑')).toBeNull();
  });

  it('同意：走 wfTask 端点 /workflow/tasks/{id}/complete，成功后回调 onDone', async () => {
    const { onDone } = renderDrawer();
    fireEvent.click(await screen.findByText('同意'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/workflow/tasks/501/complete');
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ action: 'APPROVE', comment: '同意' });
    expect(vi.mocked(api.post).mock.calls[0][2]).toEqual({
      params: { tenantId: '1', operatorId: '700001' },
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('驳回：同样走 wfTask 端点', async () => {
    renderDrawer();
    fireEvent.click(await screen.findByText('驳回'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/workflow/tasks/501/complete');
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ action: 'REJECT', comment: '驳回' });
  });

  it('转办：走 sysTask 端点 transferTask(sysTaskId, tenantId, operatorId, assignee, name)，成功后回调 onDone', async () => {
    const { onDone } = renderDrawer();
    fireEvent.click(await screen.findByText('转办'));

    const idInput = await screen.findByLabelText('新处理人工号');
    fireEvent.change(idInput, { target: { value: '800001' } });
    fireEvent.change(screen.getByLabelText('新处理人姓名'), { target: { value: '张三' } });

    fireEvent.click(screen.getByText('提交转办'));

    await waitFor(() => expect(tasksApi.transferTask).toHaveBeenCalled());
    expect(tasksApi.transferTask).toHaveBeenCalledWith('9001', '1', '700001', '800001', '张三');
    // 动作分派纪律：转办**绝不**走 wfTask 端点
    expect(api.post).not.toHaveBeenCalled();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('sysTaskId 为空 → 转办按钮置灰（降级，不发请求）', async () => {
    vi.mocked(workflowApi.fetchProcessDetail).mockResolvedValue(
      detailFixture({ sysTaskId: null }) as never,
    );
    renderDrawer();
    const transferBtn = (await screen.findByText('转办')) as HTMLButtonElement;
    expect(transferBtn.disabled).toBe(true);

    fireEvent.click(transferBtn);
    // 置灰按钮点击不展开输入、不发请求
    expect(screen.queryByLabelText('新处理人工号')).toBeNull();
    expect(tasksApi.transferTask).not.toHaveBeenCalled();
  });

  it('查看流程信息：审批历史在待办及后续上方；图标可切到进度情况', async () => {
    renderDrawer();
    await screen.findByText('业务表单');
    expect(screen.queryByRole('button', { name: /查看进度情况/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /查看流程信息/ }));
    const meta = await screen.findByTestId('process-meta');
    const fields = within(meta).getByTestId('process-meta-fields');
    expect(within(fields).getByText('业务单号')).toBeTruthy();
    expect(within(fields).getByText('PO-001')).toBeTruthy();
    expect(within(fields).getByText('流程编码')).toBeTruthy();
    expect(within(fields).getByText('PURCHASE_APPROVAL')).toBeTruthy();
    expect(within(fields).getByText('表单')).toBeTruthy();
    expect(within(fields).getByText('PUR_FORM')).toBeTruthy();
    const history = within(meta).getByTestId('process-meta-history');
    const upcoming = await within(meta).findByTestId('process-meta-upcoming');
    expect(within(history).getByText('审批历史')).toBeTruthy();
    expect(within(history).getByText('SUBMIT')).toBeTruthy();
    expect(
      history.compareDocumentPosition(upcoming) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换到进度情况' }));
    expect(await within(meta).findByTestId('process-progress-board')).toBeTruthy();
    expect(within(meta).queryByTestId('process-meta-timeline')).toBeNull();
  });

  it('底部「在完整页打开」→ 命名窗口并 focus', async () => {
    const focus = vi.fn();
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue({ focus } as unknown as Window);
    renderDrawer();
    await screen.findByText('业务表单');
    fireEvent.click(screen.getByText('在完整页打开'));
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/task\/process-view\/128$/),
      'mis-process-view-128',
    );
    expect(focus).toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('完整页 window.open 被拦截 → toast 提示', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderDrawer();
    await screen.findByText('业务表单');
    fireEvent.click(screen.getByText('在完整页打开'));
    expect(toast.error).toHaveBeenCalledWith(
      '无法打开完整页',
      expect.objectContaining({
        description: expect.stringContaining('浏览器拦截'),
      }),
    );
    openSpy.mockRestore();
  });
});
