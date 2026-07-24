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
}
