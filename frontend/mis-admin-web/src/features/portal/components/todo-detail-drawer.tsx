import { useCallback, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ProcessShell } from '@/features/taskflow/process-shell';
import type { WfInstance } from '@/lib/api/workflow';
import { cn } from '@/lib/utils';

/** 流程实例状态徽标（与门户待办列表 / `my-sent-page` 口径一致）。 */
const PROCESS_STATUS: Record<string, { text: string; cls: string }> = {
  RUNNING: { text: '进行中', cls: 'bg-info/10 text-info' },
  COMPLETED: { text: '已完成', cls: 'bg-success/10 text-success' },
  TERMINATED: { text: '已终止', cls: 'bg-destructive/10 text-destructive' },
  SUSPENDED: { text: '已挂起', cls: 'bg-warning/10 text-warning' },
};

export interface TodoDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 关联流程实例 ID；为 null 时渲染降级提示（不实例化 ProcessShell）。 */
  instanceId: string | null;
  /** 动作（同意/驳回/转办）成功后的回调：由父组件关抽屉 + 刷新当前列表。 */
  onDone: () => void;
}

/**
 * 待办详情抽屉（T03b，设计 §2.1 / §2.4）。
 *
 * <p>右侧划入（`Sheet`，宽度 `max-w-[560px]`）；内容体是**唯一滚动容器**
 * （`min-h-0 flex-1 overflow-auto`），其内的 `ProcessShell(embedded)` / `FormShell`
 * 一律不再加 `overflow-auto`/`max-h`（单层滚动红线，设计 §2.1 / 共享约定 §5）。
 *
 * <p>标题 + 状态徽标放在 `SheetHeader`：由 `ProcessShell` 加载详情后经 `onLoaded`
 * 回调把 `instance` 交上来填充（避免抽屉二次请求流程详情）。单号 / 流程编码 / 表单在「流程信息」面板。
 */
export function TodoDetailDrawer({ open, onOpenChange, instanceId, onDone }: TodoDetailDrawerProps) {
  const [header, setHeader] = useState<WfInstance | null>(null);

  const handleLoaded = useCallback((inst: WfInstance) => setHeader(inst), []);

  const statusMeta = header ? PROCESS_STATUS[header.status] ?? PROCESS_STATUS.RUNNING : null;

  /**
   * 打开流程裸页：用命名窗口复用同一 instance 的标签。
   * 再次点击会聚焦已有页（浏览器原生行为），而非再开一页。
   */
  function openFullPage() {
    if (!instanceId) return;
    const path = `/task/process-view/${instanceId}`;
    const url = `${window.location.origin}${path}`;
    const name = `mis-process-view-${instanceId}`;
    const win = window.open(url, name);
    if (win) {
      try {
        win.focus();
      } catch {
        /* ignore */
      }
    } else {
      toast.error('无法打开完整页', {
        description: '可能已被浏览器拦截，或该流程已在其他标签中打开，请检查标签栏。',
      });
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        // 关闭时清掉 header，下次打开由 onLoaded 重新填充，避免「闪现上一条」。
        if (!o) setHeader(null);
        onOpenChange(o);
      }}
    >
      <SheetContent side="right" className="w-full max-w-[560px]">
        <SheetHeader>
          <SheetTitle>
            {header
              ? header.title?.trim() || header.businessId
              : '待办详情'}
          </SheetTitle>
          <SheetDescription className={header ? 'sr-only' : undefined}>
            {header ? '流程详情' : '加载中…'}
          </SheetDescription>
          {statusMeta ? (
            <span
              className={cn(
                'mt-1 inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px]',
                statusMeta.cls,
              )}
            >
              {statusMeta.text}
            </span>
          ) : null}
        </SheetHeader>

        {/* 唯一滚动容器：抽屉内容体。ProcessShell(embedded) 内部不得再出现 overflow-auto。 */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {instanceId ? (
            <ProcessShell
              key={instanceId}
              instanceId={instanceId}
              variant="embedded"
              onLoaded={handleLoaded}
              onActionDone={onDone}
            />
          ) : (
            <p className="text-sm text-muted-foreground">该待办无关联流程，暂不支持查看</p>
          )}
        </div>

        {instanceId ? (
          <SheetFooter>
            <Button variant="outline" size="sm" onClick={openFullPage}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              在完整页打开
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export default TodoDetailDrawer;
