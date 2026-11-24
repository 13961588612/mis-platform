import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** micro-app 首次拉取 / 启动时的过场遮罩（进度为生命周期推演，非真实字节）。 */
export function MicroAppLoadCurtain({
  visible,
  error,
  progress,
  title,
  hint,
  onRetry,
}: {
  visible: boolean;
  error: boolean;
  progress: number;
  title: string;
  hint: string;
  onRetry: () => void;
}) {
  if (!visible) return null;
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div
      className={cn(
        'absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-background/95 px-6',
        'animate-in fade-in duration-200',
      )}
      role="status"
      aria-live="polite"
      aria-busy={!error}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        {error ? null : <Loader2 className="h-7 w-7 animate-spin text-primary" />}
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{error ? '应用加载失败，请重试' : hint}</p>
      </div>
      {error ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" />
          重新加载
        </Button>
      ) : (
        <div className="w-64 max-w-[70vw]">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-center text-[11px] tabular-nums text-muted-foreground">{pct}%</p>
        </div>
      )}
    </div>
  );
}
