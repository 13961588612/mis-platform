import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, History, PlayCircle, RefreshCw, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  getRenameLogsByBatch,
  listRenameLogs,
  renameDatasets,
  rollbackRenameDatasets,
} from '../api/kb-api';
import { useKbStore } from '../stores/use-kb-store';
import type {
  KbEngineRenameItem,
  KbEngineRenameLog,
  KbEngineRenameResult,
} from '../types';
import { formatTime } from '../types';

/** 执行令牌：必须与后端 {@code KbEngineLegacyRenameService.CONFIRM_TOKEN} 一致。 */
const CONFIRM_TOKEN = 'RENAME-LEGACY';

/** 单个重命名单体动作的中文标签。 */
const ACTION_LABEL: Record<string, string> = {
  RENAME: '改名',
  SKIP: '跳过',
  FAILED: '失败',
};

/**
 * 存量引擎 dataset 批量重命名（P1-T4，方案 X：受控端点）。
 *
 * <p>设计要点：
 * <ul>
 *   <li>默认只「预览」出计划（dry-run），「执行」必须输入确认令牌 {@code RENAME-LEGACY}；</li>
 *   <li>反复点「预览 / 执行」直到「将重命名 0 个」即全量完成（幂等，已规范的全 SKIP）；</li>
 *   <li>历史批次可逐批回滚（只回滚该批次执行成功的行）；</li>
 *   <li>非 ragflow 引擎不支持引擎侧改名，给出明确降级说明而非报错。</li>
 * </ul>
 */
