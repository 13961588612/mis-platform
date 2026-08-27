/**
 * SelfHealPanel.tsx — 运维自愈操作区（自愈三按钮，运维手动触发）。
 *
 * <p>置于「语义模型」页 CatalogSyncStatusBar 下方（Q1）。三个动作：
 * <ul>
 *   <li>强制重建（force-rebuild）：context build(force) + memory index；带 gate（进行中 /
 *       SYNCING / stale_drift 禁用）+ 二次确认 Dialog（Q2）。</li>
 *   <li>重新索引（re-index）：memory reset + memory index。</li>
 *   <li>模型校验（validate）：context validate（build_error 含人可读摘要，REQ-8）。</li>
 * </ul>
 *
 * <p>复用 CatalogSyncStatusBar 同款 5000ms 轮询通道（GET /iqd/catalog/sync-status）渲染
 * 构建/编辑态，用于驱动 gate 与失败横幅（REQ-7，复用 STALE_DRIFT 横幅样式）。
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Database, Hammer, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getIqdCatalogSyncStatus,
  selfHealForceRebuild,
  selfHealReindex,
  selfHealValidate,
  type IqdCatalogSyncStatus,
  type IqdSelfHealAction,
  type IqdSelfHealResult,
} from '@/lib/api/iqd';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

function statusVariant(status?: string): BadgeVariant {
  switch (status) {
    case 'success':
    case 'SYNCED':
      return 'default';
    case 'failed':
    case 'SYNC_FAILED':
      return 'destructive';
    case 'running':
    case 'SYNCING':
    case 'EDITED_UNSYNCED':
      return 'secondary';
    default:
      return 'outline';
  }
}

export function SelfHealPanel({ connectionId }: { connectionId: number | null }) {
  const [status, setStatus] = useState<IqdCatalogSyncStatus | null>(null);
  const [loadingAction, setLoadingAction] = useState<IqdSelfHealAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<IqdSelfHealResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 复用 5000ms 轮询通道（与 CatalogSyncStatusBar 同源）驱动 gate / 失败横幅
  const load = async () => {
    if (connectionId == null) {
      setStatus(null);
      return;
    }
    try {
      setStatus(await getIqdCatalogSyncStatus(connectionId));
    } catch (e) {
      // 轮询失败仅降级，不影响按钮可点性，下次轮询重试
      setError(e instanceof Error ? e.message : '获取同步状态失败');
    }
  };

  useEffect(() => {
    void load();
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => void load(), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const editStatus = status?.edit_status;
  const buildStatus = status?.build_status;
  const building = buildStatus === 'running' || buildStatus === 'pending';
  // Q2 gate：有进行中动作 / SYNCING / stale_drift 禁用（三按钮统一 gate）
  const gateBlocked =
    connectionId == null ||
    editStatus === 'SYNCING' ||
    editStatus === 'STALE_DRIFT' ||
    building;
  const gateReason =
    editStatus === 'SYNCING'
      ? '模型同步中，暂不可自愈'
      : editStatus === 'STALE_DRIFT'
        ? '检测到外部漂移，请先「重新导入」收敛'
        : building
          ? '构建任务进行中，暂不可自愈'
          : connectionId == null
            ? '请先保存连接'
            : '';

  const run = async (action: IqdSelfHealAction) => {
    if (connectionId == null) return;
    setLoadingAction(action);
    setError(null);
    try {
      const fn =
        action === 'force_rebuild'
          ? selfHealForceRebuild
          : action === 'reindex'
            ? selfHealReindex
            : selfHealValidate;
      const result = await fn(connectionId);
      setLastResult(result);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} 触发失败`);
    } finally {
      setLoadingAction(null);
    }
  };

  const onForceRebuild = () => {
    if (gateBlocked) return;
    setConfirmOpen(true);
  };
  const onConfirmForceRebuild = async () => {
    setConfirmOpen(false);
    await run('force_rebuild');
  };

  const failed = lastResult != null && lastResult.build_status === 'failed';

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-muted-foreground">运维自愈</span>
        <span className="text-muted-foreground">手动触发 WrenAI 自愈动作（运维）</span>
        {status != null ? (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">构建</span>
            <Badge variant={statusVariant(buildStatus)}>{buildStatus ?? '—'}</Badge>
          </span>
        ) : null}
        {error ? <span className="text-destructive">{error}</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={onForceRebuild}
          disabled={gateBlocked || loadingAction !== null}
          title={gateBlocked ? gateReason : '强制重建语义模型（context build --force + memory index）'}
        >
          <Hammer className={loadingAction === 'force_rebuild' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          强制重建
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void run('reindex')}
          disabled={gateBlocked || loadingAction !== null}
          title={gateBlocked ? gateReason : '重新索引（memory reset + memory index）'}
        >
          <Database className={loadingAction === 'reindex' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          重新索引
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void run('validate')}
          disabled={gateBlocked || loadingAction !== null}
          title={gateBlocked ? gateReason : '模型校验（context validate）'}
        >
          <ShieldCheck className={loadingAction === 'validate' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          模型校验
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void load()}
          disabled={loadingAction !== null}
        >
          <RefreshCw className="h-4 w-4" />
          刷新状态
        </Button>
      </div>

      {/* REQ-7 失败横幅：复用 STALE_DRIFT 横幅样式（border-warning/40 bg-warning/5 text-warning） */}
      {failed ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {lastResult && lastResult.build_error
              ? lastResult.build_error
              : '自愈动作失败，请查看同步状态'}
          </span>
        </div>
      ) : null}

      {/* Q2 强制重建二次确认 Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认强制重建？</DialogTitle>
            <DialogDescription>
              强制重建将执行 <span className="font-mono">context build --force</span> 并重新下发记忆索引，
              会覆盖当前 WrenAI 已部署的语义模型。请确认当前无进行中的同步任务。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={loadingAction !== null}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => void onConfirmForceRebuild()}
              disabled={loadingAction !== null}
            >
              {loadingAction === 'force_rebuild' ? '重建中…' : '确认重建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SelfHealPanel;
