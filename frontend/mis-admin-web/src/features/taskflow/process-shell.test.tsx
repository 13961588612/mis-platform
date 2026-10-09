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
  return { ...actual, fetchProcessDetail: vi.fn() };
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
    expect((await screen.findAllByText('PO-001')).length).toBeGreaterThan(0);
    expect(screen.getByText('主管审批')).toBeTruthy();
    expect(screen.getByText('业务表单')).toBeTruthy();
    expect(screen.getByText('PURCHASE_ORDER')).toBeTruthy();
  });

  it('处理人本人显示审批栏', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('同意')).toBeTruthy();
    expect(screen.getByText('驳回')).toBeTruthy();
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

  /** 套壳所在的卡片：应当占 lg:grid-cols-3 里的 2 列。 */
  function shellCard(): HTMLElement {
    const shell = screen.getByTestId('form-shell');
    const card = shell.closest('div.lg\\:col-span-2');
    if (!card) throw new Error('套壳未放在 lg:col-span-2 的卡片里');
    return card as HTMLElement;
  }

  it('套壳放在 lg:col-span-2 的左栏（右栏是窄的审批历史，放不下多行文本）', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );

    await screen.findByTestId('form-shell');
    expect(shellCard()).toBeTruthy();
    // 右栏审批历史不占 2 列
    expect(screen.getByText('审批历史').closest('div.lg\\:col-span-2')).toBeNull();
  });

  it('4 个流程元信息收进 details 且**默认收起**', async () => {
    setUser('700001');
    render(
      <MemoryRouter>
        <ProcessShell instanceId="128" />
      </MemoryRouter>,
    );

    const details = await screen.findByTestId('process-meta');
    // 默认收起：没有 open 属性。审批人 90% 注意力在业务数据
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.tagName).toBe('DETAILS');
    // 内容仍在 DOM 里（收起 ≠ 不渲染，查证时不需要额外请求）
    // ⚠️ 用 within 限定在字段容器内：details 的 summary 文字里也含「发起人」等词
    const fields = within(details).getByTestId('process-meta-fields');
    expect(within(fields).getByText('业务类型')).toBeTruthy();
    expect(within(fields).getByText('业务单号')).toBeTruthy();
    expect(within(fields).getByText('当前节点')).toBeTruthy();
    // 4 个字段齐全：发起人 label + 其值（fixture 里两者文字相同，故用 getAllByText计数）
    expect(within(fields).getAllByText('发起人')).toHaveLength(2);
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
