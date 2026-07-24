import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useAI } from '../use-ai';
import { useAiContext } from '../ai-context';
import { desensitizeRecord } from '../lib/desensitize';
import type { SummaryCitation, SummaryPoint, SummaryResponse } from '../types';
import { MarkdownView } from './markdown-view';

interface SummaryRequestBody {
  records: Record<string, unknown>[];
  context?: unknown;
}

/**
 * UC-2 记录智能摘要卡片（详情 Sheet 头部，可折叠）。
 * 进入详情自动触发；标注"AI 生成"；引用可展示。
 * MVP 兼容 BFF summary 的 List<String> 响应（T-sum 后升级结构化 label/value/risk）。
 */
export function AiSummary({
  record,
  defTitle,
}: {
  record: Record<string, unknown>;
  defTitle?: string;
}) {
  const aiCtx = useAiContext();
  const [open, setOpen] = useState(true);
  const ran = useRef(false);

  const summary = useAI<SummaryRequestBody, SummaryResponse>({
    capability: 'summary',
    feature: 'detail-summary',
    stream: false,
    request: { records: [], context: aiCtx.getContext() },
    onError: (err) => {
      toast.error(`摘要生成失败：${err.message}`);
    },
  });

  // 进入详情自动触发一次（脱敏后记录作为上下文）
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    summary.run({
      request: {
        records: [desensitizeRecord(record)],
        context: aiCtx.getContext(),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = summary.data;
  const points: SummaryPoint[] = Array.isArray(data?.points)
    ? data!.points!.map((p) => (typeof p === 'string' ? { text: p } : (p as SummaryPoint)))
    : [];
  const citations: SummaryCitation[] = Array.isArray(data?.citations)
    ? data!.citations!.map((c) => (typeof c === 'string' ? { source: c } : (c as SummaryCitation)))
    : [];

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border bg-muted/30">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-medium">AI 摘要</span>
        <Badge variant="outline" className="px-1.5 py-0">
          AI 生成
        </Badge>
        {defTitle ? <span className="truncate text-xs text-muted-foreground">{defTitle}</span> : null}
        <ChevronDown className={cn('ml-auto h-4 w-4 transition', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {summary.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : summary.error ? (
          <div className="text-sm text-destructive">{summary.error.message}</div>
        ) : (
          <div className="space-y-2 text-sm">
            {data?.summary ? (
              <MarkdownView content={data.summary} />
            ) : (
              <div className="text-muted-foreground">暂无摘要</div>
            )}
            {points.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {points.map((p, i) => (
                  <li key={i}>
                    {p.label ? <span className="font-medium">{p.label}：</span> : null}
                    {p.text ?? p.value ?? ''}
                    {p.risk ? <span className="ml-1 text-warning">（风险：{p.risk}）</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {citations.length > 0 ? (
                <div className="border-t pt-2 text-xs text-muted-foreground">
                  引用：{citations.map((c, i) => c.source ?? c.field ?? `来源${i + 1}`).join('、')}
                </div>
            ) : null}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
