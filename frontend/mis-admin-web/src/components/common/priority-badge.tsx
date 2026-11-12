/**
 * 待办优先级展示：`sys_task.priority`（1 低 / 2 普通 / 3 高 / 4 紧急）。
 *
 * <p>原先在 task-board / task-list-page 各存一份映射，现统一到此处。
 */
import { cn } from '@/lib/utils';

export const PRIORITY_META: Record<number, { text: string; cls: string }> = {
  4: { text: '紧急', cls: 'bg-destructive/10 text-destructive' },
  3: { text: '高', cls: 'bg-warning/10 text-warning' },
  2: { text: '普通', cls: 'bg-info/10 text-info' },
  1: { text: '低', cls: 'bg-muted text-muted-foreground' },
};

export function priorityMeta(priority: number): { text: string; cls: string } {
  return PRIORITY_META[priority] ?? PRIORITY_META[1];
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: number;
  className?: string;
}) {
  const meta = priorityMeta(priority);
  return (
    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', meta.cls, className)}>
      {meta.text}
    </span>
  );
}