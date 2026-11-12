/**
 * SelfHealPanel.tsx — 运维自愈操作区（自愈三按钮，运维手动触发）。
 *
 * <p>置于「语义模型」页 CatalogSyncStatusBar 下方（Q1）。三个动作：
 * <ul>
 *   <li>强制重建（force-rebuild）：context build(force) + memory index；带 gate（进行中 /
 *       SYNCING / stale_drift 禁用）+ 二次确认 Dialog（Q2）。</li>
 *   <li>重新索引（re-index）：memory reset + memory index。</li>
 *   <li>模型校验（validate）：context validate；失败/警告均可逐条查看（REQ-8）。</li>
 * </ul>
 *
 * <p>状态吃 {@link useSyncStatus} 的**共享 Query**（GET /iqd/catalog/sync-status；与
 * `CatalogSyncStatusBar` 同一份缓存、同一条轮询，空闲 15s / 进行中 5s），渲染构建/编辑态，
 * 用于驱动 gate 与失败横幅（REQ-7，复用 STALE_DRIFT 横幅样式）。
 */
import { useEffect, useMemo, useState } from 'react';
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
  selfHealForceRebuild,
  selfHealReindex,
  selfHealValidate,
  type IqdSelfHealAction,
  type IqdSelfHealResult,
} from '@/lib/api/iqd';
import { useSyncStatus } from './shared/useSyncStatus';

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

/** 从校验结果抽出可逐条展示的条目（warnings 优先，其次拆 build_error / raw）。 */
const COUNT_ONLY_RE = /^\d+\s*warning\(s\)\s*,\s*\d+\s*errors?\.?$/i;
/** Wren 成功库存摘要，不是警告（如 Valid — 6 models, 0 views, 3 relationships.）。 */
const VALID_INVENTORY_RE = /^\s*valid\b/i;

function collectFindings(result: IqdSelfHealResult | null): string[] {
  if (result == null) return [];
  const fromWarnings = (result.warnings ?? [])
    .map((w) => w.trim())
    .filter((w) => w && !COUNT_ONLY_RE.test(w) && !VALID_INVENTORY_RE.test(w));
  if (fromWarnings.length > 0) return [...new Set(fromWarnings)];

  const raw = (result as IqdSelfHealResult & { raw?: string | null }).raw;
  if (typeof raw === 'string' && raw.trim()) {
    const section = parseWrenWarningSection(raw);
    if (section.length > 0) return section;
  }

  const err = (result.build_error ?? '').trim();
  if (!err || COUNT_ONLY_RE.test(err)) return fromWarnings.length ? fromWarnings : err ? [err] : [];
  const parts = err
    .split(/;\s*|\n+/)
    .map((p) => p.trim())
    .filter((p) => p && !COUNT_ONLY_RE.test(p));
  return parts.length > 0 ? [...new Set(parts)] : [err];
}

/** 前端兜底：解析 Wren `Warnings:` 分区（后端未升级时也能展示明细）。 */
function parseWrenWarningSection(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let mode: 'warnings' | 'errors' | null = null;
  for (const raw of lines) {
    const ln = raw.trim();
    if (!ln) continue;
    if (COUNT_ONLY_RE.test(ln)) {
      mode = null;
      continue;
    }
    const low = ln.toLowerCase();
    if (low === 'warnings:' || low === 'warning:' || low === 'warnings') {
      mode = 'warnings';
      continue;
    }
    if (low === 'errors:' || low === 'error:' || low === 'errors') {
      mode = 'errors';
      continue;
    }
    if (mode === 'warnings' || mode === 'errors') {
      const item = ln.replace(/^[\s\-•·▪►▶⚠⚠️*]+/u, '').trim();
      if (item) out.push(item);
    }
  }
  return out;
}

/** 仅警告（含「N warning(s), 0 errors」）时，前端不得当硬失败展示。 */
function isValidateSoftWarning(result: IqdSelfHealResult | null): boolean {
  if (result == null) return false;
  if (result.build_status === 'success' && (result.warnings?.length ?? 0) > 0) return true;
  const blob = `${result.build_error ?? ''}\n${(result.warnings ?? []).join('\n')}`;
  const m = blob.match(/(\d+)\s*warning\(s\)\s*,\s*(\d+)\s*errors?/i);
  if (m && Number(m[2]) === 0) return true;
  return false;
}

