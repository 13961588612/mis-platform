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
import { PRIORITY_META } from '@/components/common/priority-badge';
import { PROCESS_TITLE_REQUIRED_MESSAGE } from '../lib/resolve-process-title';

export interface ProcessStartConfirm {
  title: string;
  /** ISO 本地时间串，可空。 */
  dueDate: string | null;
  priority: number;
}

export interface ProcessStartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: ProcessStartConfirm) => void;
  /** 自动填入的标题（可改）。 */
  initialTitle?: string;
  /** datetime-local 初值，如 2026-10-12T20:00。 */
  initialDueLocal?: string;
  /** 1~4，默认 2。 */
  initialPriority?: number;
  submitting?: boolean;
}

function toLocalInputValue(isoOrLocal: string | null | undefined): string {
  if (!isoOrLocal) return '';
  // 已是 datetime-local 形态
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(isoOrLocal) && !isoOrLocal.includes('Z')) {
    return isoOrLocal.slice(0, 16);
  }
  const d = new Date(isoOrLocal);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  const t = local.trim();
  if (!t) return null;
  // 后端 LocalDateTime 解析：yyyy-MM-ddTHH:mm:ss（无时区）
  return t.length === 16 ? `${t}:00` : t;
}

/**
 * 表单发起流程确认弹窗：标题（自动填可改）+ 过期时间 + 紧急程度。
 */
export function ProcessStartDialog({
  open,
  onOpenChange,
  onConfirm,
  initialTitle = '',
  initialDueLocal = '',
  initialPriority = 2,
  submitting = false,
}: ProcessStartDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [dueLocal, setDueLocal] = useState(toLocalInputValue(initialDueLocal));
  const [priority, setPriority] = useState(initialPriority);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setDueLocal(toLocalInputValue(initialDueLocal));
    setPriority(initialPriority >= 1 && initialPriority <= 4 ? initialPriority : 2);
    setError(null);
  }, [open, initialTitle, initialDueLocal, initialPriority]);

  function submit() {
    const t = title.trim();
    if (!t) {
      setError(PROCESS_TITLE_REQUIRED_MESSAGE);
      return;
    }
    onConfirm({
      title: t,
      dueDate: localInputToIso(dueLocal),
      priority,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>确认发起流程</DialogTitle>
          <DialogDescription>
            请确认标题、过期时间与紧急程度后再提交。标题已按表单标题字段自动填入，可修改。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-1 py-2">
          <div className="space-y-1.5">
            <label htmlFor="process-start-title" className="block text-sm font-medium">
              流程标题 *
            </label>
            <Input
              id="process-start-title"
              aria-label="流程标题"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              placeholder="请输入流程标题"
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="process-start-due" className="block text-sm font-medium">
              过期时间
            </label>
            <Input
              id="process-start-due"
              aria-label="过期时间"
              type="datetime-local"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">默认取流程定义首个审批节点时限，可清空或修改。</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="process-start-priority" className="block text-sm font-medium">
              紧急程度
            </label>
            <select
              id="process-start-priority"
              aria-label="紧急程度"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {([4, 3, 2, 1] as const).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].text}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? '发起中…' : '确认发起'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
