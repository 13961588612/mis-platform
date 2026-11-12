/**
 * 待办状态展示元数据（`sys_task.status` → 中文标签 + 配色 + 图标）。
 *
 * <p>原先只有 my-processed-page 内联一份映射，task-list-page 的已办态则直接渲染
 * 英文原始值（APPROVED / REJECTED），中文界面里很突兀。现统一到此处，两页共用。
 */
import { CheckCircle2, Clock, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TaskStatusMeta {
  text: string;
  cls: string;
  icon: LucideIcon;
}

export const TASK_STATUS: Record<string, TaskStatusMeta> = {
  PENDING: { text: '待处理', cls: 'bg-warning/10 text-warning', icon: Clock },
  APPROVING: { text: '审批中', cls: 'bg-info/10 text-info', icon: Clock },
  APPROVED: { text: '已通过', cls: 'bg-success/10 text-success', icon: CheckCircle2 },
  REJECTED: { text: '已驳回', cls: 'bg-destructive/10 text-destructive', icon: XCircle },
};

/** 已办态（无流程实例时）兜底：未知状态按「已通过」渲染，与 my-processed-page 同口径。 */
export function TaskStatusBadge({ status }: { status: string }) {
  const meta = TASK_STATUS[status] ?? TASK_STATUS.APPROVED;
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px]', meta.cls)}>
      <Icon className="h-3 w-3" />
      {meta.text}
    </span>
  );
}
