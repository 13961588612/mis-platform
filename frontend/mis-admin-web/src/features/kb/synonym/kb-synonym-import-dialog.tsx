import { useRef, useState, type ChangeEvent } from 'react';
import { Download, FileUp, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { commitSynonymImport, downloadRejectedRows, precheckSynonymImport } from '../api/kb-api';
import type { KbSynonymImportCommit, KbSynonymImportPrecheck } from '../types';
import { synonymImportActionLabel } from '../types';

/**
 * 阶段机。
 *
 * <p>`report` 是**唯一**允许出现「确认导入」按钮的阶段——没有预检报告就没有提交入口，
 * 这是两段式导入的硬判据，不是样式偏好。
 */
type Stage = 'select' | 'prechecking' | 'report' | 'committing' | 'done' | 'error';

/** 预检后词表被他人改动的结果码（设计 §7.5：`KB_SYNONYM_IMPORT_STALE`）。 */
const KB_SYNONYM_IMPORT_STALE = 40930;

const fieldLabel = 'mb-[0.4rem] block text-sm font-medium text-foreground';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 导入落库后回调：刷新列表与水位。 */
  onImported: () => void;
}

/**
 * 判定是否为「预检已过期」错误。
 *
 * <p>优先读 axios 4xx 的 `ApiResult.code`；若 BFF 以 HTTP 200 + 非零 code 返回，
 * `unwrap` 只会抛出 message，此时按结果码 / 文案兜底识别。
 * 两条路径都要覆盖，否则过期会被当成普通失败，用户拿不到「请重新预检」的正确指引。
 */
function isStaleError(e: unknown): boolean {
  if (typeof e === 'object' && e !== null) {
    const data = (e as { response?: { data?: unknown } }).response?.data;
    if (
      typeof data === 'object' &&
      data !== null &&
      (data as { code?: unknown }).code === KB_SYNONYM_IMPORT_STALE
    ) {
      return true;
    }
  }
  const msg = e instanceof Error ? e.message : '';
  return (
    msg.includes(String(KB_SYNONYM_IMPORT_STALE)) ||
    msg.includes('KB_SYNONYM_IMPORT_STALE') ||
    msg.includes('词表已变更')
  );
}

/**
 * 词表导入对话框（S-07 / PRD §4.5）。
 *
 * <p>严格两段式：阶段一「预检」只产出计划与报告，**不写任何词表数据**；
 * 阶段二「确认导入」才落库。预检报告未出现之前，界面上根本不存在「确认导入」按钮。
 *
 * <p>提交时若词表已被他人改动，服务端返回 `KB_SYNONYM_IMPORT_STALE`（40930）：
 * 此时**必须把用户退回阶段一重新预检，绝不静默重试**——旧计划是基于旧词表算的，
 * 照它写库会覆盖别人刚提交的改动。
 */
