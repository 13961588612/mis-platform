/**
 * iqd-feedback-buttons.tsx — 问数回答评价按钮（👍/👎 + 吐槽必填说明）。
 *
 * <p>反馈写入链（feedback-enhance §2.2 方案 C）：
 * 用户点击 👍/👎 → {@code submitSessionFeedback} → BFF `/agent-ops/sessions/{id}/feedback`
 * 透传 → ai-platform `agent_feedback` 表（唯一约束幂等，重复提交覆盖写）。
 *
 * <p>交互：
 * <ul>
 *   <li>👍 一键提交；👎 展开 comment 输入（必填，≤500，服务端 4001 兜底）；</li>
 *   <li>提交后锁定（本地 state {@code submittedRating}），可点赞/点踩切换覆盖写（幂等）；</li>
 *   <li>{@code backendMessageId} 缺失（如 done 帧丢失）时禁用 + tooltip「暂无法评价」，不阻断展示。</li>
 * </ul>
 *
 * <p>约束：与消费方同 feature（features/agent/ai），满足 arch/no-cross-feature。
 */

import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { submitSessionFeedback } from '../../api/agent-ops-api';

export interface IqdFeedbackButtonsProps {
  /** 平台会话 UUID（SSE done 帧 sessionId；缺失时回退 chat-store 本地会话 id）。 */
  sessionId: string | null;
  /** 后端消息 UUID（SSE done 帧 messageId，评价锚点）；缺失时禁用评价。 */
  backendMessageId?: string;
  /** 智能体展示名（仅语义提示，不参与提交）。 */
  agentLabel?: string;
}

type Rating = 'up' | 'down';

const COMMENT_MAX = 500;

/**
 * 问数回答评价按钮组。
 *
 * @param props 见 {@link IqdFeedbackButtonsProps}
 */
export function IqdFeedbackButtons({
  sessionId,
  backendMessageId,
  agentLabel,
}: IqdFeedbackButtonsProps) {
  /** 当前已提交并锁定的评价方向（null = 尚未评价）。 */
  const [submittedRating, setSubmittedRating] = useState<Rating | null>(null);
  /** 正在起草的评价方向（down 时展开 comment 输入框）。 */
  const [draftRating, setDraftRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingAnchor = !backendMessageId || !sessionId;
  const disabled = missingAnchor || submitting;

  const submit = async (rating: Rating): Promise<void> => {
    if (!backendMessageId || !sessionId) return;
    if (rating === 'down' && comment.trim().length === 0) {
      setError('吐槽请填写说明');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await submitSessionFeedback(sessionId, {
        rating,
        comment: rating === 'down' ? comment.trim() : undefined,
        message_id: backendMessageId,
      });
      setSubmittedRating(rating);
      setDraftRating(null);
      setComment('');
      toast.success('已记录反馈');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '提交反馈失败');
    } finally {
      setSubmitting(false);
    }
  };

  /** 点击 👍 立即提交；点击 👎 先展开 comment 输入（确认后再提交）。 */
  const onRate = (rating: Rating): void => {
    if (disabled) return;
    setError(null);
    if (rating === 'down') {
      setDraftRating('down');
      return;
    }
    setDraftRating(null);
    void submit('up');
  };

  const thumbClass = (active: boolean): string =>
    cn(
      'flex h-6 w-6 items-center justify-center rounded-md border text-xs transition-colors',
      active
        ? 'border-primary/40 bg-primary/10 text-primary'
        : 'border-border/70 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
    );

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1"
      title={missingAnchor ? '暂无法评价' : undefined}
    >
      <button
        type="button"
        aria-label={agentLabel ? `给「${agentLabel}」的回答点赞` : '点赞回答'}
        className={thumbClass(submittedRating === 'up')}
        disabled={disabled}
        onClick={() => onRate('up')}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={agentLabel ? `给「${agentLabel}」的回答点踩` : '点踩回答'}
        className={thumbClass(submittedRating === 'down')}
        disabled={disabled}
        onClick={() => onRate('down')}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
      {error ? <span className="text-[11px] text-destructive">{error}</span> : null}

      {draftRating === 'down' ? (
        <div className="mt-1 w-full space-y-1.5">
          <Textarea
            rows={2}
            value={comment}
            maxLength={COMMENT_MAX}
            disabled={submitting}
            onChange={(e) => {
              setComment(e.target.value);
              setError(null);
            }}
            placeholder="请说明吐槽原因（必填，≤500 字）"
            className="min-h-[3rem] w-full resize-none text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {comment.length}/{COMMENT_MAX}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              onClick={() => void submit('down')}
              className="h-7 px-3 text-xs"
            >
              提交吐槽
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default IqdFeedbackButtons;
