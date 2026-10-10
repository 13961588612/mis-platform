// @vitest-environment jsdom
/**
 * 门户三 Tab 容器测试（T01；UI 精修轮扩图标/药丸风格 + Tab store 桥接 + 首页板抽屉）。
 *
 * 覆盖：
 * 1. 「首页 / 待办事项 / 消息中心」三个 Tab 均渲染；
 * 2. **三Tab 均为「图标 + 文字」**（断言 lucide 渲染出的真实 `svg[data-testid]`，
 *    不只断文本——断文本锁不住「图标被删」的回归）；
 * 3. **药丸式样式的关键不变量**（本轮随实现更新，锁的是「切换 tab 零跳动」这件事）：
 *    白底 tab 栏（`bg-card`）+ 底部 1px 分隔线 + 左对齐；未选中为主色蓝文字、
 *    选中为浅灰药丸 + 深色文字；两态边框结构一致（完整 `border`）且**不依赖 `-mb-px`
 *    压盖**；`TabsList` 必须含 `h-auto` 且不含 `h-9`（防「药丸溢出栏顶/底边」的回归）；
 *    tab 上不渲染关闭按钮；
 * 4. 默认选中「首页」，且首页内容（欢迎语 + 工作台板块 + AppRail）与现状一致；
 * 5. 点击「待办事项」→ 切到 Todo 壳（首页内容卸载）；点击「消息中心」→ 切到 Message 壳；
 * 6. **不发生路由跳转**：Tab 切换纯本地态（store），`useNavigate` 不被调用、pathname 不变。
 *    （核心红线：三 Tab 绝不入 URL，规避 keep-alive `PAGE_MAP`/`useParams` 坑。）
 * 7. **外部 `setActiveTab('message')` 能驱动门户切页签**（顶栏「打开消息中心」的桥接契约：
 *    layout 侧只写 store，门户页必须即时响应）。
 * 8. **T05 集成**：两抽屉可开——待办点行开待办抽屉（携 instanceId）、消息点行开消息抽屉（携 messageId）。
 *    抽屉以轻量替身替换（其内部行为由 `todo-tabs.test.tsx` / `message-reply-drawer.test.tsx` 覆盖）。
 * 9. **首页三板点行改开抽屉**（取代路由跳转）：TaskBoard/ProcessBoard → TodoDetailDrawer、
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

  it('渲染「首页 / 待办事项 / 消息中心」三个 Tab', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: '首页' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '待办事项' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '消息中心' })).toBeTruthy();
  });

  it('三个 Tab 均为「图标 + 文字」药丸式风格（断言真实 svg，不只断文本）', async () => {
    renderPage();
    const home = await screen.findByRole('tab', { name: '首页' });
    const todo = screen.getByRole('tab', { name: '待办事项' });
    const msg = screen.getByRole('tab', { name: '消息中心' });

    /**
     * 把 className 拆成**精确的类名 token 集合**。
     *
     * <p>🔴 必须按 token 判等、不能用 `className.toContain(...)` 子串匹配：
     * `border-transparent` 里**包含**子串 `border-t`；`data-[state=active]:border-border`
     * 里包含 `border-border`…子串匹配会让「有 `border-t`」这种断言假阳性通过，
     * 也会让「不含 `border-t`」假失败（上一轮就踩过这个坑）。
     */
    const classesOf = (el: Element): Set<string> => new Set(el.className.split(/\s+/).filter(Boolean));

    // lucide 渲染出的真实 <svg>（tagName 断言可防「用 div 假冒图标」的假绿）。
    for (const [tab, testid] of [
      [home, 'portal-tab-icon-home'],
      [todo, 'portal-tab-icon-todo'],
      [msg, 'portal-tab-icon-message'],
    ] as const) {
      const icon = tab.querySelector(`[data-testid="${testid}"]`);
      expect(icon).toBeTruthy();
      expect(icon!.tagName.toLowerCase()).toBe('svg');
      // 图标必须与文字同色（继承 currentColor）→ 靠 text- 类而非固定 fill。
      expect(icon!.getAttribute('fill')).toBe('none');
      // 药丸式风格：四角圆角（项目基线 4px = `rounded`），不是方角。
      const cls = classesOf(tab);
      expect(cls.has('rounded')).toBe(true);
      expect(cls.has('rounded-none')).toBe(false);
      expect(cls.has('rounded-t')).toBe(false);
    }

    // ---- 两态盒高/盒宽一致性不变量（切换 tab 零跳动）----
    // 药丸方案**不依赖** `-mb-px` 压盖：完整 `border`（四边）+ 相同 padding 全部挂在
    // 基类上，active 变体只改「边框颜色 / 背景 / 文字色 / 去投影」这些**不影响盒模型**的声明。
    // 一旦被改回「未选中无下边框 / 只 active 带 -mb-px」，两态盒高就会差 1~2px 而在切换时跳动。
    for (const tab of [home, todo, msg]) {
      const cls = classesOf(tab);
      // 两态共有：完整四边框 + 透明边框色（active 只把颜色换成 border-border）
      expect(cls.has('border')).toBe(true);
      expect(cls.has('border-transparent')).toBe(true);
      expect(cls.has('data-[state=active]:border-border')).toBe(true);
      // 两态共有：相同 padding 与字号（盒高 = 内容行高 + py-2 + 上下 border）
      expect(cls.has('px-3.5')).toBe(true);
      expect(cls.has('py-2')).toBe(true);
      expect(cls.has('text-[13px]')).toBe(true);
      // 不再依赖负外边距压盖 TabsList 的 border-b
      expect(cls.has('-mb-px')).toBe(false);
      // 旧的「白卡 + 无缝相连」结构（边框有缺口/ 只 active 带负外边距）必须已被清除。
      // 逐个 token 判不存在，而不是子串匹配。
      for (const stale of [
        'border-x',
        'border-t',
        'border-b',
        'border-b-0',
        'border-l',
        'border-r',
        'data-[state=active]:rounded-t',
        'data-[state=active]:bg-card',
        'data-[state=active]:text-primary',
      ]) {
        expect(cls.has(stale)).toBe(false);
      }
    }

    // 未选中态：主色蓝文字（`--primary` ≈ #4f46e5，像链接色）+ 透明背景
    expect(classesOf(todo).has('text-primary')).toBe(true);
    expect(home.getAttribute('data-state')).toBe('active');
    expect(todo.getAttribute('data-state')).toBe('inactive');
    expect(msg.getAttribute('data-state')).toBe('inactive');

    // 选中态：浅灰药丸 `bg-muted` + 深色文字 + 去投影（不是白卡）
    const activeCls = classesOf(home);
    expect(activeCls.has('data-[state=active]:bg-muted')).toBe(true);
    expect(activeCls.has('data-[state=active]:text-foreground')).toBe(true);
    expect(activeCls.has('data-[state=active]:shadow-none')).toBe(true);

    // TabsList：白底 + 底部 1px 分隔线 + 左对齐；且必须解除共享组件基类的 h-9 固定高
    // （否则药丸会溢出栏的顶/底边）。
    const list = home.closest('[role="tablist"]');
    expect(list).toBeTruthy();
    const listCls = classesOf(list!);
    expect(listCls.has('h-auto')).toBe(true);
    expect(listCls.has('h-9')).toBe(false);
    expect(listCls.has('bg-card')).toBe(true);   // 白底，不是灰底
    expect(listCls.has('bg-muted')).toBe(false);
    expect(listCls.has('bg-muted/50')).toBe(false);
    expect(listCls.has('border-b')).toBe(true);  // 1px 分隔线贯通整行
    expect(listCls.has('justify-start')).toBe(true); // tab 左对齐
    // 新样式下不再用 items-end 底对齐去掩盖溢出
    expect(listCls.has('items-end')).toBe(false);

    // tab 不可关闭：不渲染任何关闭按钮（×）——参考图有，但需求明确要求不做。
    for (const tab of [home, todo, msg]) {
      expect(tab.querySelector('button')).toBeNull();
    }
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

  it('点击「待办事项」切到 Todo（真实组件），首页内容卸载', async () => {
    renderPage();
    await screen.findByText('你好，测试员');

    // Radix Tabs Trigger 在 onMouseDown 上激活（click 不触发），故用 mouseDown。
    fireEvent.mouseDown(screen.getByRole('tab', { name: '待办事项' }), { button: 0 });

    // T03a 起「待办事项」为真实组件：以搜索框 + 子 Tab 作为挂载标志。
    expect(await screen.findByLabelText('待办关键词')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '待处理' })).toBeTruthy();
    expect(screen.queryByText('你好，测试员')).toBeNull();
  });

  it('点击「消息中心」切到 Message（真实组件），首页内容卸载', async () => {
    renderPage();
    await screen.findByText('你好，测试员');

    fireEvent.mouseDown(screen.getByRole('tab', { name: '消息中心' }), { button: 0 });

    // T04 起「消息中心」为真实组件：以搜索框 + 四类子 Tab 作为挂载标志。
    expect(await screen.findByLabelText('消息关键词')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '审批' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '系统告警' })).toBeTruthy();
    expect(screen.queryByLabelText('待办关键词')).toBeNull();
    expect(screen.queryByText('你好，测试员')).toBeNull();
  });

  it('Tab 切换不发生路由跳转（useNavigate 未被调用、不新增路由）', async () => {
    renderPage();
    await screen.findByText('你好，测试员');

    fireEvent.mouseDown(screen.getByRole('tab', { name: '待办事项' }), { button: 0 });
    fireEvent.mouseDown(screen.getByRole('tab', { name: '消息中心' }), { button: 0 });
    fireEvent.mouseDown(screen.getByRole('tab', { name: '首页' }), { button: 0 });
    await screen.findByText('你好，测试员');

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
    renderPage();
    await screen.findByText('你好，测试员');

    // 待办 Tab：点行 → 待办抽屉打开，携带该行 instanceId（不由 navigate 承担）。
    fireEvent.mouseDown(screen.getByRole('tab', { name: '待办事项' }), { button: 0 });
    const todoRow = (await screen.findByText('采购单审批-甲')).closest('button');
    expect(todoRow).toBeTruthy();
    fireEvent.click(todoRow!);
    expect(await screen.findByTestId('todo-drawer')).toBeTruthy();
    expect(screen.getByTestId('todo-drawer').getAttribute('data-instance')).toBe('128');
    expect(navigateSpy).not.toHaveBeenCalled();

    // 消息 Tab：切过去后待办抽屉随面板卸载；点消息行 → 消息抽屉打开，携带 messageId。
    fireEvent.mouseDown(screen.getByRole('tab', { name: '消息中心' }), { button: 0 });
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
    expect(screen.getByRole('tab', { name: '消息中心' }).getAttribute('data-state')).toBe('active');
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
