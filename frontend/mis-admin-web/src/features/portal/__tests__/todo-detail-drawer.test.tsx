// @vitest-environment jsdom
/**
 * 待办详情抽屉（T03b，设计 §2.1 / §2.2 / §2.4）。
 *
 * 覆盖：
 * 1. 打开抽屉 → 拉流程详情，`SheetHeader` 由 `onLoaded` 回调填业务单号 + 状态徽标；
 * 2. 内容体渲染 **embedded 变体** ProcessShell：三区竖向堆叠（①审批进度 ②只读表单 ③审批历史），
 *    且**无 `PageHeader`**（面包屑「流程详情」不出现）；
 * 3. 同意/驳回走 **wfTask** 端点 `/workflow/tasks/{wfTaskId}/complete`，成功后回调 `onDone`；
 * 4. 转办走 **sysTask** 端点 `transferTask(sysTaskId, ...)`；
 * 5. `sysTaskId == null` → 转办按钮**置灰**（降级，不发请求）；
 * 6. 抽屉宽度 `max-w-[560px]`，底部「在完整页打开」入口存在。
 *
 * mock 范式：真实 `ProcessShell`（是 embedded 变体的集成验证），故需 mock 其全部接口依赖：
 * `@/lib/api/workflow` 只换 `fetchProcessDetail`；`@/lib/api/tasks` 提供 `fetchMyTasks`（embedded 不用，
 * 但 import 需存在）+ `transferTask`；`@/lib/api/client` 提供 `post`（同意/驳回）；`sonner` 打桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  return { ...actual, fetchProcessDetail: vi.fn() };
});

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
      currentNodeCode: 'approve',
      currentNodeName: null,
      progress: '50%',
      postProcessStatus: 'WAITING',
      postRetryCount: 0,
      createdAt: '2026-10-08T10:00:00',
      completedAt: null,
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

    // onLoaded 回调把 instance 交给抽屉 → SheetTitle（h2）由占位「待办详情」填成业务单号
    await waitFor(() => expect(screen.getAllByText('PO-001').length).toBeGreaterThan(0));
    const dialog = screen.getAllByRole('dialog')[0];
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('PO-001');
    expect(screen.getByText('进行中')).toBeTruthy();

    // 三区：①审批进度（节点名）②业务表单（form-shell 标题）③审批历史
    expect(screen.getByText('主管审批')).toBeTruthy();
    expect(screen.getByText('业务表单')).toBeTruthy();
    expect(screen.getByText('审批历史')).toBeTruthy();

    expect(workflowApi.fetchProcessDetail).toHaveBeenCalledWith('128', '1');
  });

  it('embedded 变体：不渲染 PageHeader（无面包屑「流程详情」）', async () => {
    renderDrawer();
    await screen.findByText('业务表单');
    expect(screen.queryByText('流程详情')).toBeNull();
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

  it('底部提供「在完整页打开」入口', async () => {
    renderDrawer();
    await screen.findByText('业务表单');
    expect(screen.getByText('在完整页打开')).toBeTruthy();
  });
});
