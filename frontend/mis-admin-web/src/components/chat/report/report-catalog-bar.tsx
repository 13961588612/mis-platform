import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, FileBarChart2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  AI_REPORT_NO_PARAM_ACCESS,
  fetchAiReportCatalog,
  prepareAiReportCard,
  type AiReportCatalogGroup,
  type AiReportPrepareCard,
} from '@/lib/api/ai-report';
import { ApiError } from '@/lib/api/errors';
import { generateClientId, type ReportParamCardMeta } from '@/lib/chat/types';
import { useChatStore } from '@/stores/chat-store';

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
      const prepared = await prepareAiReportCard(reportCode);
      insertParamCard(sid, prepared);
    } catch (e) {
      if (e instanceof ApiError && e.code === AI_REPORT_NO_PARAM_ACCESS) {
        toast.message('无权限或无可选参数');
      } else {
        toast.error(e instanceof Error ? e.message : '打开报告失败');
      }
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

function insertParamCard(sessionId: string, prepared: AiReportPrepareCard): void {
  const store = useChatStore.getState();
  store.cancelActiveReportCard();

  const values: Record<string, string> = {};
  for (const slot of prepared.slots ?? []) {
    const def = slot.default_value;
    if (def != null && String(def).trim()) {
      values[slot.wire_key] = String(def).trim();
    } else if (slot.options?.[0]?.value) {
      values[slot.wire_key] = slot.options[0].value;
    } else {
      values[slot.wire_key] = '';
    }
  }

  const cardId = generateClientId('rptcard');
  const messageId = generateClientId('msg');
  const meta: ReportParamCardMeta = {
    kind: 'report_param_card',
    cardId,
    state: 'active',
    reportCode: prepared.report_code,
    title: prepared.title,
    description: prepared.description,
    useAiWorkflow: Boolean(prepared.use_ai_workflow),
    workflowCode: prepared.workflow_code,
    workflowPlatformCode: prepared.workflow_platform_code,
    slots: (prepared.slots ?? []).map((s) => ({
      source_code: s.source_code,
      value_type: s.value_type,
      wire_key: s.wire_key,
      label: s.label,
      required: Boolean(s.required),
      options: (s.options ?? []).map((o) => ({
        value: o.value,
        label: o.label,
        extra: o.extra,
      })),
    })),
    values,
  };

  store.addMessage({
    id: messageId,
    sessionId,
    role: 'assistant',
    content: '',
    status: 'delivered',
    timestamp: new Date().toISOString(),
    reportParamCard: meta,
  });
  store.setActiveReportCardId(messageId);
}
