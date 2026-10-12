import type { PortalTodoSource } from '../types';
import type { TodoTabKey } from '@/stores/portal-todo-tab-store';

/**
 * 待办子 Tab 配置（设计 §1.4 表格 + 本轮新增「全部」，字面独立、不合并）。
 *
 * <p>每个配置驱动一套「数据源适配 + 列表渲染」；`PortalTodoTab` 用一个组件 +
 * 本配置数组渲染全部子 Tab，避免多份复制粘贴。
 *
 * <p><b>D-6 遵循</b>：各状态类字面独立，不存在「待处理含审批中」的合并——
 * `pending` 与 `approving` 各自带独立 `status`。
 *
 * <p><b>本轮新增「全部」（首项、默认选中）</b>：`source='matters'` 走
 * `/tasks/matters`（三源 UNION 的服务端聚合，非前端合并），`status` 不传。
 */
export interface TodoTabConfig {
  /**
   * 子 Tab 键（稳定标识，用作 `Tabs` value 与 `category` 回填）。
   *
   * <p>类型取自 `stores/portal-todo-tab-store.ts` 的 {@link TodoTabKey}：子 Tab 的
   * 激活态已提升到那个 store（首页板块要能切到指定子 Tab），键的字面量集合必须
   * 与 store 同源。依赖方向保持 feature → stores，不反过来。
   */
  key: TodoTabKey;
  /** 子 Tab 文案。 */
  label: string;
  /** 数据源：`matters`→`/tasks/matters`、`my`→`/tasks/my`、`handled`→`/tasks/handled`、`sent`→`/workflow/instances/my`。 */
  source: PortalTodoSource;
  /** 传给 `my` 源的 `status`；`matters`/`sent`/`handled` 源不带（故可选）。 */
  status?: string;
}

export const TODO_TABS: TodoTabConfig[] = [
  { key: 'all', label: '全部', source: 'matters' },
  { key: 'pending', label: '待处理', source: 'my', status: 'PENDING' },
  { key: 'approving', label: '审批中', source: 'my', status: 'APPROVING' },
  { key: 'approved', label: '已通过', source: 'my', status: 'APPROVED' },
  { key: 'rejected', label: '已驳回', source: 'my', status: 'REJECTED' },
  { key: 'mySent', label: '我发起的', source: 'sent' },
  { key: 'myHandled', label: '我审批的', source: 'handled' },
];

// 默认子 Tab 常量 `DEFAULT_TODO_TAB_KEY` **不再由本文件导出**：子 Tab 激活态提升到
// `stores/portal-todo-tab-store.ts` 后，默认值也随状态搬到那里单点定义
// （避免「TODO_TABS[0].key」与 store 初值两处各写一个字面量而漂移）。
// 本文件的 `TODO_TABS[0].key` 仍必须与 `DEFAULT_TODO_TAB_KEY` 一致（本轮为 `'all'`），
// 由 `__tests__/todo-tabs.test.tsx` 的「默认键对齐」用例断言兜底。