export function KbEngineRenameCard() {
  const engineType = useKbStore(
    (s) => s.health?.engineType ?? s.capabilities?.engineType ?? null,
  );

  const [limit, setLimit] = useState<number>(50);
  const [confirmToken, setConfirmToken] = useState('');
  const [plan, setPlan] = useState<KbEngineRenameResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [showExecConfirm, setShowExecConfirm] = useState(false);
  const [logs, setLogs] = useState<KbEngineRenameLog[]>([]);
  const [batchLogs, setBatchLogs] = useState<Record<string, KbEngineRenameLog[]>>({});
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setLogs(await listRenameLogs(200));
    } catch {
      // 历史读取失败不阻断主流程
    }
  }, []);

  useEffect(() => {
    if (engineType === 'ragflow') void loadHistory();
  }, [engineType, loadHistory]);

  const toPreview = useCallback(async () => {
    setPreviewing(true);
    setError(null);
    try {
      const res = await renameDatasets({ dryRun: true, limit });
      setPlan(res);
      // 后端护栏：非 ragflow 引擎返回 engineSkipped=true（与对账 skipped 口径一致）
      if (res.engineSkipped) {
        setError(res.skipReason ?? '当前引擎不支持该操作');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败');
    } finally {
      setPreviewing(false);
    }
  }, [limit]);

  const doExecute = useCallback(async () => {
    setShowExecConfirm(false);
    setExecuting(true);
    setError(null);
    try {
      const res = await renameDatasets({ dryRun: false, confirmToken, limit });
      setPlan(res);
      if (res.engineSkipped) {
        setError(res.skipReason ?? '当前引擎不支持该操作');
        setConfirmToken('');
        return;
      }
      toast.success(
        `执行完成：重命名 ${res.renamed ?? 0}，跳过 ${res.skipped ?? 0}，失败 ${res.failed ?? 0}`,
      );
      setConfirmToken('');
      await loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '执行失败');
    } finally {
      setExecuting(false);
    }
  }, [confirmToken, limit, loadHistory]);

  const onRollback = useCallback(
    async (batchId: string) => {
      setRollingBack(batchId);
      try {
        await rollbackRenameDatasets(batchId);
        toast.success('已回滚该批次');
        await loadHistory();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '回滚失败');
      } finally {
        setRollingBack(null);
      }
    },
    [loadHistory],
  );

  const toggleBatchLogs = useCallback(
    async (batchId: string) => {
      if (expandedBatch === batchId) {
        setExpandedBatch(null);
        return;
      }
      setExpandedBatch(batchId);
      if (!batchLogs[batchId]) {
        try {
          const rows = await getRenameLogsByBatch(batchId);
          setBatchLogs((prev) => ({
            ...prev,
            [batchId]: rows,
          }));
        } catch {
          // 明细读取失败不阻断
        }
      }
    },
    [expandedBatch, batchLogs],
  );

  // 非 ragflow 引擎不支持引擎侧 dataset 改名，给出明确降级说明而非报错。
  if (engineType != null && engineType !== 'ragflow') {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">存量数据集改名（受控）</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          当前引擎（{engineType}）不支持引擎侧 dataset 改名，本功能仅对 ragflow 引擎生效。
        </p>
      </div>
    );
  }

  // 把扁平日志按 batchId 聚合成批次列表（含成功/失败计数与批次时间）。
  const batches = useMemo(() => {
    const map = new Map<string, KbEngineRenameLog[]>();
    for (const row of logs) {
      if (!row.batchId) continue;
      const list = map.get(row.batchId) ?? [];
      list.push(row);
      map.set(row.batchId, list);
    }
    return Array.from(map.entries()).map(([batchId, rows]) => {
      const success = rows.filter((r) => r.status === 1).length;
      const failed = rows.filter((r) => r.status === 2).length;
      let createdAt: string | null = null;
      for (const r of rows) {
        if (r.createdAt && (createdAt == null || r.createdAt > createdAt)) {
          createdAt = r.createdAt;
        }
      }
      return { batchId, rows, success, failed, createdAt };
    });
  }, [logs]);

  const renameCount = plan?.items
    ? plan.items.filter((it: KbEngineRenameItem) => it.action === 'RENAME').length
    : 0;

  return (
    <PermissionGate permission="kb:engine:dataset:rename">
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">存量数据集改名（受控）</h3>
          <Badge variant="outline" className="font-mono">
            方案 X
          </Badge>
        </div>

        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          线上会真实修改引擎侧 dataset 名称，请在运维窗口、确认无进行中上传 / 检索任务时执行。
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">单次处理上限（默认 50，上限 200）</label>
            <Input
              type="number"
              value={limit}
              min={1}
              max={200}
              onChange={(e) => setLimit(Number(e.target.value) || 50)}
              className="w-40"
            />
          </div>
          <Button variant="outline" disabled={previewing} onClick={() => void toPreview()}>
            {previewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            预览
          </Button>
          <Button
            disabled={executing || confirmToken !== CONFIRM_TOKEN}
            onClick={() => {
              if (confirmToken !== CONFIRM_TOKEN) {
                toast.warning(`请输入确认令牌 ${CONFIRM_TOKEN}`);
                return;
              }
              setShowExecConfirm(true);
            }}
          >
            {executing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            执行改名
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs text-muted-foreground">确认令牌</label>
          <Input
            value={confirmToken}
            onChange={(e) => setConfirmToken(e.target.value)}
            placeholder={CONFIRM_TOKEN}
            className="w-56 font-mono"
          />
          {confirmToken === CONFIRM_TOKEN ? (
            <Badge variant="success">已就绪</Badge>
          ) : (
            <Badge variant="secondary">未激活</Badge>
          )}
        </div>

        {error ? (
          <p className="mt-3 text-sm text-destructive">{error}</p>
        ) : plan ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">共 {plan.total ?? 0}</Badge>
              {plan.dryRun ? (
                <Badge variant="warning">将重命名 {renameCount}</Badge>
              ) : (
                <>
                  <Badge variant="success">已重命名 {plan.renamed ?? 0}</Badge>
                  <Badge variant="secondary">跳过 {plan.skipped ?? 0}</Badge>
                  {plan.failed ? <Badge variant="destructive">失败 {plan.failed}</Badge> : null}
                </>
              )}
            </div>

            {plan.items && plan.items.length > 0 ? (
              <ul className="max-h-72 divide-y divide-border/60 overflow-auto rounded-md border">
                {plan.items.map((it, i) => (
                  <li key={i} className="px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          it.action === 'SKIP'
                            ? 'secondary'
                            : it.action === 'FAILED'
                              ? 'destructive'
                              : 'warning'
                        }
                      >
                        {ACTION_LABEL[it.action ?? ''] ?? it.action}
                      </Badge>
                      <span className="font-mono text-xs">#{it.libraryId ?? '-'}</span>
                      <span className="truncate text-muted-foreground">
                        {it.oldName ?? '-'} → {it.newName ?? '-'}
                      </span>
                    </div>
                    {it.error ? (
                      <p className="mt-1 text-xs text-destructive">{it.error}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">没有需要改名的 dataset。</p>
            )}

            {!plan.dryRun && plan.failed ? (
              <p className="text-xs text-destructive">
                有 {plan.failed} 个改名失败，可稍后重试；失败的 dataset 仍在漂移状态，不影响其余项。
              </p>
            ) : null}
          </div>
        ) : null}

        {/* 历史批次：按 batchId 聚合，支持逐批回滚。 */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-medium">历史批次</h4>
            <Button size="sm" variant="outline" onClick={() => void loadHistory()}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </div>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无改名额次。</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-md border">
              {batches.map((b) => (
                <li key={b.batchId} className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs">{b.batchId}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(b.createdAt)}
                      </span>
                      <Badge variant="success">成功 {b.success}</Badge>
                      {b.failed > 0 ? (
                        <Badge variant="destructive">失败 {b.failed}</Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void toggleBatchLogs(b.batchId)}
                      >
                        {expandedBatch === b.batchId ? '收起' : '明细'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rollingBack === b.batchId || b.success === 0}
                        onClick={() => void onRollback(b.batchId)}
                      >
                        {rollingBack === b.batchId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                        回滚
                      </Button>
                    </div>
                  </div>
                  {expandedBatch === b.batchId && batchLogs[b.batchId] ? (
                    <ul className="mt-2 space-y-1 border-t border-border/50 pt-2">
                      {batchLogs[b.batchId].map((row) => (
                        <li
                          key={row.id ?? `${row.nativeId}-${row.createdAt}`}
                          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                        >
                          <Badge
                            variant={
                              row.status === 1
                                ? 'success'
                                : row.status === 2
                                  ? 'destructive'
                                  : 'secondary'
                            }
                          >
                            {ACTION_LABEL[row.action ?? ''] ?? row.action}
                          </Badge>
                          <span className="font-mono">#{row.libraryId ?? '-'}</span>
                          <span className="truncate">
                            {row.oldName ?? '-'} → {row.newName ?? '-'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 执行前二次确认：高危批量改名，确认后按批次执行。 */}
        <Dialog open={showExecConfirm} onOpenChange={(v) => (v ? null : setShowExecConfirm(false))}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>确认执行存量数据集改名？</DialogTitle>
              <DialogDescription>
                将按规范名批量修改引擎侧 dataset 名称（最多 {limit} 个），修改后名称与
                对账期望一致；若中途失败，可从「历史批次」按批次回滚。
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              线上会真实修改引擎侧 dataset 名称，请确认无进行中上传 / 检索任务后执行。
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={executing} onClick={() => setShowExecConfirm(false)}>
                取消
              </Button>
              <Button disabled={executing} onClick={() => void doExecute()}>
                {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                确认执行
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionGate>
  );
}
