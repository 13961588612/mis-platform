/**
 * CatalogSyncStatusBar.tsx — 问数 catalog 编辑同步状态条（二期 P0-1~P0-12）。
 *
 * <p>轮询 GET /iqd/catalog/sync-status，渲染 5 态徽标（EDITED_UNSYNCED / SYNCING /
 * SYNCED / SYNC_FAILED / STALE_DRIFT）+ mdl_hash；STALE_DRIFT 时展示橙标横幅
 * 「检测到外部变更，请重新导入」并引导触发重新导入（调 /iqd/catalog/reconcile，按
 * model 范围重建以重新收敛）。
 *
 * <p>状态吃 {@link useSyncStatus} 的**共享 Query**（同一连接全应用一条轮询，空闲 15s /
 * 进行中 5s；与 `SelfHealPanel` 共用同一份缓存，不再各起一条 `setInterval`）。
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { reconcileIqdCatalog, type IqdCatalogEditStatus } from '@/lib/api/iqd';
import { useSyncStatus } from './shared/useSyncStatus';

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

export function CatalogSyncStatusBar({
  connectionId,
  compact = false,
}: {
  connectionId: number | null;
  /** 嵌入父级工具栏时去掉外层卡片边框，仅渲染内容行。 */
  compact?: boolean;
}) {
  const { status, loading, error: syncError, refresh } = useSyncStatus(connectionId);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  /** 轮询错误与对账错误共用一个展示位（对账错误在下一次轮询成功时清掉）。 */
  const error = reconcileError ?? syncError;

  // 新状态到达即清掉上一次的对账错误（对齐改造前「每轮 load() 先清 error」的行为）
  useEffect(() => {
    setReconcileError(null);
  }, [status]);

  const reconcile = async () => {
    if (connectionId == null) return;
    setReconciling(true);
    setReconcileError(null);
    try {
      await reconcileIqdCatalog(connectionId);
      refresh();
    } catch (e) {
      setReconcileError(e instanceof Error ? e.message : '触发对账失败');
    } finally {
      setReconciling(false);
    }
  };

  const editStatus = status?.edit_status as IqdCatalogEditStatus | undefined;
  const driftBanner =
    editStatus === 'STALE_DRIFT' ? (
      <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-warning">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          检测到外部变更（WrenAI 侧 MDL 已偏离平台基线）。请点击「重新导入」触发按 model 范围重建以重新收敛。
        </span>
      </div>
    ) : null;

  // T03e：编辑了但没进 MDL 的节点（如全新建模型/视图/指标）—— 此前只写后端日志，
  // 用户保存成功会误以为已生效，这里如实提示（hover 看清单）。
  const unmatchedBanner =
    (status?.unmatched_edit_count ?? 0) > 0 ? (
      <div
        className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-warning"
        title={(status?.unmatched_edits ?? [])
          .map((it) => `${it.kind ?? '?'} · ${it.display_name ?? it.item_key ?? ''}`)
          .join('\n')}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          {status?.unmatched_edit_count} 项编辑未生效：新建模型 / 视图 / 指标暂不自动物化，
          需在 wren 侧用原生工程补齐（鼠标悬停看清单）。
        </span>
      </div>
    ) : null;

  if (compact) {
    return (
      <>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="shrink-0 font-semibold text-muted-foreground">编辑同步</span>
            {status == null ? (
              <span className="text-muted-foreground">尚未编辑</span>
            ) : (
              <>
                <Badge variant={statusVariant(editStatus)}>
                  {STATUS_LABEL[editStatus ?? ''] ?? editStatus}
                </Badge>
                <span className="text-muted-foreground">
                  版本 {status.current_edit_revision ?? 0}/{status.built_edit_revision ?? 0}
                </span>
                {status.mdl_hash ? (
                  <span className="hidden font-mono xl:inline" title={status.mdl_hash}>
                    mdl {fmtHash(status.mdl_hash)}
                  </span>
                ) : null}
              </>
            )}
            {error ? <span className="text-destructive">{error}</span> : null}
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => refresh()}
                disabled={loading}
              >
                <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8"
                onClick={() => void reconcile()}
                disabled={reconciling || connectionId == null}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重新导入
              </Button>
            </div>
          </div>
        </div>
            {driftBanner ? <div className="w-full basis-full">{driftBanner}</div> : null}
            {unmatchedBanner ? <div className="w-full basis-full">{unmatchedBanner}</div> : null}
      </>
    );
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="shrink-0 font-semibold text-muted-foreground">编辑同步</span>
        {status == null ? (
          <span className="text-muted-foreground">尚未编辑</span>
        ) : (
          <>
            <Badge variant={statusVariant(editStatus)}>
              {STATUS_LABEL[editStatus ?? ''] ?? editStatus}
            </Badge>
            <span className="text-muted-foreground">
              版本 {status.current_edit_revision ?? 0}/{status.built_edit_revision ?? 0}
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
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-8" onClick={() => refresh()} disabled={loading}>
            <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            刷新
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8"
            onClick={() => void reconcile()}
            disabled={reconciling || connectionId == null}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重新导入
          </Button>
        </div>
      </div>
            {driftBanner}
            {unmatchedBanner}
    </div>
  );
}

export default CatalogSyncStatusBar;
