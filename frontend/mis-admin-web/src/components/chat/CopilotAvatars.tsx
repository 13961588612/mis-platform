/**
 * Copilot 对话头像（对齐 agent/ai-platform/frontend）。
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import assistantAvatarUrl from '@/assets/assistant-avatar.jpg';

export function AssistantAvatar({
  className,
  label = '智能助手',
}: {
  className?: string;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        'h-9 w-9 shrink-0 overflow-hidden rounded-full bg-background shadow-sm ring-2 ring-background',
        className,
      )}
      role="img"
      aria-label={label}
    >
      {failed ? (
        <div className="flex h-full w-full items-center justify-center bg-primary/15 text-xs font-semibold text-primary">
          AI
        </div>
      ) : (
        <img
          src={assistantAvatarUrl}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover object-top"
        />
      )}
    </div>
  );
}

export function UserAvatar({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  const initial = (name ?? '').trim().slice(0, 1).toUpperCase() || '我';
  return (
    <div
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-sm ring-2 ring-background',
        className,
      )}
      role="img"
      aria-label={name?.trim() || '用户'}
    >
      {initial}
    </div>
  );
}
