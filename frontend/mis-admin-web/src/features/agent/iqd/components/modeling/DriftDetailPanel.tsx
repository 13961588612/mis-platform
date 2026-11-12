/**
 * DriftDetailPanel.tsx — 外部漂移详情面板（v1.11 MR-11；T04b）。
 *
 * <h2>定位</h2>
 * 把既有 {@link CatalogSyncStatusBar} 的 `STALE_DRIFT` 态从「一行橙标 + 一句提示」升级为
 * **可展开详情面板**：展示平台编辑版本（`current/built edit_revision`）vs WrenAI 侧
 * `mdl_hash`、最近观测时间、**疑似外部变更对象清单**，并在漂移期间把「强制重建」
 * **置灰（fail-closed）**、只放行「重新导入」入口。
 *
 * <h2>数据来源（Q5 单源；不另起轮询）</h2>
 * <ul>
 *   <li>{@link useSyncStatus}：与发布流水线/状态条**同口径 5000ms 轮询**（复用既有 hook，
 *       不新建 `setInterval`）；</li>
 *   <li>{@link useCatalogNodes}：与画布/左树/右栏**同一份 catalog 缓存**（Q5）——仅用于
 *       挑「疑似外部来源对象」（见 {@link selectDriftDiffItems} 的启发式说明）。</li>
 * </ul>
 *
 * <h2>「重新导入」（A-03 / R-9）</h2>
 * **只做入口跳转，不复制流程**：跳到既有 `/iqd/catalog` 页（其 `CatalogSyncStatusBar` +
 * `SelfHealPanel` 承载漂移横幅与对账按钮，即既有 `syncCatalogFromMdl` 收敛入口）。
 * 精确的「比对合并草稿界面」二期 P1-3 未完全就绪（R-9），故此处**不**自造合并 UI。
 *
 * <h2>非漂移时不渲染</h2>
 * 组件自身守卫：`edit_status !== 'STALE_DRIFT' && stale_drift !== true` → 返回 `null`
 * （调用方可无条件挂载，不产生空壳）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ExternalLink, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useIqdModelingPermission } from '../shared/usePermission';
import { useSyncStatus } from '../shared/useSyncStatus';
import { useCatalogNodes } from '../../hooks/useCatalogNodes';
import {
  DRIFT_PERMISSIONS,
  SYNC_FROM_MDL_ENTRY_PATH,
  formatMdlHash,
  forceRebuildBlockReason,
  reconcileBlockReason,
  resolveDriftView,
} from './driftUtils';

/** `DriftDetailPanel` Props。 */
export interface DriftDetailPanelProps {
  /** **数字**连接 id（与画布/状态条同一 cache key；null = 无连接）。 */
  connectionId: number | null;
}

