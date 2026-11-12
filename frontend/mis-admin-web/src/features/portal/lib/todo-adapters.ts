import type { PortalMatterItem, TaskItem } from '@/lib/api/tasks';
import type { WfInstance } from '@/lib/api/workflow';
import { wfInstanceId } from '@/lib/api/wf-instance';
import type { PortalTodoRow } from '../types';

/**
 * 数据源适配器（设计 §1.4）：把三个异构接口的返回映射为统一的 {@link PortalTodoRow}。
 *
 * <p>映射纪律：
 * <ul>
 *   <li>`instanceId` 经 {@link wfInstanceId} 从 `sys_task.metadata`（脏 JSON）解析；
 *       **解析不到即 `null`**（行仍展示，仅点击时降级提示，不臆造）。</li>
 *   <li>`sysTaskId` 取 `TaskItem.id`；`wfTaskId` 待抽屉加载 `ProcessDetail` 后回填
 *       （T03b），本阶段一律 `null`。</li>
 *   <li>缺失字段一律 `null`/`undefined`，不做默认值填充。</li>
 * </ul>
 */

/** `my` 源（`/tasks/my`：待处理 / 审批中 / 已通过 / 已驳回）→ 统一行。 */
export function fromTaskItem(item: TaskItem, opts?: { category?: string }): PortalTodoRow {
  return {
    key: `sys-${item.id}`,
    title: item.bizTitle,
    subtitle: `${item.bizType} / ${item.bizRefId}`,
    status: item.status,
    // 待办源：处理人即当前用户；发起人由后端经关联 wf_instance 回填。
    initiatorName: item.initiatorName ?? undefined,
    initiatorOrgName: item.initiatorOrgName ?? undefined,
    assigneeName: item.assigneeName ?? undefined,
    createdAt: item.createdAt,
    appCode: item.appCode,
    bizType: item.bizType,
    instanceId: wfInstanceId(item),
    sysTaskId: item.id,
    wfTaskId: null,
    category: opts?.category,
    raw: item,
  };
}

/** `handled` 源（`/tasks/handled`：我审批的）→ 统一行。 */
export function fromHandledTask(item: TaskItem): PortalTodoRow {
  return fromTaskItem(item, { category: 'myHandled' });
}

/** `cc` 源（`/tasks/cc`：抄送我的，只读）→ 统一行。 */
export function fromCcTask(item: TaskItem): PortalTodoRow {
  return fromTaskItem(item, { category: 'cc' });
}

/** `sent` 源（`/workflow/instances/my`：我发起的）→ 统一行。 */
export function fromWfInstance(inst: WfInstance): PortalTodoRow {
  return {
    key: `wf-${inst.id}`,
    title: inst.title?.trim() || `${inst.businessType} / ${inst.businessId}`,
    subtitle: `${inst.definitionCode} · 表单 ${inst.startedFormCode ?? '-'}`,
    status: inst.status,
    initiatorName: inst.initiatorName ?? undefined,
    initiatorOrgName: inst.initiatorOrgName ?? undefined,
    createdAt: inst.createdAt,
    // 「我发起的」源：业务类型取 `businessType`（实例无独立 bizType 字段）。
    appCode: inst.appCode,
    bizType: inst.businessType,
    instanceId: inst.id,
    sysTaskId: null,
    wfTaskId: null,
    category: 'mySent',
    raw: inst,
  };
}

/**
 * `matters` 源（`/tasks/matters`：三源 UNION 聚合「全部」）→ 统一行。
 *
 * <p>列已在后端归一（TASK/INSTANCE 两支投影为同名输出列），故本适配器是**纯映射**：
 * 后端给什么用什么，不做二次解析、不臆造缺失字段。
 * `key` 加 `kind` 前缀（`task-`/`instance-`），避免同 id 的 TASK 行与 INSTANCE 行 key 冲突
 * （设计 §8.1：重叠行**字面保留两行**）。
 * `category` 直接取 VO（TASK=其 `status` 字面；INSTANCE=`'mySent'`，主理人裁定#3）。
 */
export function fromPortalMatter(item: PortalMatterItem): PortalTodoRow {
  return {
    key: `${item.kind.toLowerCase()}-${item.id}`,
    title: item.title,
    subtitle: item.subtitle,
    status: item.status,
    initiatorName: item.initiatorName ?? undefined,
    initiatorOrgName: item.initiatorOrgName ?? undefined,
    assigneeName: item.assigneeName ?? undefined,
    createdAt: item.createdAt,
    appCode: item.appCode,
    bizType: item.bizType,
    instanceId: item.instanceId,
    sysTaskId: item.sysTaskId,
    wfTaskId: null,
    category: item.category,
    raw: item,
  };
}
