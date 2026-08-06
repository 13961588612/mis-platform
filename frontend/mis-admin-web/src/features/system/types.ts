export type FieldType = 'text' | 'number' | 'select' | 'multiselect' | 'assignments' | 'textarea' | 'switch';

export interface FieldOption {
  label: string;
  value: string | number;
}

/** 任职记录：一行 = 任职部门 + 任职岗位 + 任职开始时间 + 是否主职 */
export interface Assignment {
  dept: string;
  post: string;
  startDate?: string;
  /** 是否主职（主部门由此派生）；同一员工仅一行可为 true */
  isPrimary?: boolean;
}

export interface AdminField {
  key: string;
  label: string;
  type?: FieldType;
  col?: 2 | 3 | 4 | 6 | 12;
  required?: boolean;
  placeholder?: string;
  options?: FieldOption[];
  /** multiselect 专用：提示文案（如「首个为默认」） */
  hint?: string;
  /** assignments 专用：可选项（部门 / 岗位），用于行内下拉 */
  deptOptions?: FieldOption[];
  postOptions?: FieldOption[];
}

export interface AdminColumn {
  key: string;
  label: string;
  /** 渲染为状态徽标（读 status + statusText） */
  status?: boolean;
  /** 渲染为标签簇：值为 string[] 时，首项填充色、其余描边色 */
  tags?: boolean;
}

export interface AdminPageDef {
  id: string;
  group: string;
  title: string;
  description: string;
  readonly?: boolean;
  filters?: AdminField[];
  columns: AdminColumn[];
  form: AdminField[];
  sample: Record<string, unknown>[];
  /** 派生展示字段 */
  decorate?: (row: Record<string, unknown>) => Record<string, unknown>;
  /** 真实数据加载（接入 API 时用）；提供时引擎首屏展示骨架并异步加载，否则用 sample */
  loader?: () => Promise<Record<string, unknown>[]>;
  /** 结果区视图：'table'（默认，标准表格）或 'cards'（卡片网格，与表格范式拉开差异） */
  view?: 'table' | 'cards';
  /**
   * 主表行高密度。`compact` 对齐组织管理页（表头/表行 `py-2`）；
   * 默认略高（表头内层 py-2.5 + 表行 py-[0.7rem]）。
   */
  tableDensity?: 'default' | 'compact';
  /** 详情 Sheet 额外行（如多值标签簇）：返回 DefItem[]，追加在表单派生行之后 */
  detailExtra?: (row: Record<string, unknown>) => import('@/components/common/detail-def-list').DefItem[];
}
