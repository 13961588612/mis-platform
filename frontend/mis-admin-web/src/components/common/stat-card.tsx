import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  className?: string;
}

export function StatCard({ label, value, description, icon: Icon, className }: StatCardProps) {
  return (
    <Card
      className={cn(
        'relative px-4 py-4 shadow-card transition-shadow hover:shadow-card-hover',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold leading-none tracking-tight">{value}</p>
          {description ? <p className="mt-2 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--icon-badge-bg))] text-[hsl(var(--icon-badge-fg))]">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}
