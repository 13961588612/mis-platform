import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 统一空态：图标 + 主副文案 + 可选操作。
 *
 * <p>原先各列表页各写一份「图标 + 文案」的内联 div（inbox-page / task-list-page /
 * my-sent-page / task-board / message-board / process-board），统一到此处。
 * 默认高度 `h-40` 与既有列表页一致，加载态同高，避免切换时跳动。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** compact 用 h-28（看板卡片内），否则 h-40（整页列表）。 */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 text-center',
        compact ? 'h-28' : 'h-40',
        className,
      )}
    >
      {icon ? <span className="text-muted-foreground/60">{icon}</span> : null}
      <p className={cn('text-sm', icon ? 'text-[13px] text-muted-foreground' : 'text-muted-foreground')}>
        {title}
      </p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

/** 加载态占位：与 {@link EmptyState} 同高，保证列表区高度稳定不跳动。 */
export function ListLoading({ label = '加载中…', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center text-sm text-muted-foreground',
        compact ? 'h-28' : 'h-40',
      )}
    >
      {label}
    </div>
  );
}

/** 错误态：文案 + 重试。 */
export function ListError({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center text-sm text-destructive',
        compact ? 'h-28' : 'h-40',
      )}
    >
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="text-[12px] underline" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}