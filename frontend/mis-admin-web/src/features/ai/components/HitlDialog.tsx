import { useState, type FC } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { EntityCandidate } from '../types/skill-fill.types';

interface HitlDialogProps {
  open: boolean;
  field: string;
  originalValue: string;
  candidates: EntityCandidate[];
  onConfirm: (candidate: EntityCandidate) => void;
  onCancel: () => void;
  onManual: () => void;
}

/**
 * HITL 多选一弹窗。
 * 当 Skill 引擎返回 `hitl_required` 时弹出，用户从候选列表中选择，或手动查找。
 */
export const HitlDialog: FC<HitlDialogProps> = ({
  open,
  field,
  originalValue,
  candidates,
  onConfirm,
  onCancel,
  onManual,
}) => {
  const [selectedId, setSelectedId] = useState<string | number | null>(null);

  const handleConfirm = () => {
    if (selectedId === null) return;
    const candidate = candidates.find((c) => String(c.id) === String(selectedId));
    if (candidate) onConfirm(candidate);
  };

  const entityLabel = field.replace(/Id$/, ''); // "deptId" → "dept"

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI 填充 — 请选择正确的{entityLabel}</DialogTitle>
          <DialogDescription>
            您提到了 "{originalValue}"，系统找到以下匹配结果：
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          {candidates.map((c) => {
            const selected = String(c.id) === String(selectedId);
            return (
              <button
                key={String(c.id)}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors
                  ${selected
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border hover:bg-accent'
                  }`}
              >
                <div
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border
                    ${selected
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground'
                    }`}
                >
                  {selected && (
                    <div className="flex h-full w-full items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{c.name}</div>
                  {c.context && (
                    <div className="mt-0.5 text-xs text-muted-foreground">[{c.context}]</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onManual} size="sm">
            手动查找
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} size="sm">
            取消
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={handleConfirm}
            disabled={selectedId === null}
            size="sm"
          >
            确认选择
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
