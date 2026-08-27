import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createTicket } from '../api/kb-api';
import type { KbQaTicket } from '../types';
import { KB_TICKET_TYPE_OPTIONS } from '../types';

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

interface KbTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 关联会话；为 null 时不允许提交（服务端强校验 sessionId 非空）。 */
  sessionId: number | null;
  /** 关联助手消息；未落库时为 null，服务端按会话级工单处理。 */
  messageId?: number | null;
  /** 提交成功回调（用于刷新侧栏工单列表）。 */
  onCreated?: (ticket: KbQaTicket) => void;
  /** 弹窗标题，默认「报告问题」；点赞旁的吐槽入口传「吐槽」。 */
  title?: string;
  /** 打开时的初始类型（OP-03 转工单按吐槽维度预填 answer_error/cite_error）；缺省取选项首项。 */
  initialType?: string | null;
}

/**
 * 问答一键报错弹窗（F-10）。
 *
 * <p>提交后进入 A-02c 工单池，由运营在「问题工单」页处理。
 * `messageId` 允许为空——流式问答若落库失败，前端拿不到消息 ID，
 * 此时仍应允许用户报错（会话级），否则最该被反馈的失败场景反而报不了。
 *
 * <p>OP-04 运营侧「转工单」复用本弹窗：`initialType` 由调用方按吐槽维度预填，
 * 用户仍可改选其它类型。
 */
export function KbTicketDialog({
  open,
  onOpenChange,
  sessionId,
  messageId = null,
  onCreated,
  title = '报告问题',
  initialType = null,
}: KbTicketDialogProps) {
  const [type, setType] = useState<string>(KB_TICKET_TYPE_OPTIONS[0]?.value ?? 'answer_error');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 每次打开重置表单，避免上一次的描述残留；initialType 命中选项才用，否则回落首项
  useEffect(() => {
    if (open) {
      const preset =
        initialType && KB_TICKET_TYPE_OPTIONS.some((o) => o.value === initialType)
          ? initialType
          : (KB_TICKET_TYPE_OPTIONS[0]?.value ?? 'answer_error');
      setType(preset);
      setContent('');
    }
  }, [open, initialType]);

  async function onSubmit(): Promise<void> {
    if (sessionId == null) {
      toast.warning('当前回答尚未落库，无法提交工单');
      return;
    }
    const desc = content.trim();
    if (!desc) {
      toast.warning('请填写问题描述');
      return;
    }
    setSubmitting(true);
    try {
      const ticket = await createTicket({ sessionId, messageId, type, content: desc });
      toast.success(`已提交工单 #${ticket.id}`);
      onCreated?.(ticket);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '提交工单失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {sessionId == null
              ? '当前回答未关联会话，无法提交；请重新提问后再试。'
              : `关联会话 #${sessionId}${messageId == null ? '' : ` · 消息 #${messageId}`}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className={fieldLabel}>问题类型 *</label>
            <select
              className={selectClass}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {KB_TICKET_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabel}>问题描述 *</label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="请具体说明哪里不对、期望怎样才对"
              className="min-h-[6rem]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={submitting || sessionId == null} onClick={() => void onSubmit()}>
            提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
