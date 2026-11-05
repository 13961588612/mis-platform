import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, FileBarChart2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { fetchAiReportCatalog, type AiReportCatalogGroup } from '@/lib/api/ai-report';
import { useChatStore } from '@/stores/chat-store';
import { openReportParamCard } from './open-report-param-card';

export interface ReportCatalogBarProps {
  disabled?: boolean;
  className?: string;
}

/**
 * Copilot 输入框上方：
 * 图标 +「模板报告：」+ 分组标签横排；点击标签弹出纵向子报告菜单。
 */
export function ReportCatalogBar({ disabled, className }: ReportCatalogBarProps) {
  const [groups, setGroups] = useState<AiReportCatalogGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [preparingCode, setPreparingCode] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<number | null>(null);

  const sessionId = useChatStore((s) => s.sessionId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAiReportCatalog();
      setGroups(Array.isArray(data) ? data.filter((g) => (g.reports?.length ?? 0) > 0) : []);
    } catch (e) {
      setGroups([]);
      if (import.meta.env.DEV) {
        console.warn('[ReportCatalogBar] catalog failed', e);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openReport = async (reportCode: string): Promise<void> => {
    if (disabled || preparingCode) return;
    const sid = useChatStore.getState().sessionId;
    if (!sid) {
      toast.error('会话尚未就绪，请稍后再试');
      return;
    }
    setPreparingCode(reportCode);
    setOpenGroupId(null);
    try {
      await openReportParamCard(sid, reportCode);
    } finally {
      setPreparingCode(null);
    }
  };

  if (!loading && groups.length === 0) {
    return null;
  }

  return (
    <div className={cn('mb-2 flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      <FileBarChart2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 text-xs text-muted-foreground">模板报告：</span>
      {loading ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : null}
      {groups.map((g) => {
        const open = openGroupId === g.group_id;
        return (
          <Popover
            key={g.group_id}
            open={open}
            onOpenChange={(next) => setOpenGroupId(next ? g.group_id : null)}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled || !!preparingCode}
                className={cn(
                  'inline-flex h-7 max-w-[10rem] items-center gap-1 rounded-full border border-border/80 bg-background px-3 text-xs text-foreground',
                  'hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-50',
                  open && 'border-primary/40 bg-primary/5 text-primary',
                )}
              >
                <span className="truncate">{g.group_name}</span>
                <ChevronDown
                  className={cn('h-3 w-3 shrink-0 opacity-60 transition-transform', open && 'rotate-180')}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              sideOffset={6}
              className="w-52 p-1"
            >
              <ul className="max-h-56 overflow-y-auto py-0.5">
                {g.reports.map((r) => {
                  const busy = preparingCode === r.report_code;
                  return (
                    <li key={r.report_code}>
                      <button
                        type="button"
                        disabled={disabled || !!preparingCode || !sessionId}
                        title={r.description ?? r.title}
                        className={cn(
                          'flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs',
                          'hover:bg-muted disabled:pointer-events-none disabled:opacity-50',
                        )}
                        onClick={() => void openReport(r.report_code)}
                      >
                        {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
                        <span className="truncate">{r.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}
