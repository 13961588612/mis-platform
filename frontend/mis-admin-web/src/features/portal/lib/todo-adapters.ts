import type { TaskItem } from '@/lib/api/tasks';
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
    // 待办源：处理人即当前用户；发起人不在 TaskItem 上（缺失，不臆造）。
    assigneeName: item.assigneeName ?? undefined,
    createdAt: item.createdAt,
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

/** `sent` 源（`/workflow/instances/my`：我发起的）→ 统一行。 */
export function fromWfInstance(inst: WfInstance): PortalTodoRow {
  return {
    key: `wf-${inst.id}`,
    title: `${inst.businessType} / ${inst.businessId}`,
    subtitle: `${inst.definitionCode} · 表单 ${inst.startedFormCode ?? '-'}`,
    status: inst.status,
    initiatorName: inst.initiatorName ?? undefined,
    createdAt: inst.createdAt,
    instanceId: inst.id,
    sysTaskId: null,
    wfTaskId: null,
    category: 'mySent',
    raw: inst,
  };
}
