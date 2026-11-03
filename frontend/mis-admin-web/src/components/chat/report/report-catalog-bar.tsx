import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, FileBarChart2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
 * Copilot 输入框上方：按 is_group 折叠的有权限报告目录。
 * 点击报告 → prepare-card → 本地插入参数卡（失败不插卡）。
 */
export function ReportCatalogBar({ disabled, className }: ReportCatalogBarProps) {
  const [groups, setGroups] = useState<AiReportCatalogGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [preparingCode, setPreparingCode] = useState<string | null>(null);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  const sessionId = useChatStore((s) => s.sessionId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAiReportCatalog();
      setGroups(Array.isArray(data) ? data.filter((g) => (g.reports?.length ?? 0) > 0) : []);
    } catch (e) {
      setGroups([]);
      // 无权限或服务未起：静默空栏，避免打断对话
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
    <div className={cn('mb-2 space-y-1.5', className)}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FileBarChart2 className="h-3.5 w-3.5" />
        <span>模板报告</span>
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      </div>
      <div className="max-h-36 space-y-1 overflow-y-auto pr-0.5">
        {groups.map((g) => {
          const key = String(g.group_id);
          const open = openMap[key] ?? true;
          return (
            <Collapsible
              key={key}
              open={open}
              onOpenChange={(v) => setOpenMap((prev) => ({ ...prev, [key]: v }))}
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs font-medium text-foreground hover:bg-muted/60"
                >
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')}
                  />
                  <span className="truncate">{g.group_name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {g.reports.length}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-0.5 pb-1 pl-5">
                {g.reports.map((r) => {
                  const busy = preparingCode === r.report_code;
                  return (
                    <Button
                      key={r.report_code}
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled || !!preparingCode || !sessionId}
                      className="h-7 w-full justify-start px-2 text-xs font-normal"
                      title={r.description ?? r.title}
                      onClick={() => void openReport(r.report_code)}
                    >
                      {busy ? (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : null}
                      <span className="truncate">{r.title}</span>
                    </Button>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
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
