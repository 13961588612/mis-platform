import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAI } from '../use-ai';
import { useAiContext } from '../ai-context';
import type { ChatMessage, ChatResponse } from '../types';
import { MarkdownView } from './markdown-view';

interface AiCopilotProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * UC-5 全局 Copilot 对话内容。
 * 走流式 POST /api/v1/ai/chat/completions（stream:true → BFF SSE 透传平台 delta|done|error）。
 * 自动注入当前路由/模块作为上下文；对话不触发任何写操作（铁律）。
 */
export function AiCopilot(_props: AiCopilotProps) {
  const ai = useAiContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useAI<{ messages: ChatMessage[] }, ChatResponse>({
    capability: 'chat',
    feature: 'copilot',
    stream: true,
    request: { messages: [] },
    onDone: (res) => {
      const r = res as ChatResponse;
      const content = typeof r === 'string' ? r : r?.content ?? '';
      if (content) setMessages((prev) => [...prev, { role: 'assistant', content }]);
    },
    onError: (err) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${err.message}` }]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, chat.loading, chat.streaming]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || chat.loading) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    void chat.run({ request: { messages: next } });
  };

  const ctx = ai.getContext();
  const unavailable = chat.unavailable;

  return (
    <div className="flex h-full flex-col">
      {unavailable ? (
        <div className="px-5 py-3 text-xs text-muted-foreground">
          AI 对话暂不可用（未启用或无权限）。主流程不受影响。
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
            你好，我是 MIS Copilot。可就当前页面（{ctx.route || '—'}）提问，或让我协助你操作业务。
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                  m.role === 'user' ? 'bg-primary text-primary-foreground' : 'border bg-card',
                )}
              >
                {m.role === 'assistant' ? (
                  <MarkdownView content={m.content} />
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
              </div>
            </div>
          ))
        )}
        {chat.loading ? <Skeleton className="h-16 w-3/4 rounded-lg" /> : null}
      </div>

      <div className="border-t px-4 py-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入问题…（Enter 发送，Shift+Enter 换行）"
            className="min-h-[2.5rem] max-h-32"
          />
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleSend}
            disabled={chat.loading || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="px-1.5 py-0">
            AI 生成
          </Badge>
          对话不会触发任何写操作
        </div>
      </div>
    </div>
  );
}
