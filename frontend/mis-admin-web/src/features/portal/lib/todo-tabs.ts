import type { PortalTodoSource } from '../types';

/**
 * 待办六类子 Tab 配置（设计 §1.4 表格，字面独立、不合并）。
 *
 * <p>每个配置驱动一套「数据源适配 + 列表渲染」；`PortalTodoTab` 用一个组件 +
 * 本配置数组渲染六类，避免六份复制粘贴。
 *
 * <p><b>D-6 遵循</b>：六类字面独立，不存在「待处理含审批中」的合并——
 * `pending` 与 `approving` 各自带独立 `status`。
 */
export interface TodoTabConfig {
  /** 子 Tab 键（稳定标识，用作 `Tabs` value 与 `category` 回填）。 */
  key: string;
  /** 子 Tab 文案。 */
  label: string;
  /** 数据源：`my`→`/tasks/my`、`handled`→`/tasks/handled`、`sent`→`/workflow/instances/my`。 */
  source: PortalTodoSource;
  /** 传给 `my` 源的 `status`；`sent`/`handled` 源不带（故可选）。 */
  status?: string;
}

export const TODO_TABS: TodoTabConfig[] = [
  { key: 'pending', label: '待处理', source: 'my', status: 'PENDING' },
  { key: 'approving', label: '审批中', source: 'my', status: 'APPROVING' },
  { key: 'approved', label: '已通过', source: 'my', status: 'APPROVED' },
  { key: 'rejected', label: '已驳回', source: 'my', status: 'REJECTED' },
  { key: 'mySent', label: '我发起的', source: 'sent' },
  { key: 'myHandled', label: '我审批的', source: 'handled' },
];

/** 默认子 Tab（首个：待处理）。 */
export const DEFAULT_TODO_TAB_KEY = TODO_TABS[0].key;
