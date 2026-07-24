import { useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAI } from '../use-ai';
import { useAiContext } from '../ai-context';
import { desensitizeRecord } from '../lib/desensitize';
import type { RagCitation, RagResponse } from '../types';
import { MarkdownView } from './markdown-view';

interface RagRequestBody {
  question: string;
  context?: unknown;
}

interface QaItem {
  question: string;
  answer: string;
  citations?: RagCitation[];
}

/**
 * UC-4 上下文 RAG 问答面板（内容区，由 AdminListPage 的 Sheet 承载）。
 * MVP 走非流式 POST /api/v1/ai/rag（T-stream 就绪后升级流式）。
 * 自动注入当前路由 + 脱敏记录作为上下文。
 */
export function AiRag({ record }: { record?: Record<string, unknown> | null; onClose?: () => void }) {
  const aiCtx = useAiContext();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<QaItem[]>([]);
  const lastQuestion = useRef('');

  const rag = useAI<RagRequestBody, RagResponse>({
    capability: 'rag',
    feature: 'rag-qa',
    stream: false,
    request: { question: '', context: aiCtx.getContext() },
    onDone: (res) => {
      const r = res as RagResponse;
      setHistory((prev) => [
        ...prev,
        { question: lastQuestion.current, answer: r?.answer ?? '', citations: r?.citations },
      ]);
    },
    onError: (err) => {
      toast.error(`问答失败：${err.message}`);
    },
  });

  const handleAsk = () => {
    const q = question.trim();
    if (!q || rag.loading) return;
    lastQuestion.current = q;
    setQuestion('');
    rag.run({
      request: {
        question: q,
        context: { ...aiCtx.getContext(), record: record ? desensitizeRecord(record) : null },
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <Sparkles className="h-4 w-4 text-primary" />
        <div>
          <div className="text-[1.05rem] font-semibold leading-none">AI 问答</div>
          <div className="mt-1 text-xs text-muted-foreground">基于当前页面上下文的检索增强问答</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {history.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            就当前记录或制度提问，例如「这笔报销符合差旅标准吗？」
          </div>
        ) : (
          history.map((item, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {item.question}
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <MarkdownView content={item.answer || '（无回答）'} />
                {item.citations && item.citations.length > 0 ? (
                  <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                    引用：
                    {item.citations
                      .map((c) => c.source ?? c.doc ?? c.snippet?.slice(0, 24) ?? '来源')
                      .join('、')}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
        {rag.loading ? <Skeleton className="h-16 w-3/4 rounded-lg" /> : null}
        {rag.error ? <div className="text-sm text-destructive">{rag.error.message}</div> : null}
      </div>

      <div className="border-t px-4 py-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAsk();
              }
            }}
            placeholder="输入问题…（Enter 发送）"
            className="min-h-[2.5rem] max-h-32"
          />
          <Button type="button" size="icon" className="h-9 w-9 shrink-0" onClick={handleAsk} disabled={rag.loading || !question.trim()}>
            {rag.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </Button>
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="px-1.5 py-0">
            AI 生成
          </Badge>
          回答仅供参考，请以原始数据为准
        </div>
      </div>
    </div>
  );
}
