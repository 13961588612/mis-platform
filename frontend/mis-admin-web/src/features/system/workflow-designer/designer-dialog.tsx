/**
 * 全屏编排 Dialog（T4.2）。
 *
 * <p>把 `DesignerBody` 整块塞进「视口内全屏」的 Dialog：
 * 不用真 fullscreen（`inset-0 w-screen h-screen`），因为那会盖住侧栏与页面页头，
 * 流程相关的对照操作就做不了；留 2rem 边距视觉上仍是压倒性的大。
 *
 * ## ⚠️ 宽度：必须显式覆盖 `dialog.tsx:45` 的默认居中定位
 *
 * 默认是 `w-full max-w-lg` + `left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`。
 * `max-w-lg` = 32rem = 512px ⇒ 三栏（Palette 200 + 画布 + 属性面板 280）直接崩，
 * 画布只剩约 30px。
 *
 * 覆盖要**四个类齐全**，缺一个就错位：
 * - `max-w-none` 拆掉 512px 上限
 * - `left-4 top-4` 换掉 `left-1/2 top-1/2`
 * - `translate-x-0 translate-y-0` 清掉两个居中位移（tailwind-merge 会赢掉默认的
 *   `-translate-x-1/2 -translate-y-1/2`，因为二者同属 translate 组）
 *
 * ## ⚠️ 高度：`min-h-0` 漏一处画布高度就是 0
 *
 * `DesignerCanvas` 的根是 `h-full w-full`，父级链每一环都必须是「确定高度」或
 * `flex-1 + min-h-0`：
 * ```
 * DialogContent   h-[calc(100vh-4rem)] flex flex-col        ← 确定高度
 *   DesignerBody  flex-1 min-h-0 flex-col                   ← 关键
 *     div         flex-1 min-h-0 overflow-hidden            ← 三栏容器
 *       div       min-w-0 flex-1  →  DesignerCanvas h-full w-full
 * ```
 */
import { useCallback, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DesignerBody } from './designer-body';
import type { FlowMeta } from './property-panel';
import { cn } from '@/lib/utils';

export interface DesignerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 有 = 编辑已有定义；无 = 新建。 */
  definitionId?: string;
  initialFlowMeta?: Partial<FlowMeta>;
  /** 保存成功后回调；调用方刷新列表后自行关闭本 Dialog。 */
  onSaved?: (defId: string) => void;
}

export function DesignerDialog({
  open,
  onOpenChange,
  definitionId,
  initialFlowMeta,
  onSaved,
}: DesignerDialogProps) {
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const requestClose = useCallback(() => {
    // 有未保存改动时先二次确认：Esc / 点外部 / 关叉都走这里
    if (dirty) {
      setConfirming(true);
      return;
    }
    onOpenChange(false);
  }, [dirty, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else requestClose();
      }}
    >
      <DialogContent
        className={cn(
          'max-w-none',
          'w-[calc(100vw-4rem)] h-[calc(100vh-4rem)]',
          'left-4 top-4 translate-x-0 translate-y-0',
          // ReactFlow 用 ResizeObserver 量容器；Dialog 的 zoom-in 动画期间尺寸在变，
          // 禁掉动画换取确定的首次测量结果（方案 §4.2 已标注该风险）。
          'data-[state=open]:animate-none data-[state=closed]:animate-none',
        )}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          requestClose();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          requestClose();
        }}
      >
        {open ? (
          <DesignerBody
            definitionId={definitionId}
            initialFlowMeta={initialFlowMeta}
            onSaved={onSaved}
            onDirtyChange={setDirty}
          />
        ) : null}

        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>放弃未保存的改动？</DialogTitle>
              <DialogDescription>画布上的改动还没有保存，关闭后将丢失。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
                继续编辑
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setConfirming(false);
                  onOpenChange(false);
                }}
              >
                放弃改动
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

export default DesignerDialog;
