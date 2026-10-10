/**
 * 门户视图模型（T01 定义类型；T03a 接入数据，见 §1.4）。
 *
 * <p>设计依据 `docs/design/portal-restructure-design.md` §1.4：六类待办背后是三个异构接口
 * （`/tasks/my`、`/tasks/handled`、`/workflow/instances/my`），字段结构不同
 * （`TaskItem` vs `WfInstance`）。`PortalTodoRow` 是二者的**统一行视图模型**，
 * 只保留列表行真正需要的字段——二者并集里「行渲染真正用到」的部分；
 * 缺失字段一律为 `null`/`undefined`（**不强行补全不存在的字段**），由 T03a 的数据源
 * 适配器（`lib/todo-adapters.ts`）填入，行渲染按类型降级。
 *
 * <p><b>T03a 调整说明</b>：
 * <ul>
 *   <li>ID 字段（`instanceId`/`sysTaskId`/`wfTaskId`）由 `number | null` 收敛为
 *       `string | null` —— 与前端全局 ID 约定一致（`TaskItem.id`、`WfInstance.id`、
 *       `wfInstanceId()` 均返回 `string`；路由跳转亦用 string），避免无意义的 string↔number 互转。</li>
 *   <li>新增 `subtitle?`：承载设计 §1.4 所列的「业务类型/编号」等副标题信息
 *       （各适配器按源拼装），避免在视图层二次解析 `raw`。</li>
 * </ul>
 */
export interface PortalTodoRow {
  /** 行主键（列表 key 用），形如 `sys-<id>` / `wf-<id>`，避免不同源 id 冲突。 */
  key: string;
  /** 主标题：待办源取 `bizTitle`；我发起的源取 `businessType / businessId`。 */
  title: string;
  /** 副标题：业务类型/编号（待办源）或流程编码/表单（我发起的源）。 */
  subtitle?: string;
  /** 业务/流程状态原始值（`PENDING` / `APPROVING` / `APPROVED` / `REJECTED` / `RUNNING` …）。 */
  status?: string;
  /** 发起人（仅「我发起的」源有）。 */
  initiatorName?: string;
  /** 处理人（仅待办源有）。 */
  assigneeName?: string;
  /** 创建时间（ISO 字符串）。 */
  createdAt?: string;
  /**
   * 关联流程实例 ID。
   *
   * <p>`my`/`handled` 源经 `wfInstanceId(item)`（`lib/api/wf-instance.ts`）从
   * `sys_task.metadata`（`wfInstanceId`）解析；无实例线索时降级为 `null`（行仍展示）。
   */
  instanceId: string | null;
  /** 关联 `sys_task.id`，供抽屉「转办」使用（`my`/`handled` 源直接取 `TaskItem.id`）。 */
  sysTaskId: string | null;
  /** 当前用户在该实例上的 `wf_task.id`，由抽屉加载 `ProcessDetail` 后回填（见设计 §2.2，T03b）。 */
  wfTaskId: string | null;
  /** 子 Tab 分类键（如 `pending`/`approving`/`mySent`/`myHandled` …），供列表渲染与动作判定。 */
  category?: string;
  /** 原始接口载荷，保留以便抽屉按源做二次解析。 */
  raw: unknown;
}

/** 三类数据源标识，对应设计 §1.4 的三条既有接口。 */
export type PortalTodoSource = 'my' | 'handled' | 'sent';