export function KbSynonymImportDialog({ open, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('select');
  const [fileName, setFileName] = useState('');
  const [precheck, setPrecheck] = useState<KbSynonymImportPrecheck | null>(null);
  const [mergeExisting, setMergeExisting] = useState(true);
  const [commit, setCommit] = useState<KbSynonymImportCommit | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [staleNotice, setStaleNotice] = useState(false);

  /** 回到阶段一：清空报告与已选文件，强制重新预检。 */
  function reset(): void {
    setStage('select');
    setFileName('');
    setPrecheck(null);
    setCommit(null);
    setErrorMsg('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setErrorMsg('');
    setStaleNotice(false);
    void runPrecheck(f);
  }

  async function runPrecheck(file: File): Promise<void> {
    setStage('prechecking');
    try {
      const result = await precheckSynonymImport(file);
      setPrecheck(result);
      setStage('report');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '导入预检失败');
      setStage('error');
    }
  }

  async function runCommit(): Promise<void> {
    if (!precheck) return;
    setStage('committing');
    try {
      const result = await commitSynonymImport(precheck.token, mergeExisting);
      setCommit(result);
      setStage('done');
      onImported();
    } catch (e) {
      if (isStaleError(e)) {
        // 词表在预检之后被改过：旧计划作废，退回阶段一，不重试。
        reset();
        setStaleNotice(true);
        toast.error('词表已变更，请重新预检');
        return;
      }
      setErrorMsg(e instanceof Error ? e.message : '导入提交失败');
      setStage('error');
    }
  }

  async function onDownloadRejected(): Promise<void> {
    const batchId = commit?.batchId ?? precheck?.batchId ?? null;
    if (batchId == null) {
      toast.error('缺少批次号，无法下载未导入行');
      return;
    }
    try {
      await downloadRejectedRows(batchId, precheck?.format ?? 'CSV');
      toast.success('已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '下载未导入行失败');
    }
  }

  function handleClose(): void {
    reset();
    setStaleNotice(false);
    onClose();
  }

  const rows = precheck?.rows ?? [];
  // 硬判据：只有拿到预检报告才允许出现提交入口。
  const canConfirm = stage === 'report' && precheck != null;
  const skipped = commit?.skippedCount ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入同义词词表</DialogTitle>
          <DialogDescription>
            先预检、再确认：未点「确认导入」之前不会写入任何数据。
          </DialogDescription>
        </DialogHeader>

        {/* 阶段一：选择文件 + 预检报告 */}
        {stage === 'select' || stage === 'prechecking' || stage === 'report' ? (
          <div className="space-y-4">
            {staleNotice ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                词表已变更，请重新预检。
                <span className="ml-1 text-xs">
                  上次预检之后有其他人改动了词表，原先的导入计划已作废；请重新选择文件生成新报告。
                </span>
              </div>
            ) : null}

            <div>
              <Label className={fieldLabel}>选择文件</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={handleFileChange}
              />
              {fileName ? (
                <p className="mt-1 text-xs text-muted-foreground">已选择：{fileName}</p>
              ) : null}
              <div className="mt-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <p className="mb-0.5 font-medium text-foreground">CSV 格式要求</p>
                <p>
                  两列：第一列「术语」（规范词），第二列「别名」；同一组的多个别名用
                  <b className="mx-0.5 font-mono">半角竖线 |</b>
                  分隔，例如：
                  <code className="ml-1 font-mono">目标管理,OKR|okr|目标与关键成果</code>
                </p>
                <p className="mt-0.5">
                  文件需为 UTF-8 编码；别名顺序即扩展优先级，靠前者在预算不足时优先入选。
                  也支持导出得到的 JSON 原样回传。
                </p>
              </div>
            </div>

            {stage === 'prechecking' ? (
              <p className="text-sm text-muted-foreground">正在预检…（此阶段不写入任何数据）</p>
            ) : null}

            {stage === 'report' && precheck ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="rounded-md border bg-card px-2 py-1">
                    新增 <b className="tabular-nums">{precheck.plannedCreate ?? 0}</b>
                  </span>
                  <span className="rounded-md border bg-card px-2 py-1">
                    并入 <b className="tabular-nums">{precheck.plannedMerge ?? 0}</b>
                  </span>
                  <span className="rounded-md border bg-card px-2 py-1">
                    跳过 <b className="tabular-nums">{precheck.plannedSkip ?? 0}</b>
                  </span>
                  <span className="rounded-md border bg-card px-2 py-1">格式 {precheck.format}</span>
                </div>

                {/* 同名规范词处置：决定 commit 的 mergeExisting */}
                <div>
                  <Label className={fieldLabel}>遇到同名规范词</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm"
                    value={mergeExisting ? 'merge' : 'skip'}
                    onChange={(e) => setMergeExisting(e.target.value === 'merge')}
                  >
                    <option value="merge">并入已有组（追加别名）</option>
                    <option value="skip">跳过（保留原组不动）</option>
                  </select>
                </div>

                {precheck.warnings && precheck.warnings.length > 0 ? (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                    <p className="mb-1 font-medium">预检提示</p>
                    <ul className="list-inside list-disc space-y-0.5">
                      {precheck.warnings.map((w, i) => (
                        <li key={`${i}-${w}`}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="max-h-72 overflow-auto rounded-md border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 border-b bg-table-header text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5">行号</th>
                        <th className="px-2 py-1.5">规范词</th>
                        <th className="px-2 py-1.5">动作</th>
                        <th className="px-2 py-1.5">说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                            无待导入行
                          </td>
                        </tr>
                      ) : (
                        rows.map((r, i) => (
                          <tr
                            key={r.lineNo ?? i}
                            className="border-b border-border/50 last:border-0"
                          >
                            <td className="px-2 py-1.5 tabular-nums">{r.lineNo ?? '-'}</td>
                            <td className="px-2 py-1.5">{r.canonicalTerm ?? '-'}</td>
                            <td className="px-2 py-1.5">
                              <span
                                className={
                                  r.action === 'SKIP'
                                    ? 'text-warning'
                                    : r.action === 'MERGE'
                                      ? 'text-primary'
                                      : 'text-foreground'
                                }
                              >
                                {synonymImportActionLabel(r.action)}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-xs text-muted-foreground">
                              {r.conflictTerm ? (
                                <>
                                  冲突词「{r.conflictTerm}」已属术语组「
                                  {r.ownerCanonicalTerm ?? `#${r.ownerGroupId ?? '-'}`}」
                                  {r.skipReason ? ` · ${r.skipReason}` : ''}
                                </>
                              ) : (
                                (r.skipReason ?? '')
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 阶段二：提交中 / 完成 */}
        {stage === 'committing' ? <p className="text-sm text-muted-foreground">正在导入…</p> : null}
        {stage === 'done' && commit ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-success">导入完成</p>
            <p className="text-muted-foreground tabular-nums">
              新增 {commit.createdCount ?? 0} · 并入 {commit.mergedCount ?? 0} · 跳过{' '}
              {commit.skippedCount ?? 0}
            </p>
            {skipped > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  有 {skipped} 行未导入。下载后按 <code className="font-mono">skip_reason</code>{' '}
                  修正，可直接再传一次。
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onDownloadRejected()}
                >
                  <Download className="h-4 w-4" />
                  下载未导入行
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 错误 */}
        {stage === 'error' ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMsg || '导入失败'}
          </div>
        ) : null}

        <DialogFooter className="flex items-center justify-between gap-2">
          <div>
            {stage === 'report' || stage === 'error' ? (
              <Button type="button" size="sm" variant="ghost" onClick={reset}>
                <RefreshCw className="h-4 w-4" />
                重新选择
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              {stage === 'done' ? '完成' : '取消'}
            </Button>
            {/* 未出预检报告 → 此按钮根本不渲染（两段式硬判据） */}
            {canConfirm ? (
              <Button type="button" size="sm" onClick={() => void runCommit()}>
                <FileUp className="h-4 w-4" />
                确认导入
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