export function SelfHealPanel({
  connectionId,
  compact = false,
}: {
  connectionId: number | null;
  /** 嵌入父级工具栏时去掉外层卡片边框，仅渲染按钮行。 */
  compact?: boolean;
}) {
  const { status, error: syncError, refresh } = useSyncStatus(connectionId);
  const [loadingAction, setLoadingAction] = useState<IqdSelfHealAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<IqdSelfHealResult | null>(null);
  const [lastAction, setLastAction] = useState<IqdSelfHealAction | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  /** 轮询错误与动作错误共用一个展示位（轮询错误在下一次成功拉取时自动消失）。 */
  const error = actionError ?? syncError;

  // 切连接清空瞬时结果，避免串扰
  useEffect(() => {
    setLastResult(null);
    setLastAction(null);
    setDetailOpen(false);
    setActionError(null);
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
            ? '请先选择连接'
            : '';

  const findings = useMemo(() => collectFindings(lastResult), [lastResult]);
  const softWarning =
    lastAction === 'validate' && isValidateSoftWarning(lastResult);
  const failed =
    lastResult != null &&
    lastResult.build_status === 'failed' &&
    !softWarning;
  const hasFindings = findings.length > 0;

  const run = async (action: IqdSelfHealAction) => {
    if (connectionId == null) return;
    setLoadingAction(action);
    setActionError(null);
    setDetailOpen(false);
    try {
      const fn =
        action === 'force_rebuild'
          ? selfHealForceRebuild
          : action === 'reindex'
            ? selfHealReindex
            : selfHealValidate;
      const result = await fn(connectionId);
      setLastResult(result);
      setLastAction(action);
      refresh();
      // 校验有警告/失败时自动打开详情，避免「有 N 条警告却看不到」
      const nextFindings = collectFindings(result);
      if (action === 'validate' && (result.build_status === 'failed' || nextFindings.length > 0)) {
        setDetailOpen(true);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : `${action} 触发失败`);
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

  const resultBanner =
    lastAction != null && lastResult != null ? (
      failed || hasFindings ? (
        <div
          className={`flex flex-wrap items-center gap-2 rounded-md border p-2 ${
            failed
              ? 'border-destructive/40 bg-destructive/5 text-destructive'
              : 'border-warning/40 bg-warning/5 text-warning'
          }`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-xs">
            {lastAction === 'validate'
              ? failed
                ? `模型校验未通过（${findings.length || 1} 条）`
                : `模型校验通过，但有 ${findings.length} 条警告`
              : lastResult.build_error || '自愈动作失败，请查看同步状态'}
          </span>
          {(hasFindings || (lastResult.build_error ?? '').trim()) && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setDetailOpen(true)}
            >
              查看详情
            </Button>
          )}
        </div>
      ) : lastAction === 'validate' ? (
        <div className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
          {(() => {
            const inventory =
              (lastResult.summary ?? '').trim() ||
              (lastResult.warnings ?? []).map((w) => w.trim()).find((w) => VALID_INVENTORY_RE.test(w)) ||
              '';
            return inventory
              ? `模型校验通过：${inventory}`
              : '模型校验通过，未发现警告';
          })()}
        </div>
      ) : null
    ) : null;

  const confirmDialog = (
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
  );

  const detailDialog = (
    <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {lastAction === 'validate'
              ? failed
                ? '模型校验未通过'
                : '模型校验警告'
              : '自愈动作详情'}
          </DialogTitle>
          <DialogDescription>
            {lastAction === 'validate'
              ? failed
                ? '以下问题需修正后再发布 / 重建。'
                : '校验整体通过，但仍有警告，建议按条排查。'
              : '最近一次自愈动作返回的说明。'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto rounded-md border bg-muted/20 p-3">
          {hasFindings ? (
            <ol className="list-decimal space-y-2 pl-4 text-sm">
              {findings.map((item, idx) => (
                <li key={`${idx}-${item.slice(0, 24)}`} className="break-words leading-relaxed">
                  {item}
                </li>
              ))}
            </ol>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {lastResult?.build_error || '无详细信息'}
            </pre>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDetailOpen(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-1.5">
      {compact ? (
        <>
          <span className="mr-1 shrink-0 text-xs font-semibold text-muted-foreground">运维自愈</span>
          {status?.build_status ? (
            <Badge variant={statusVariant(buildStatus)} className="h-6">
              {buildStatus}
            </Badge>
          ) : null}
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </>
      ) : null}
      <Button
        size="sm"
        variant="destructive"
        className="h-8"
        onClick={onForceRebuild}
        disabled={gateBlocked || loadingAction !== null}
        title={gateBlocked ? gateReason : '强制重建语义模型（context build --force + memory index）'}
      >
        <Hammer className={loadingAction === 'force_rebuild' ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
        强制重建
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="h-8"
        onClick={() => void run('reindex')}
        disabled={gateBlocked || loadingAction !== null}
        title={gateBlocked ? gateReason : '重新索引（memory reset + memory index）'}
      >
        <Database className={loadingAction === 'reindex' ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
        重新索引
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        onClick={() => void run('validate')}
        disabled={gateBlocked || loadingAction !== null}
        title={gateBlocked ? gateReason : '模型校验（context validate）'}
      >
        <ShieldCheck className={loadingAction === 'validate' ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
        模型校验
      </Button>
      {!compact ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={() => refresh()}
          disabled={loadingAction !== null}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          刷新状态
        </Button>
      ) : null}
    </div>
  );

  if (compact) {
    return (
      <>
        <div className="shrink-0">{actions}</div>
        {resultBanner ? <div className="w-full basis-full">{resultBanner}</div> : null}
        {confirmDialog}
        {detailDialog}
      </>
    );
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border bg-card p-3 text-xs">
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
      {actions}
      {resultBanner}
      {confirmDialog}
      {detailDialog}
    </div>
  );
}

export default SelfHealPanel;
