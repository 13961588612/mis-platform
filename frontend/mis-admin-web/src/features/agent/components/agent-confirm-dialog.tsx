/**
 * 危险操作二次确认弹窗（ui.md §1 强制，impl-plan §10.1 约定 5）。
 *
 * <p>**替代 `window.confirm`**：原生 confirm 无法做 danger 样式、无法展示影响面清单、
 * 无法要求输入名称强确认，且在部分浏览器里会被"阻止此页面创建更多对话框"直接吞掉
 * —— 被吞掉的表现是"点了删除没反应"，运营会以为是 bug。
 *
 * <p>两档强度：
 *   - 普通：直接点「确认」。用于停用 / 断开这类可逆操作。
 *   - **强确认**（传 `confirmKeyword`）：必须逐字输入对象名称才能点亮确认按钮。
 *     用于删除技能、删除 Bot 这类不可逆或影响面大的操作。
 *
 * <p>`onConfirm` 可以是 async：期间自动禁用按钮并转圈，**不会**自动关闭弹窗 ——
 * 关闭时机由调用方决定（失败时通常要保持打开让用户看到 toast 后重试）。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { SubmitButton } from '@/components/common/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface AgentConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 说明文案；可传 JSX 以展示影响面清单。 */
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** true 时确认按钮用 destructive 变体并加警示图标。 */
  danger?: boolean;
  /**
   * 强确认关键字：非空时用户必须逐字输入该串才能确认。
   * 通常传对象的 name / id。
   */
  confirmKeyword?: string;
  onConfirm: () => void | Promise<void>;
}

export function AgentConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  confirmKeyword,
  onConfirm,
}: AgentConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 每次打开都清空输入，避免上一次的残留让"强确认"形同虚设
  useEffect(() => {
    if (open) {
      setTyped('');
      setSubmitting(false);
    }
  }, [open]);

  const needKeyword = Boolean(confirmKeyword);
  const keywordOk = !needKeyword || typed.trim() === confirmKeyword;

  async function handleConfirm(): Promise<void> {
    if (!keywordOk || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {danger ? <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" /> : null}
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {needKeyword ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              此操作不可撤销。请输入 <span className="font-mono font-medium text-foreground">{confirmKeyword}</span>{' '}
              以确认。
            </p>
            <Input
              value={typed}
              autoComplete="off"
              placeholder={confirmKeyword}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        ) : null}

        <DialogFooter>
          <SubmitButton
            loading={submitting}
            disabled={!keywordOk}
            variant={danger ? 'destructive' : 'default'}
            onClick={() => void handleConfirm()}
          >
            {confirmText}
          </SubmitButton>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
