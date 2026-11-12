/**
 * Copilot / Embed 标题栏「当前用户」展示（读 auth-store.user）。
 * 管理台登录与嵌入 hydrate 后均可显示；未就绪时不占位。
 */

import { useAuthStore } from '@/stores/auth-store';
import { UserAvatar } from '@/components/chat/CopilotAvatars';
import { cn } from '@/lib/utils';

export function useCopilotUserLabel(): string | null {
  return useAuthStore((s) => {
    const name = (s.user?.realName || s.user?.username || '').trim();
    return name || null;
  });
}

export function CopilotCurrentUser({
  className,
  compact = false,
}: {
  className?: string;
  /** 仅头像 + 短名（标题栏右侧）。 */
  compact?: boolean;
}) {
  const label = useCopilotUserLabel();
  if (!label) return null;

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-muted-foreground',
        compact ? 'max-w-[9rem]' : 'max-w-[14rem]',
        className,
      )}
      title={label}
      data-testid="copilot-current-user"
    >
      <UserAvatar name={label} className="h-6 w-6 text-[10px] ring-1" />
      <span className="truncate text-xs font-medium text-foreground/80">{label}</span>
    </div>
  );
}