/** 本地时刻 → `HH:mm:ss`（展示「最近观测」；无效 → `—`）。 */
function formatClock(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

/** 漂移详情面板（非漂移时不渲染）。 */
export function DriftDetailPanel({ connectionId }: DriftDetailPanelProps) {
  const navigate = useNavigate();
  const { hasPermission } = useIqdModelingPermission();
  const sync = useSyncStatus(connectionId);
  const { catalog } = useCatalogNodes(connectionId);

  /** 最近一次成功观测时刻（本地；服务端暂无该字段，见 driftUtils 文件头 TODO）。 */
  const [observedAt, setObservedAt] = useState<string | null>(null);
  useEffect(() => {
    if (sync.status) {
      setObservedAt(new Date().toISOString());
    }
  }, [sync.status]);

  const view = useMemo(
    () => resolveDriftView(sync.status, catalog, observedAt),
    [sync.status, catalog, observedAt],
  );

  const canReconcile = hasPermission(DRIFT_PERMISSIONS.reconcile);
  const canSelfHeal = hasPermission(DRIFT_PERMISSIONS.selfHeal);
  const reconcileReason = reconcileBlockReason(canReconcile);
  const rebuildReason = forceRebuildBlockReason(view.drifting, canSelfHeal);

  // 非漂移 → 不渲染（调用方可无条件挂载）
  if (!view.drifting) {
    return null;
  }

  return (
    <Collapsible
      defaultOpen
      className="rounded-md border border-warning/50 bg-warning/5 text-[12px] text-warning"
    >
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 text-left font-medium"
            aria-label="展开/收起漂移详情"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            检测到外部漂移（WrenAI 侧 MDL 已偏离平台基线）
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </CollapsibleTrigger>
        <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]">
          STALE_DRIFT
        </Badge>
        <span className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => sync.refresh()}
            disabled={sync.loading}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            刷新
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7"
            title={reconcileReason || '进入既有「重新导入」比对合并入口（/iqd/catalog）'}
            disabled={reconcileReason !== ''}
            onClick={() => navigate(SYNC_FROM_MDL_ENTRY_PATH)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            重新导入
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            title={rebuildReason || '强制重建（context build --force + memory index）'}
            disabled={rebuildReason !== ''}
            onClick={() => {
              /* fail-closed：漂移期间不可点（disabled 兜住）。收敛后由发布流水线条承接重建。 */
            }}
          >
            强制重建
          </Button>
        </span>
      </div>

      <CollapsibleContent>
        <div className="space-y-2 border-t border-warning/40 px-2.5 py-2">
          {/* 版本 vs MDL 指纹 */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
            <div className="flex flex-col">
              <dt className="text-warning/70">平台当前编辑版本</dt>
              <dd className="font-mono">{view.currentEditRevision}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-warning/70">平台已写回版本</dt>
              <dd className="font-mono">
                {view.builtEditRevision}
                {view.revisionLag > 0 ? (
                  <span className="ml-1 text-warning/80">（落后 {view.revisionLag}）</span>
                ) : null}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-warning/70">WrenAI MDL 指纹</dt>
              <dd className="font-mono" title={view.mdlHash ?? ''}>
                {formatMdlHash(view.mdlHash)}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-warning/70">最近观测时间</dt>
              <dd className="font-mono" title="前端最近一次成功拉取 sync-status 的本地时刻">
                {formatClock(view.observedAt)}
                <span className="ml-1 text-[10px] text-warning/70">（本地）</span>
              </dd>
            </div>
          </dl>

          {/* 疑似外部变更对象清单 */}
          <div className="rounded border border-warning/40 bg-background/40 px-2 py-1.5">
            <p className="font-medium">
              疑似外部变更对象（{view.diffItems.length}）
              {view.diffCountByKind.length > 0 ? (
                <span className="ml-1 font-normal text-muted-foreground">
                  {view.diffCountByKind.map((entry) => `${entry.kind}×${entry.count}`).join('、')}
                </span>
              ) : null}
            </p>
            {/* TODO(drift-diff-endpoint)：精确 diff 需后端比对端点；此处为「非平台来源」启发式。
                TODO(drift-reconcile-time)：精确「最近对账时间」需后端在 sync-status 补字段。 */}
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              启发式口径：列出「非平台来源」（source ∉ platform_edit/modeling）的 catalog 项，
              作为排查外部直改的起点；精确到项的比对待后端提供 diff 端点。
            </p>
            {view.diffItems.length === 0 ? (
              <p className="mt-1 text-muted-foreground">未发现非平台来源的对象。</p>
            ) : (
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
                {view.diffItems.slice(0, 50).map((item) => (
                  <li key={item.itemKey} className="truncate text-muted-foreground">
                    <Badge variant="outline" className="mr-1 h-4 px-1 text-[10px]">
                      {item.kind}
                    </Badge>
                    <code className="text-[11px]">{item.itemKey}</code>
                    <span className="ml-1 text-[10px]">（source={item.source}）</span>
                  </li>
                ))}
                {view.diffItems.length > 50 ? (
                  <li className="text-[11px] text-muted-foreground">
                    仅显示前 50 项，共 {view.diffItems.length} 项。
                  </li>
                ) : null}
              </ul>
            )}
          </div>

          <p className="text-[11px] text-warning/80">
            漂移收敛策略（fail-closed）：先「重新导入」让平台基线重新收敛，再执行构建；
            在此期间「强制重建」置灰，避免在已发散的数据上强行覆盖。
            重新导入沿用既有 <code>syncCatalogFromMdl</code> 收敛流程（入口跳转，不复制流程）。
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default DriftDetailPanel;
