import { useEffect, useState } from 'react';
import { ArchiveRestore, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updateLibrary } from '../api/kb-api';
import type { KbLibrary } from '../types';
import { formatTime } from '../types';

interface KbLibraryUnarchiveDialogProps {
  /** 待取消归档的知识库；null = 关闭 */
  library: KbLibrary | null;
  onOpenChange: (open: boolean) => void;
  /** 成功后回调（调用方负责 `invalidateLibraries()` + 重新拉列表） */
  onDone: () => void;
}

/**
 * 取消归档确认对话框（P1-T2）。
 *
 * <p>归档时后端做了两件事：本地 `status=0` + `archived_at=now`，引擎侧 dataset 改名为
 * `[已归档-yyyyMMdd]-原名`。取消归档必须把这两件事**都**回滚，只把状态改回启用是不够的——
 * 引擎侧还顶着归档前缀，下一轮对账会判成名称漂移，管理员在 RAGFlow 控制台里也会
 * 继续把这个库当成废弃库。
 *
 * <p>实现上**不新开端点**：复用 `PUT /libraries/{id}` 传 `status=1`，后端
 * `KbLibraryService.update` 检测到「原本处于归档态 → 改回启用」时自动改回规范名并
 * 清 `archived_at`（见 P1-T2）。故这里只需一次普通更新调用。
 *
 * <p>做成独立确认框而不是直接在列表点一下就改：恢复会让库重新进入检索范围，
 * 与归档同级的业务影响，需要一次显式确认。
 */
export function KbLibraryUnarchiveDialog({
  library,
  onOpenChange,
  onDone,
}: KbLibraryUnarchiveDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const open = library != null;

  useEffect(() => {
    if (!open) return;
    setSubmitting(false);
  }, [open, library?.id]);

  async function onConfirm(): Promise<void> {
    if (!library) return;
    setSubmitting(true);
    try {
      const updated = await updateLibrary(library.id, {
        name: library.name,
        secrecy: library.secrecy,
        status: 1,
        settings: library.settings ?? null,
      });
      if (updated.engineSyncFailed === true) {
        toast.warning(
          updated.engineSyncMessage ??
            '已取消归档，但引擎侧改名失败，可在「引擎配置 → 存量数据集改名」中修复',
        );
      } else {
        toast.success('已取消归档，引擎侧数据集名称已恢复');
      }
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取消归档失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArchiveRestore className="h-4 w-4" />
            取消归档
          </DialogTitle>
          <DialogDescription>
            将「{library?.name}」恢复为启用状态，并把引擎侧数据集名称改回规范名。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          <p className="text-muted-foreground">
            归档时间：
            <span className="ml-1 text-foreground">{formatTime(library?.archivedAt)}</span>
          </p>
          <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
            <li>本地状态改回「启用」，该库重新进入检索范围；</li>
            <li>引擎侧数据集名去掉「[已归档-日期]」前缀，改回规范名；</li>
            <li>文档与授权在归档期间全部保留，无需重新导入。</li>
          </ul>
          <p className="text-xs text-amber-600">
            若引擎侧改名失败，本地仍会恢复启用（本地语义优先），同步状态标记为异常，
            可到「引擎配置 → 存量数据集改名」中重试。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={submitting} onClick={() => void onConfirm()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            确认恢复
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
