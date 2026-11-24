import { cn } from '@/lib/utils';
import { INTRANET_ONLY_LABEL } from '@/lib/nav/intranet-app';

/** 仅内网应用的醒目标记（琥珀底，避免被当成「即将上线」灰字）。 */
export function IntranetOnlyBadge({
  className,
  compact = false,
}: {
  className?: string;
  /** 切换 APP 等窄位：右侧放「内网运行」，完整说明走 title */
  compact?: boolean;
}) {
  const text = compact ? '内网运行' : INTRANET_ONLY_LABEL;
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-4',
        'bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/40',
        'dark:text-amber-300',
        className,
      )}
      title={INTRANET_ONLY_LABEL}
    >
      {text}
    </span>
  );
}
