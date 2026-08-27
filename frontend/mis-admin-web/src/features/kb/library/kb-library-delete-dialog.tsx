import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, Copy, Eye, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { deleteLibrary, getEngineRef } from '../api/kb-api';
import type {
  KbEngineCapabilities,
  KbEngineRef,
  KbLibrary,
  KbLibraryDeleteMode,
  KbLibraryDeleteResult,
} from '../types';
import { formatTime } from '../types';

interface KbLibraryDeleteDialogProps {
  /** 待处理的知识库；null = 关闭 */
  library: KbLibrary | null;
  /** 引擎能力（`deleteSupported` 决定「物理删除」是否可选） */
  capabilities: KbEngineCapabilities | null;
  onOpenChange: (open: boolean) => void;
  /** 成功后回调（调用方负责 `invalidateLibraries()` + 重新拉列表） */
  onDone: (result: KbLibraryDeleteResult) => void;
}

/** Q1 警示态文案（engineMissing 提示态 → 确认后 force=true 重调）。 */
const ENGINE_MISSING_WARNING =
  '引擎侧数据集已不存在（可能已在 RAGFlow 控制台手工删除），本地数据未做任何变更；' +
  '确认后将跳过引擎操作，直接删除/归档本地数据。';

/**
 * 知识库归档 / 删除对话框（Q9 + Q11；Q1 两段式确认流扩展）。
 *
 * <p>取代原来的 `window.confirm('删除知识库？其下文档与索引将一并移除。')` ——
 * 那句话是**错的**：当前 RAGFLOW 版本根本没有可用的删除接口，所谓「删除」实际只是
 * 把 MIS 侧的行删掉，引擎里的 dataset 原封不动继续占存储、继续能被别的系统检索到。
 * 管理员据此以为数据没了，是本次 P0 要堵的第一号事故。
 *
 * <p>所以这里把两件事拆开讲清楚：
 * <ul>
 *   <li><b>归档</b>（默认）：引擎侧改名 + 本地停用，数据都还在，可回滚；</li>
 *   <li><b>物理删除</b>：引擎能力位关闭时**不可选**，置灰并说明「升级后开放」，
 *       而不是让人点了再吃一个 40934。</li>
 * </ul>
 *
 * <p><b>Q1 两段式确认流（engineMissing）：</b>首次提交 {@code force=false}，若后端检测到
 * 引擎侧 dataset 已不存在（运维可能在 RAGFlow 控制台手工删除），返回<b>提示态</b>回执
 * （{@code engineMissing=true}，本地零变更）。此时对话框进入警示态：原样展示后端 message +
 * 提示「确认后将跳过引擎操作，直接删除/归档本地数据」，type-to-confirm（输入库名完全一致）
 * 仍生效，点「确认本地删除/归档」以 {@code force=true} 重调；<b>未确认前不触发 onDone、
 * 不 toast.success</b>。
 *
 * <p>type-to-confirm 对物理删除是「防手滑」，对归档同样保留——归档会让库从检索里消失，
 * 误操作的业务影响与删除同级。
 */
