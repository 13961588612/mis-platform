import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  /** `sm` ≈ 默认视觉尺寸的一半（用于指标密集页）。 */
  size?: 'default' | 'sm';
  className?: string;
}

export function StatCard({
  label,
  value,
  description,
  icon: Icon,
  size = 'default',
  className,
}: StatCardProps) {
  const compact = size === 'sm';
  return (
    <Card
      className={cn(
        'relative shadow-card transition-shadow hover:shadow-card-hover',
        compact ? 'px-2 py-2' : 'px-4 py-4',
        className,
      )}
    >
      <div className={cn('flex items-start justify-between', compact ? 'gap-1.5' : 'gap-3')}>
        <div className="min-w-0">
          <p className={cn('text-muted-foreground', compact ? 'text-[10px] leading-tight' : 'text-xs')}>
            {label}
          </p>
          <p
            className={cn(
              'font-semibold leading-none tracking-tight',
              compact ? 'mt-1 text-base' : 'mt-2 text-2xl',
            )}
          >
            {value}
          </p>
          {description ? (
            <p
              className={cn(
                'text-muted-foreground',
                compact ? 'mt-1 text-[10px]' : 'mt-2 text-xs',
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full bg-[hsl(var(--icon-badge-bg))] text-[hsl(var(--icon-badge-fg))]',
            compact ? 'h-5 w-5' : 'h-9 w-9',
          )}
        >
          <Icon className={compact ? 'h-2.5 w-2.5' : 'h-4 w-4'} />
        </div>
      </div>
    </Card>
  );
}
