/**
 * 助手回答点赞 / 吐槽（对齐旧版 ai-platform/frontend MessageFeedbackBar）。
 *
 * 提交：BFF `/agent-ops/sessions/{id}/feedback` → ai-platform agent_feedback。
 * 点赞一键提交；吐槽展开说明框，必填后提交。
 */

import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { submitSessionFeedback } from '@/features/agent/api/agent-ops-api';
import { useChatStore } from '@/stores/chat-store';
import type { ChatMessage } from '@/lib/chat/types';

type Rating = 'up' | 'down';

const COMMENT_MAX = 500;

export function MessageFeedbackBar({ message }: { message: ChatMessage }) {
  const updateMessage = useChatStore((s) => s.updateMessage);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  if (message.role !== 'assistant' || message.status === 'streaming') {
    return null;
  }

  const sessionId = message.backendSessionId || message.sessionId;
  // 历史回放：消息 id 即后端 UUID；流式 done 帧写入 backendMessageId
  const messageId = message.backendMessageId || message.id;
  const rating = message.feedback?.rating ?? null;
  const missingAnchor = !sessionId || !messageId;

  const submit = async (next: Rating, text: string): Promise<void> => {
    if (!sessionId || !messageId || busy) return;
    if (next === 'down' && text.trim().length === 0) {
      toast.error('吐槽请填写说明');
      return;
    }
    setBusy(true);
    try {
      await submitSessionFeedback(sessionId, {
        rating: next,
        comment: next === 'down' ? text.trim() : undefined,
        message_id: messageId,
      });
      updateMessage(message.id, {
        feedback: { rating: next, comment: text.trim() || null },
      });
      setOpen(false);
      setComment('');
      toast.success(next === 'up' ? '已点赞，感谢反馈' : '已收到吐槽');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '提交失败');
    } finally {
      setBusy(false);
    }
  };

  const thumbClass = (active: boolean): string =>
    cn(
      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors disabled:opacity-50',
      active
        ? 'text-primary'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
    );

  return (
    <div
      className="mt-2 border-t border-border/60 pt-2"
      title={missingAnchor ? '暂无法评价（回复锚点未就绪）' : undefined}
    >
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={busy || missingAnchor || rating === 'up'}
          className={thumbClass(rating === 'up')}
          onClick={() => void submit('up', '')}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
          {rating === 'up' ? '已点赞' : '点赞'}
        </button>
        <button
          type="button"
          disabled={busy || missingAnchor}
          className={thumbClass(rating === 'down')}
          onClick={() => setOpen((v) => !v)}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
          {rating === 'down' ? '已吐槽' : '吐槽'}
        </button>
      </div>
      {open ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={COMMENT_MAX}
            rows={3}
            placeholder="哪里不对、期望怎样才对"
            className="min-h-[4rem] resize-none text-xs"
            disabled={busy}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {comment.length}/{COMMENT_MAX}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 px-3 text-xs"
                disabled={busy || !comment.trim()}
                onClick={() => void submit('down', comment.trim())}
              >
                提交吐槽
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default MessageFeedbackBar;
