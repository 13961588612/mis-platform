/**
 * 轻量对话壳（UI#6 本地对话的内层组件）。
 *
 * <p>⚠️ **这是 `features/agent` 自建的对话界面，与 `features/ai` 的业务 Copilot 无关**。
 * `arch/no-cross-feature` 是 **error** 级：本 feature 不得 import `features/ai`，
 * 复用 Copilot 组件会直接构建失败。更重要的是二者定位不同 ——
 * 业务 Copilot 面向终端用户（要 Markdown、要引用卡片、要 Worker 选择器），
 * 运营调试台面向排障（要看清 role、tool 调用与原始报错），刻意保持朴素。
 *
 * <p>职责边界：本组件**只管渲染与输入交互**，不碰任何 API ——
 * 建会话（#32）/ 发消息（#33）由父组件 `agent-chat-page.tsx` 负责。
 * 这样对话壳可以在没有后端的情况下独立推理其行为。
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Loader2, SendHorizonal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AgentMessageStream } from '../components/agent-message-stream';
import type { SessionMessage } from '../types';

export interface ChatShellProps {
  messages: SessionMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  /** 等待下游回复中：禁用输入并在流末尾显示占位气泡。 */
  sending: boolean;
  /** 无可用会话（未选 Agent / 建会话失败）时整体禁用输入区。 */
  disabled?: boolean;
  /** 输入区下方的说明文案。 */
  hint?: string;
}

export function ChatShell({
  messages,
  input,
  onInputChange,
  onSend,
  sending,
  disabled = false,
  hint,
}: ChatShellProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 新消息到达后滚到底部；`sending` 也进依赖，让"正在生成"占位同样可见
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, sending]);

  const canSend = !disabled && !sending && input.trim().length > 0;

  /** Enter 发送，Shift+Enter 换行 —— 排障时经常要贴多行 payload。 */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (canSend) onSend();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {messages.length === 0 && !sending ? (
          <div className="flex h-full min-h-[12rem] items-center justify-center">
            <p className="max-w-md text-center text-sm text-muted-foreground">
              在下方输入内容开始调试对话。该对话会真实调用所选 Agent 的模型与技能，
              产生的会话可在「会话管理」中查看与删除。
            </p>
          </div>
        ) : (
          <AgentMessageStream
            messages={messages}
            footer={
              sending ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在等待回复…
                </div>
              ) : null
            }
          />
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            rows={3}
            className="min-h-[3.5rem] flex-1 resize-none"
            placeholder={
              disabled ? '请先在上方选择一个 Agent' : '输入消息，Enter 发送，Shift+Enter 换行'
            }
            value={input}
            disabled={disabled || sending}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button
            size="sm"
            className={cn('h-9 shrink-0')}
            disabled={!canSend}
            onClick={onSend}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizonal className="h-4 w-4" />
            )}
            发送
          </Button>
        </div>
        {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}
