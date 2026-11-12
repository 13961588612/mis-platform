import type { TaskItem } from '@/lib/api/tasks';

/**
 * 从 `sys_task.metadata` 解析关联的流程实例 ID。
 *
 * <p>原先在 task-board.tsx / task-list-page.tsx / my-processed-page.tsx
 * 三处各写一份 try-parse，统一到此处。metadata 是脏 JSON，解析失败一律按「无关联流程」处理。
 */
export function wfInstanceId(item: Pick<TaskItem, 'metadata'>): string | null {
  if (!item.metadata) return null;
  try {
    const parsed = JSON.parse(item.metadata) as { wfInstanceId?: number | string };
    return parsed.wfInstanceId != null ? String(parsed.wfInstanceId) : null;
  } catch {
    return null;
  }
}