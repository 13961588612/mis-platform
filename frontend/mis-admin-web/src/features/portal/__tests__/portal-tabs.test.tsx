// @vitest-environment jsdom
/**
 * 门户三 Tab **容器**测试（T01；UI 精修轮扩图标/药丸风格 + Tab store 桥接 + 首页板抽屉）；
 * 本轮（顶栏改造轮）随结构改动更新。
 *
 * <p><b>本轮结构改动</b>：三个 tab 从本页搬到顶栏
 * `components/layout/portal-tab-switcher.tsx`（Radix `Tabs` 的 `TabsList`/`TabsContent`
 * 必须在同一 root 内，而顶栏与门户内容区在两棵 React 树，上下文连不通）。
 * 因此本文件里「tab 的样式 / 图标 / 两态盒模型」一类断言**整体迁移**到
 * `src/components/layout/__tests__/portal-tab-switcher.test.tsx`
 * （tab DOM 现在由那个组件产出，在本页里查不到）。本文件转而锁容器侧契约：
 *
 * 覆盖：
 * 1. **tab 条的唯一来源在顶栏**：PortalPage 自身**不渲染**任何门户 tab 触发器
 *    （`role="tab"` 且名为「首页 / 待办事项 / 消息中心」的元素一个都没有）；
 * 2. 默认选中「首页」，且首页内容（欢迎语 + 工作台板块 + AppRail）与现状一致；
 * 3. **点顶栏 tab → 写 store → 门户渲染对应内容**（真断言内容切换，不只断 store）：
 *    点「待办事项」→ Todo 真实组件挂载、首页内容卸载；点「消息中心」→ Message 挂载；
 * 4. **不发生路由跳转**：Tab 切换纯本地态（store），`useNavigate` 不被调用。
 *    （核心红线：三 Tab 绝不入 URL，规避 keep-alive `PAGE_MAP`/`useParams` 坑。）
 * 5. **外部 `setActiveTab(...)` 能驱动门户切页签**（顶栏「打开消息中心」的桥接契约：
 *    layout 侧只写 store，门户页必须即时响应）；
 * 6. **T05 集成**：两抽屉可开——待办点行开待办抽屉（携 instanceId）、消息点行开消息抽屉（携 messageId）。
 *    抽屉以轻量替身替换（其内部行为由 `todo-tabs.test.tsx` / `message-reply-drawer.test.tsx` 覆盖）。
 * 7. **首页三板点行改开抽屉**（取代路由跳转）：TaskBoard/ProcessBoard → TodoDetailDrawer、
 *    MessageBoard → MessageDetailDrawer（且 messageId 是**被点的那条**，不是固定值）。
 *
 * mock 范式（对齐 `portal-page.smoke.test.tsx`）：
 * - 整体替换 api 模块，避免真实 axios/fetch；
 * - zustand 用 `useAuthStore.setState` / `usePortalTabStore.setState` 直接塞状态；
 * - `next-themes` 显式 mock（子组件可能间接用到）；
 * - `useNavigate` 用 spy 替换，用于断言「未发生跳转」；
 * - 两个抽屉替身（T05）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalPage } from '../portal-page';
import { PortalTabSwitcher } from '@/components/layout/portal-tab-switcher';
import * as platformApi from '@/lib/api/platform';
import * as tasksApi from '@/lib/api/tasks';
import * as messagesApi from '@/lib/api/messages';
import * as workflowApi from '@/lib/api/workflow';
import { useAuthStore } from '@/stores/auth-store';
import { usePortalTabStore } from '@/stores/portal-tab-store';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: 'light' }),
}));

vi.mock('@/lib/api/platform', () => ({
  fetchApps: vi.fn(),
  fetchDashboardStats: vi.fn(),
}));

vi.mock('@/lib/api/auth', () => ({
  logout: vi.fn(),
}));

vi.mock('@/lib/api/tasks', () => ({
  fetchMyTasks: vi.fn(),
  fetchHandledTasks: vi.fn(),
  fetchTaskStats: vi.fn(),
  handleTask: vi.fn(),
}));

vi.mock('@/lib/api/messages', () => ({
  fetchInbox: vi.fn(),
  fetchMessageStats: vi.fn(),
  searchMessages: vi.fn(),
  fetchMessageDetail: vi.fn(),
  markMessagesRead: vi.fn(),
  replyMessage: vi.fn(),
}));

vi.mock('@/lib/api/workflow', () => ({
  fetchMyProcesses: vi.fn(),
}));

// 两抽屉替身（T05 集成 + UI 精修轮的首页板抽屉）：本文件只验证「行点击 → 抽屉打开并带对 ID」的接线，
// 抽屉内部（表单渲染 / 回复回显 / 三动作）由各自单测覆盖。
vi.mock('@/features/portal/components/todo-detail-drawer', () => ({
  TodoDetailDrawer: ({ open, instanceId }: { open: boolean; instanceId: string | null }) =>
    open ? <div data-testid="todo-drawer" data-instance={instanceId ?? ''} /> : null,
}));
vi.mock('@/features/portal/components/message-detail-drawer', () => ({
  MessageDetailDrawer: ({ open, messageId }: { open: boolean; messageId: string | null }) =>
    open ? <div data-testid="message-drawer" data-message={messageId ?? ''} /> : null,
}));

vi.mock('@/lib/nav/iframe-apps', () => ({
  registerIframeApps: vi.fn(),
  getIframeApp: vi.fn(),
  useIframeRegistryVersion: vi.fn(() => 0),
}));

const emptyPage = { page: 1, size: 20, total: 0, list: [] };

const sampleApps = [
  {
    id: '1',
    tenantId: '1',
    code: 'system',
    name: '系统管理',
    icon: 'Settings',
    basePath: '/system',
    description: null,
    portalGroup: 'governance',
    kind: 'app',
    runtime: 'host',
    sort: 1,
    status: 1,
    enterable: true,
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/portal']}>
      <PortalPage />
    </MemoryRouter>,
  );
}

/**
 * 顶栏 tab + 门户页**同树**渲染：用于断言「点顶栏 tab ⇒ 门户内容真的切换」。
 *
 * <p>两个组件在真实运行时分处两棵 React 树（顶栏在 `AppLayout`、内容区在
 * `KeepAliveOutlet` 主槽），但它们唯一的耦合是模块级 `usePortalTabStore`，
 * 所以在测试里并排渲染即可还原真实联动，无需拉起整个 AppLayout。
 */
