/**
 * CatalogSyncStatusBar.tsx — 问数 catalog 编辑同步状态条（二期 P0-1~P0-12）。
 *
 * <p>轮询 GET /iqd/catalog/sync-status，渲染 5 态徽标（EDITED_UNSYNCED / SYNCING /
 * SYNCED / SYNC_FAILED / STALE_DRIFT）+ mdl_hash；STALE_DRIFT 时展示橙标横幅
 * 「检测到外部变更，请重新导入」并引导触发重新导入（调 /iqd/catalog/reconcile，按
 * model 范围重建以重新收敛）。
 *
 * <p>沿用一期 SyncStatusBar 轮询范式（5000ms；Q5）。
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  getIqdCatalogSyncStatus,
  reconcileIqdCatalog,
  type IqdCatalogEditStatus,
  type IqdCatalogSyncStatus,
} from '@/lib/api/iqd';

const STATUS_LABEL: Record<string, string> = {
  EDITED_UNSYNCED: '待同步',
  SYNCING: '同步中',
  SYNCED: '已同步',
  SYNC_FAILED: '同步失败',
  STALE_DRIFT: '外部漂移',
};

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

function statusVariant(status?: string): BadgeVariant {
  switch (status) {
    case 'SYNCED':
      return 'default';
    case 'EDITED_UNSYNCED':
    case 'SYNCING':
      return 'secondary';
    case 'SYNC_FAILED':
    case 'STALE_DRIFT':
      return 'destructive';
    default:
      return 'outline';
  }
}

function fmtHash(v?: string | null): string {
  if (!v) return '—';
  return String(v).slice(0, 12) + '…';
}

export function CatalogSyncStatusBar({ connectionId }: { connectionId: number | null }) {
  const [status, setStatus] = useState<IqdCatalogSyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    if (connectionId == null) {
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setStatus(await getIqdCatalogSyncStatus(connectionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取编辑同步状态失败');
    } finally {
      setLoading(false);
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

  const reconcile = async () => {
    if (connectionId == null) return;
    setReconciling(true);
    setError(null);
    try {
      await reconcileIqdCatalog(connectionId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '触发对账失败');
    } finally {
      setReconciling(false);
    }
  };

  const editStatus = status?.edit_status as IqdCatalogEditStatus | undefined;

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-muted-foreground">模型编辑同步</span>
        {status == null ? (
          <span className="text-muted-foreground">尚未编辑</span>
        ) : (
          <>
            <span className="flex items-center gap-1">
              <span className="text-muted-foreground">编辑态</span>
              <Badge variant={statusVariant(editStatus)}>
                {STATUS_LABEL[editStatus ?? ''] ?? editStatus}
              </Badge>
            </span>
            <span className="text-muted-foreground">
              版本 {status.current_edit_revision ?? 0} / 已写回 {status.built_edit_revision ?? 0}
            </span>
            {status.mdl_hash ? (
              <span className="font-mono" title={status.mdl_hash}>
                mdl {fmtHash(status.mdl_hash)}
              </span>
            ) : null}
            {status.build_status ? (
              <span className="text-muted-foreground">构建 {status.build_status}</span>
            ) : null}
          </>
        )}
        {error ? <span className="text-destructive">{error}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            刷新
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void reconcile()}
            disabled={reconciling || connectionId == null}
          >
            <RotateCcw className="h-4 w-4" />
            重新导入
          </Button>
        </div>
      </div>
      {editStatus === 'STALE_DRIFT' ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            检测到外部变更（WrenAI 侧 MDL 已偏离平台基线）。请点击「重新导入」触发按 model 范围重建以重新收敛。
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default CatalogSyncStatusBar;
