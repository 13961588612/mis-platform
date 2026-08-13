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
  /** 展示用任职部门名（loader 附带，避免只读视图显示 id） */
  deptLabel?: string;
  /** 展示用任职岗位名（loader 附带，避免只读视图显示 id） */
  postLabel?: string;
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
  /**
   * 选项数据源标记：
   * - 'dept'：与「部门管理」页同源（真实 sys_dept，由 AdminPageDef.deptOptionsLoader 提供）。
   *   select 字段 → 替换 options；assignments 字段 → 替换 deptOptions。
   * - 'post'：真实 sys_post（由 AdminPageDef.postOptionsLoader 提供），select → options。
   * - 'post-type'：真实 sys_post_type（由 AdminPageDef.postTypeOptionsLoader 提供），select → options。
   * 加载失败/为空时回退空数组。
   */
  optionsFrom?: 'dept' | 'post' | 'post-type';
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
  /** 本地示例数据（仅兜底/无 loader 时使用；真实页面接入 loader 后不再提供） */
  sample?: Record<string, unknown>[];
  /** 派生展示字段 */
  decorate?: (row: Record<string, unknown>) => Record<string, unknown>;
  /** 真实数据加载（接入 API 时用）；提供时引擎首屏展示骨架并异步加载，否则用 sample */
  loader?: () => Promise<Record<string, unknown>[]>;
  /**
   * 部门可选项加载器（与「部门管理」同源，真实 sys_dept，value=id、label=name）。
   * 提供时引擎挂载即拉取，并注入到 optionsFrom:'dept' 的字段；失败/为空回退空数组。
   */
  deptOptionsLoader?: () => Promise<FieldOption[]>;
  /**
   * 岗位可选项加载器（真实 sys_post）。提供时引擎挂载即拉取，并注入到
   * optionsFrom:'post' 的字段与 assignments 的 postOptions；失败/为空回退空数组。
   */
  postOptionsLoader?: () => Promise<FieldOption[]>;
  /**
   * 岗位类型可选项加载器（真实 sys_post_type）。提供时引擎挂载即拉取，并注入到
   * optionsFrom:'post-type' 的字段；失败/为空回退空数组。
   */
  postTypeOptionsLoader?: () => Promise<FieldOption[]>;
  /**
   * 新增回调（真实 CRUD）。提供时 saveForm（create 模式）调 API 成功后 reload；
   * 未提供保持本地行为。抛错时引擎 toast 展示错误信息。
   */
  createApi?: (values: Record<string, unknown>) => Promise<unknown>;
  /** 编辑回调（真实 CRUD）。提供时 saveForm（edit 模式）调 API 成功后 reload。 */
  updateApi?: (id: string, values: Record<string, unknown>) => Promise<unknown>;
  /** 删除回调（真实 CRUD）。提供时 removeRow 调 API 成功后 reload。 */
  deleteApi?: (id: string) => Promise<unknown>;
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
