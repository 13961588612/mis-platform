import { cn } from '@/lib/utils';

/**
 * 未读状态圆点。
 *
 * <p>原先在inbox-page / header-toolkit / message-board 各写一份内联 span，统一到此处。
 * 已读渲染灰点（保留行内对齐），未读渲染醒目点。
 */
export function UnreadDot({
  read,
  className,
  unreadClassName = 'bg-primary',
}: {
  read: boolean;
  className?: string;
  /** 未读态圆点颜色（默认主色；收件箱用 destructive 更醒目）。 */
  unreadClassName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
        read ? 'bg-muted-foreground/25' : unreadClassName,
        className,
      )}
    />
  );
}