function renderPageWithHeaderTabs() {
  return render(
    <MemoryRouter initialEntries={['/portal']}>
      <PortalTabSwitcher />
      <PortalPage />
    </MemoryRouter>,
  );
}

describe('PortalPage 三 Tab 容器', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 'test-token',
      expiresAt: Date.now() + 3_600_000,
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
    vi.mocked(platformApi.fetchApps).mockResolvedValue(sampleApps);
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue(emptyPage);
    vi.mocked(tasksApi.fetchTaskStats).mockResolvedValue({ pending: 0, urgent: 0, overdue: 0 });
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue(emptyPage);
    vi.mocked(messagesApi.fetchMessageStats).mockResolvedValue({ unread: 0, total: 0 });
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue(emptyPage);
    // Tab 激活态是**模块级全局 store**（跨测试共享），必须逐例复位到默认「首页」，
    // 否则上一例切到 message 会让下一例的「默认选中首页」断言假失败。
    usePortalTabStore.setState({ activeTab: 'home' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------
  // 本轮改动：tab 条已搬到顶栏 ⇒ 本容器**自身**不再产出任何门户 tab。
  //
  // 🔴 说明（为什么删/改，而不是留着）：
  // - 原「渲染『首页 / 待办事项 / 消息中心』三个 Tab」用例：tab DOM 现在由
  //   `PortalTabSwitcher` 产出，PortalPage 里查不到 ⇒ 语义反转为「本页不该有 tab」，
  //   保留断言价值（锁住「tab 唯一来源在顶栏」），故**改写**而非删除。
  // - 原「三个 Tab 均为『图标 + 文字』药丸式风格」用例：断言的是 tab DOM 的 className
  //   （`bg-card` 栏 / `bg-muted` 药丸 / `h-auto` / `-mb-px`…），DOM 已不在本页，
  //   在本文件里只能断言到「全都没有」——那退化成了空断言。其等价（且更强）的断言
  //   **整体迁移**到 `components/layout/__tests__/portal-tab-switcher.test.tsx`
  //   （三个 tab 的图标 svg、`bg-background` 选中态、两态盒模型 token 逐一判等、
  //   无关闭按钮），故此处**删除**，不是「删了事」。
  // ---------------------------------------------------------------------
  it('PortalPage 自身不再渲染门户 tab 条（tab 唯一来源在顶栏）', async () => {
    renderPage();
    await screen.findByText('你好，测试员');
    // 门户三 Tab 的触发器一个都不该出现在页面内（顶栏由 AppLayout 提供）。
    expect(screen.queryByRole('tab', { name: '首页' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '待办事项' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '消息中心' })).toBeNull();
    expect(screen.queryByTestId('portal-tab-switcher')).toBeNull();
    // 但内容区（面板）仍在，且带 tabpanel 语义供顶栏 aria-controls 引用。
    expect(screen.getByRole('tabpanel')).toBeTruthy();
    expect(screen.getByTestId('portal-tab-panel').getAttribute('id')).toBe('portal-tab-panel');
  });

  it('默认选中「首页」，首页内容与现状一致（欢迎语 + 工作台板块 + AppRail）', async () => {
    renderPage();
    expect(await screen.findByText('你好，测试员')).toBeTruthy();
    // 工作台板块 + AppRail（与 portal-page.smoke 同口径）
    expect(screen.getByText('消息与通知')).toBeTruthy();
    expect(screen.getByText('我的应用')).toBeTruthy();
    expect((await screen.findAllByText('系统管理')).length).toBeGreaterThan(0);
    // 首页为默认态 ⇒ Todo/Message 不应挂载（Todo 的搜索框、Message 的搜索框都不出现）
    expect(screen.queryByLabelText('待办关键词')).toBeNull();
    expect(screen.queryByLabelText('消息关键词')).toBeNull();
  });

  // ---------------------------------------------------------------------
  // 本轮改动：原「点击『待办事项』/『消息中心』」两个用例，点的是**页内** Radix
  // `TabsTrigger`（必须在 `onMouseDown` 上激活）。tab 搬到顶栏后变成普通 `button`
  // （`onClick` 写 store），且不在本页里 ⇒ 改为「顶栏 tab + 门户页同树渲染，点顶栏
  // tab，断言门户内容真的切换」。另**新增**一条专门断言 store 中间态，把
  // 「点击 → store → 内容」这条链完整钉住。
  // ---------------------------------------------------------------------
  it('点顶栏「待办事项」→ store 变 todo → 门户渲染 Todo 真实组件（首页内容卸载）', async () => {
    renderPageWithHeaderTabs();
    await screen.findByText('你好，测试员');

    fireEvent.click(screen.getByRole('tab', { name: '待办事项' }));

    // 中间态：store 确实被写（不只看内容，内容可能由别的原因切换）。
    expect(usePortalTabStore.getState().activeTab).toBe('todo');
    // 终态：内容是**真实的** Todo 组件——以搜索框 + 子 Tab 作为挂载标志。
    expect(await screen.findByLabelText('待办关键词')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '待处理' })).toBeTruthy();
    expect(screen.queryByText('你好，测试员')).toBeNull();
  });

  it('点顶栏「消息中心」→ store 变 message → 门户渲染 Message 真实组件', async () => {
    renderPageWithHeaderTabs();
    await screen.findByText('你好，测试员');

    fireEvent.click(screen.getByRole('tab', { name: '消息中心' }));

    expect(usePortalTabStore.getState().activeTab).toBe('message');
    // T04 起「消息中心」为真实组件：以搜索框 + 子 Tab 作为挂载标志。
    expect(await screen.findByLabelText('消息关键词')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '审批' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '系统告警' })).toBeTruthy();
    expect(screen.queryByLabelText('待办关键词')).toBeNull();
    expect(screen.queryByText('你好，测试员')).toBeNull();
  });

  it('点顶栏 tab 往返切换不发生路由跳转（useNavigate 未被调用、不新增路由）', async () => {
    renderPageWithHeaderTabs();
    await screen.findByText('你好，测试员');

    fireEvent.click(screen.getByRole('tab', { name: '待办事项' }));
    fireEvent.click(screen.getByRole('tab', { name: '消息中心' }));
    fireEvent.click(screen.getByRole('tab', { name: '首页' }));
    await screen.findByText('你好，测试员');
    expect(usePortalTabStore.getState().activeTab).toBe('home');

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('T05 集成：两抽屉可开——待办点行开待办抽屉（携 instanceId）、消息点行开消息抽屉（携 messageId）', async () => {
    // 待办：一条带 wfInstanceId 的待处理（行点击才可开抽屉）。
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [
        {
          id: '9001',
          tenantId: '1',
          taskType: 'APPROVE',
          bizType: 'PURCHASE_ORDER',
          bizRefId: 'PO-001',
          bizTitle: '采购单审批-甲',
          targetEntity: null,
          assigneeId: '700001',
          assigneeName: '测试员',
          status: 'PENDING',
          priority: 2,
          dueDate: null,
          metadata: JSON.stringify({ wfInstanceId: 128 }),
          result: null,
          read: false,
          completedAt: null,
          createdAt: '2026-10-08T10:00:00',
        },
      ],
    });
    // 消息：一条普通消息（点行开抽屉）。
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [
        {
          id: '5001',
          tenantId: '1',
          msgType: 'APPROVAL',
          category: 'TASK',
          title: '消息-甲',
          summary: '摘要',
          senderId: '9',
          senderName: '系统',
          referenceTaskId: null,
          receiverGroupType: 'SINGLE',
          read: true,
          readCount: 1,
          totalCount: 1,
          createdAt: '2026-10-08T10:00:00',
          instanceId: null,
          canReply: false,
        },
      ],
    });
    renderPageWithHeaderTabs();
    await screen.findByText('你好，测试员');

    // 待办 Tab：点行 → 待办抽屉打开，携带该行 instanceId（不由 navigate 承担）。
    // tab 已搬到顶栏（普通 button，onClick 写 store），不再是 Radix 的 onMouseDown。
    fireEvent.click(screen.getByRole('tab', { name: '待办事项' }));
    const todoRow = (await screen.findByText('采购单审批-甲')).closest('button');
    expect(todoRow).toBeTruthy();
    fireEvent.click(todoRow!);
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
    expect(navigateSpy).not.toHaveBeenCalled();

    // 消息 Tab：切过去后待办抽屉随面板卸载；点消息行 → 消息抽屉打开，携带 messageId。
    fireEvent.click(screen.getByRole('tab', { name: '消息中心' }));
    const msgRow = (await screen.findByText('消息-甲')).closest('button');
    expect(msgRow).toBeTruthy();
    fireEvent.click(msgRow!);
    expect(await screen.findByTestId('message-drawer')).toBeTruthy();
    expect(screen.getByTestId('message-drawer').getAttribute('data-message')).toBe('5001');
    // 切 Tab 卸载上一面板 ⇒ 待办抽屉随之关闭（期望语义）。
    expect(screen.queryByTestId('todo-drawer')).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // UI 精修轮：Tab 激活态搬到全局 store —— 外部改动必须能驱动门户页
  // （这是顶栏「打开消息中心」的桥接契约：layout 侧只写 store，门户侧必须即时响应）
  // ---------------------------------------------------------------------

  it('外部 setActiveTab("message") 驱动门户切到消息中心（首页卸载）', async () => {
    renderPage();
    await screen.findByText('你好，测试员');

    // 模拟顶栏：navigate('/portal') + setActiveTab('message')。
    act(() => {
      usePortalTabStore.getState().setActiveTab('message');
    });

    expect(await screen.findByLabelText('消息关键词')).toBeTruthy();
    expect(screen.queryByText('你好，测试员')).toBeNull();
    // 不再是 Radix TabsTrigger ⇒ 没有 data-state；选中态只以 store 为准
    // （顶栏 tab 的 aria-selected 由 `portal-tab-switcher.test.tsx` 覆盖）。
    expect(usePortalTabStore.getState().activeTab).toBe('message');
  });

  it('外部 setActiveTab("todo") 同样驱动门户切到待办事项（不只message 可桥接）', async () => {
    renderPage();
    await screen.findByText('你好，测试员');

    act(() => {
      usePortalTabStore.getState().setActiveTab('todo');
    });

    expect(await screen.findByLabelText('待办关键词')).toBeTruthy();
    expect(screen.queryByText('你好，测试员')).toBeNull();
  });

  // ---------------------------------------------------------------------
  // UI 精修轮：首页三板点行改开抽屉（取代路由跳转）
  // ---------------------------------------------------------------------

  /** 首页 TaskBoard 的待办 fixture：带 `wfInstanceId` → 点行应开抽屉。 */
  function taskFixture(id: string, title: string, instanceId: number) {
    return {
      id,
      tenantId: '1',
      taskType: 'APPROVE',
      bizType: 'PURCHASE_ORDER',
      bizRefId: 'PO-001',
      bizTitle: title,
      targetEntity: null,
      assigneeId: '700001',
      assigneeName: '测试员',
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

  /** 首页 MessageBoard 的消息 fixture。 */
  function messageFixture(id: string, title: string) {
    return {
      id,
      tenantId: '1',
      msgType: 'APPROVAL',
      category: 'TASK',
      title,
      summary: '摘要',
      senderId: '9',
      senderName: '系统',
      referenceTaskId: null,
      receiverGroupType: 'SINGLE',
      read: true,
      readCount: 1,
      totalCount: 1,
      createdAt: '2026-10-08T10:00:00',
      instanceId: null,
      canReply: false,
    };
  }

  it('首页 TaskBoard 点行 → TodoDetailDrawer 打开且 instanceId 为该行的流程实例', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [taskFixture('9001', '待办-甲', 128)],
    });
    renderPage();
    const row = (await screen.findByText('待办-甲')).closest('button');
    expect(row).toBeTruthy();
    fireEvent.click(row!);

    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
    // 关键：点行不再触发路由跳转（取代原 navigate('/task/process/128')）
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('首页 TaskBoard 无关联流程的行 → 降级跳 /task/pending（不开空抽屉）', async () => {
    vi.mocked(tasksApi.fetchMyTasks).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      // metadata 为 null ⇒ wfInstanceId(item) === null
      list: [{ ...taskFixture('9002', '待办-无流程', 1), metadata: null }],
    });
    renderPage();
    const row = (await screen.findByText('待办-无流程')).closest('button');
    fireEvent.click(row!);

    expect(navigateSpy).toHaveBeenCalledWith('/task/pending');
    expect(screen.queryByTestId('todo-drawer')).toBeNull();
  });

  it('首页 MessageBoard 点第 2 条 → MessageDetailDrawer 打开且 messageId 是第 2 条的 id', async () => {
    // 两条消息，点第2 条：抽屉必须携带第2条的 id（不是固定值、也不是第 1 条）。
    vi.mocked(messagesApi.fetchInbox).mockResolvedValue({
      page: 1,
      size: 20,
      total: 2,
      list: [messageFixture('5001', '消息-甲'), messageFixture('5002', '消息-乙')],
    });
    renderPage();
    const row = (await screen.findByText('消息-乙')).closest('button');
    expect(row).toBeTruthy();
    fireEvent.click(row!);

    expect(await screen.findByTestId('message-drawer')).toBeTruthy();
    expect(screen.getByTestId('message-drawer').getAttribute('data-message')).toBe('5002');
    // 点消息不再统一跳收件箱
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('首页 ProcessBoard 点行 → TodoDetailDrawer 打开且 instanceId 为该流程实例 id', async () => {
    vi.mocked(workflowApi.fetchMyProcesses).mockResolvedValue({
      page: 1,
      size: 20,
      total: 1,
      list: [
        {
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
      ],
    });
    renderPage();
    // 行文本是 `${businessType} / ${businessId}`
    const row = (await screen.findByText('PURCHASE_ORDER / PO-001')).closest('button');
    expect(row).toBeTruthy();
    fireEvent.click(row!);

    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('首页三板「查看全部」跳转保持原样（pending / inbox / my-sent）', async () => {
    renderPage();
    await screen.findByText('你好，测试员');

    // 三块板各一个「查看全部」；逐个点，断言仍是原列表页路由。
    const all = await screen.findAllByText(/^查看全部$/);
    expect(all.length).toBe(3);
    fireEvent.click(all[0]);
    expect(navigateSpy).toHaveBeenCalledWith('/task/pending');
    fireEvent.click(all[1]);
    expect(navigateSpy).toHaveBeenCalledWith('/task/inbox');
    fireEvent.click(all[2]);
    expect(navigateSpy).toHaveBeenCalledWith('/task/my-sent');
    // 「查看全部」不该开抽屉
    expect(screen.queryByTestId('todo-drawer')).toBeNull();
    expect(screen.queryByTestId('message-drawer')).toBeNull();
  });
});
