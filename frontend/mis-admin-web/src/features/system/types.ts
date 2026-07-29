export type FieldType = 'text' | 'number' | 'select' | 'textarea' | 'switch';

export interface FieldOption {
  label: string;
  value: string | number;
}

export interface AdminField {
  key: string;
  label: string;
  type?: FieldType;
  col?: 2 | 3 | 4 | 6 | 12;
  required?: boolean;
  placeholder?: string;
  options?: FieldOption[];
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
}
