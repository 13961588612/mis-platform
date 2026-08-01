import { type FC } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface EntitySelectorProps {
  open: boolean;
  field: string;
  originalValue: string;
  onClose: () => void;
  onManualSelect: () => void;
}

/**
 * 无匹配结果时的手动选择入口弹窗。
 * 当 Skill 引擎返回 `manual_required`（候选列表为空）时弹出。
 */
export const EntitySelector: FC<EntitySelectorProps> = ({
  open,
  field,
  originalValue,
  onClose,
  onManualSelect,
}) => {
  const entityLabel = field.replace(/Id$/, '');

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI 填充 — 未找到匹配结果</DialogTitle>
          <DialogDescription>
            系统未找到名称为 "{originalValue}" 的{entityLabel}。
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 text-sm text-muted-foreground">
          <p>可能原因：</p>
          <ul className="mt-1 list-inside space-y-0.5">
            <li>· 该名称与系统记录不一致</li>
            <li>· 您没有查看该{entityLabel}的权限</li>
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} size="sm">
            取消
          </Button>
          <Button type="button" variant="default" onClick={onManualSelect} size="sm">
            手动选择{entityLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
