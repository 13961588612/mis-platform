import { useEffect, useState } from 'react';
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
import { PROCESS_TITLE_REQUIRED_MESSAGE } from '../lib/resolve-process-title';

export interface ProcessTitleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 确认补录；空串不应提交。 */
  onConfirm: (title: string) => void;
  /** 初始草稿（可选）。 */
  initialTitle?: string;
}

/**
 * @deprecated 表单发起请统一用 {@link ProcessStartDialog}（标题+过期+紧急）。
 * 本组件仅保留兼容旧调用。
 */
export function ProcessTitleDialog({
  open,
  onOpenChange,
  onConfirm,
  initialTitle = '',
}: ProcessTitleDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setError(null);
  }, [open, initialTitle]);

  function submit() {
    const t = title.trim();
    if (!t) {
      setError(PROCESS_TITLE_REQUIRED_MESSAGE);
      return;
    }
    onConfirm(t);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>补录流程标题</DialogTitle>
          <DialogDescription>
            未能从表单标题字段取得标题，请填写后继续发起。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 px-1 py-2">
          <label htmlFor="process-title-input" className="block text-sm font-medium">
            流程标题 *
          </label>
          <Input
            id="process-title-input"
            aria-label="流程标题"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError(null);
            }}
            placeholder="请输入流程标题"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={submit}>
            确认并发起
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