export function KbLibraryDeleteDialog({
  library,
  capabilities,
  onOpenChange,
  onDone,
}: KbLibraryDeleteDialogProps) {
  const [mode, setMode] = useState<KbLibraryDeleteMode>('archive');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [forceSubmitting, setForceSubmitting] = useState(false);
  const [result, setResult] = useState<KbLibraryDeleteResult | null>(null);
  const [engineRef, setEngineRef] = useState<KbEngineRef | null>(null);
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  /** Q1 警示态：首次调用（force=false）检测到 engineMissing 后置 true，等待 force 重调。 */
  const [engineMissingPrompt, setEngineMissingPrompt] = useState(false);

  const deleteSupported = capabilities?.deleteSupported === true;
  const open = library != null;

  /* 每次换库/重开都复位，避免上一次的回执与输入串台 */
  useEffect(() => {
    if (!open) return;
    setMode('archive');
    setConfirmText('');
    setResult(null);
    setEngineRef(null);
    setRefError(null);
    setEngineMissingPrompt(false);
  }, [open, library?.id]);

  async function loadEngineRef() {
    if (library == null) return;
    setRefLoading(true);
    setRefError(null);
    try {
      setEngineRef(await getEngineRef(library.id));
    } catch (e) {
      setRefError(e instanceof Error ? e.message : '获取引擎引用失败');
    } finally {
      setRefLoading(false);
    }
  }

  /** 第一段：force=false。引擎缺失 → 进入警示态（本地零变更），否则正常收尾。 */
  async function onSubmit() {
    if (library == null) return;
    setSubmitting(true);
    try {
      const res = await deleteLibrary(library.id, mode, false);
      if (res.engineMissing === true) {
        // Q1 提示态：本地未做任何变更，警示并要求确认后 force=true 重调；
        // 未确认不触发 onDone、不 toast.success
        setEngineMissingPrompt(true);
        return;
      }
      setResult(res);
      // 文案一律用后端回执，不自造「已删除」——归档模式下那是谎话
      if (res.engineSynced === false) {
        toast.warning(res.message ?? '已处理，但引擎侧未同步');
      } else {
        toast.success(res.message ?? (mode === 'archive' ? '已归档' : '已删除'));
      }
      onDone(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  }

  /** 第二段：force=true（仅 engineMissing 警示态触发）。跳过引擎直接本地删除/归档。 */
  async function onConfirmForce() {
    if (library == null) return;
    setForceSubmitting(true);
    try {
      const res = await deleteLibrary(library.id, mode, true);
      setResult(res);
      if (res.engineSynced === false) {
        toast.warning(res.message ?? '已处理，但引擎侧未同步');
      } else {
        toast.success(res.message ?? (mode === 'archive' ? '已归档' : '已删除'));
      }
      onDone(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setForceSubmitting(false);
    }
  }

  function copyRef(value: string) {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success('已复制'))
      .catch(() => toast.error('复制失败，请手动选中'));
  }

  const confirmed = library != null && confirmText.trim() === library.name;
  const busy = submitting || forceSubmitting;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'archive' ? '归档知识库' : '物理删除知识库'}
            {library ? `：${library.name}` : ''}
          </DialogTitle>
          <DialogDescription>
            知识库 #{library?.id ?? '-'}
            {library?.docCount != null ? ` · 文档 ${library.docCount} 篇` : ''}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          /* ------------------------------------------------ 回执态 */
          <div className="space-y-3 text-sm">
            <div
              className={cn(
                'rounded-md border p-3',
                result.engineMissing === true
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : result.engineSynced === false
                    ? 'border-warning/40 bg-warning/10 text-warning'
                    : 'border-success/40 bg-success/10 text-success',
              )}
            >
              <p className="font-medium">{result.message ?? '操作已完成'}</p>
              {result.engineSynced === false && result.engineMissing !== true ? (
                <p className="mt-1 text-xs">
                  引擎侧未同步（{result.engineError ?? '原因未知'}），已记入对账，
                  可在「引擎」页查看差异并重试。
                </p>
              ) : null}
            </div>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <dt>执行模式</dt>
              <dd className="text-foreground">
                {result.mode === 'physical' ? '物理删除' : '归档'}
              </dd>
              {result.archivedName ? (
                <>
                  <dt>引擎侧新名</dt>
                  <dd className="break-all font-mono text-foreground">{result.archivedName}</dd>
                </>
              ) : null}
              <dt>清理文档行</dt>
              <dd className="text-foreground">{result.docCleaned ?? 0}</dd>
              <dt>清理授权行</dt>
              <dd className="text-foreground">{result.aclCleaned ?? 0}</dd>
            </dl>
          </div>
        ) : (
          /* ------------------------------------------------ 表单态（含 Q1 警示态） */
          <div className="space-y-3 text-sm">
            {engineMissingPrompt ? (
              /* Q1 警示态：引擎侧已不存在，本地零变更，等待确认后 force=true 重调 */
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{ENGINE_MISSING_WARNING}</span>
              </div>
            ) : (
              <>
                {/* 模式选择 */}
                <div className="space-y-2">
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md border p-3 text-left',
                      mode === 'archive' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50',
                    )}
                    onClick={() => setMode('archive')}
                  >
                    <Archive className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">
                        归档（推荐）
                        <Badge variant="success">可回滚</Badge>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        引擎侧数据集改名标记归档 + MIS 侧停用，数据完整保留。
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={!deleteSupported}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md border p-3 text-left',
                      !deleteSupported && 'cursor-not-allowed opacity-60',
                      mode === 'physical'
                        ? 'border-destructive bg-destructive/5'
                        : 'border-border hover:bg-accent/50',
                    )}
                    onClick={() => {
                      if (!deleteSupported) return;
                      setMode('physical');
                    }}
                  >
                    <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">
                        物理删除
                        <Badge variant="destructive">不可恢复</Badge>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {deleteSupported
                          ? '先删引擎侧数据集，成功后再删除本地文档、授权与库记录。'
                          : '当前引擎版本不支持在线删除，升级后开放。'}
                      </span>
                    </span>
                  </button>
                </div>

                {/* 影响范围说明：会做什么 / 不会做什么 */}
                {mode === 'archive' ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <p className="mb-1 text-xs font-medium text-foreground">会做什么</p>
                      <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                        <li>引擎侧数据集改名为「[已归档-日期]-原名」</li>
                        <li>MIS 侧状态置为「停用」</li>
                        <li>从检索可见范围中移除</li>
                      </ul>
                    </div>
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <p className="mb-1 text-xs font-medium text-foreground">不会做什么</p>
                      <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                        <li>不删除引擎侧任何数据</li>
                        <li>不删除已上传文档与授权</li>
                        <li>不释放引擎侧存储空间</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      将<b>永久删除</b>引擎侧数据集及本地文档、授权、库记录，且无法恢复。
                      引擎侧删除失败时整体回滚，本地数据不会被清空。
                    </span>
                  </div>
                )}

                {/* 删除指引单（含 dataset_id），需独立权限码 */}
                <PermissionGate
                  permission="kb:library:engine-ref:view"
                  fallback={
                    <p className="rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">
                      「删除指引单」含引擎侧数据集 ID，需 <code>kb:library:engine-ref:view</code>{' '}
                      权限，请联系管理员。
                    </p>
                  }
                >
                  <div className="rounded-md border border-border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">删除指引单（引擎侧手工清理用）</p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={refLoading}
                        onClick={() => void loadEngineRef()}
                      >
                        {refLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                        {engineRef ? '刷新' : '查看'}
                      </Button>
                    </div>
                    {refError ? (
                      <p className="mt-2 text-xs text-destructive">{refError}</p>
                    ) : engineRef ? (
                      <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
                        <dt className="text-muted-foreground">引擎类型</dt>
                        <dd className="text-foreground">{engineRef.engineType ?? '-'}</dd>
                        <dt className="text-muted-foreground">dataset_id</dt>
                        <dd className="flex min-w-0 items-center gap-1">
                          <code className="min-w-0 flex-1 truncate font-mono text-foreground">
                            {engineRef.engineLibraryRef ?? '（未绑定）'}
                          </code>
                          {engineRef.engineLibraryRef ? (
                            <button
                              type="button"
                              aria-label="复制 dataset_id"
                              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={() => copyRef(engineRef.engineLibraryRef as string)}
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          ) : null}
                        </dd>
                        <dt className="text-muted-foreground">最近对账</dt>
                        <dd className="text-foreground">{formatTime(engineRef.engineCheckedAt)}</dd>
                      </dl>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        点「查看」按需拉取；该操作会记入审计日志。
                      </p>
                    )}
                  </div>
                </PermissionGate>
              </>
            )}

            {/* type-to-confirm（警示态同样要求输入库名确认） */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                请输入知识库名称 <b className="text-foreground">{library?.name}</b> 以确认
              </label>
              <Input
                value={confirmText}
                placeholder={library?.name ?? ''}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>关闭</Button>
          ) : (
            <>
              <Button
                variant={
                  engineMissingPrompt || mode === 'physical' ? 'destructive' : 'default'
                }
                disabled={!confirmed || busy}
                onClick={() => void (engineMissingPrompt ? onConfirmForce() : onSubmit())}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {engineMissingPrompt ? '确认本地删除/归档' : mode === 'archive' ? '确认归档' : '确认物理删除'}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
