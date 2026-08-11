import { useCallback, useEffect, useState } from 'react';
import { Archive, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { KbLibraryCombobox } from '../components/kb-library-combobox';
import { PermissionGate } from '@/components/auth/permission-gate';
import { listCategories, listEngineOrphans, resolveEngineOrphan } from '../api/kb-api';
import { useKbStore } from '../stores/use-kb-store';
import { flattenCategoryTree, initialExpandedSet } from '../category/kb-category-tree';
import type { KbCategory, KbEngineOrphanItem, KbLibrary } from '../types';
import { KB_SECRECY_OPTIONS, formatTime } from '../types';

/** 处置动作 → 中文标签。 */
const ACTION_LABEL: Record<string, string> = {
  bind_existing: '认领到已有库',
  adopt_new: '新建库认领',
  ignore: '忽略',
};

/** 信息卡：引擎有 / MIS 无 的游离 dataset 处置面板（P1-T3）。 */
export function KbEngineOrphanPanel() {
  const invalidateLibraries = useKbStore((s) => s.invalidateLibraries);
  const [tab, setTab] = useState<'pending' | 'resolved'>('pending');
  const [pending, setPending] = useState<KbEngineOrphanItem[]>([]);
  const [resolved, setResolved] = useState<KbEngineOrphanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<KbEngineOrphanItem | null>(null);
  const [action, setAction] = useState<string>('bind_existing');
  const [targetLibraryId, setTargetLibraryId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [secrecy, setSecrecy] = useState<string>('public');
  const [note, setNote] = useState('');
  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([
        listEngineOrphans(0),
        listEngineOrphans(1),
      ]);
      setPending(p ?? []);
      setResolved(r ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载游离数据集失败');
      setPending([]);
      setResolved([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 打开处置弹窗：清空表单。 */
  async function openDialog(orphan: KbEngineOrphanItem): Promise<void> {
    setDialog(orphan);
    setAction('bind_existing');
    setTargetLibraryId(null);
    setName(orphan.nativeName ?? '');
    setCategoryId('');
    setSecrecy('public');
    setNote('');
    setSubmitting(false);
    try {
      setCategories(await listCategories());
    } catch {
      setCategories([]);
    }
  }

  function closeDialog(): void {
    setDialog(null);
  }

  async function onSubmit(): Promise<void> {
    if (!dialog?.nativeId) return;
    const req: Record<string, unknown> = { action };
    if (action === 'bind_existing') {
      if (targetLibraryId == null) {
        toast.warning('请选择要认领到的知识库');
        return;
      }
      req.targetLibraryId = targetLibraryId;
    } else if (action === 'adopt_new') {
      if (!name.trim()) {
        toast.warning('请填写新库名称');
        return;
      }
      if (!categoryId) {
        toast.warning('请选择所属分类');
        return;
      }
      req.name = name.trim();
      req.categoryId = Number(categoryId);
      req.secrecy = secrecy;
    } else if (action === 'ignore') {
      if (note.trim().length < 5) {
        toast.warning('忽略备注至少需要 5 个字');
        return;
      }
      req.note = note.trim();
    } else {
      toast.warning('请选择处置动作');
      return;
    }

    setSubmitting(true);
    try {
      const result = await resolveEngineOrphan(dialog.nativeId as string, req as never);
      if (result.engineSyncFailed === true) {
        toast.warning(result.message ?? '处置成功，但引擎侧改名失败');
      } else {
        toast.success(result.message ?? '处置成功');
      }
      closeDialog();
      await load();
      // 认领（bind_existing/adopt_new）后库列表要能看到新绑定/新建的库（设计 T3）
      invalidateLibraries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '处置失败');
    } finally {
      setSubmitting(false);
    }
  }

  const flatCategories = flattenCategoryTree(categories, initialExpandedSet(categories));

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">游离数据集（引擎有 / MIS 无）</h3>
          <Badge variant="outline" className="tabular-nums">
            待处理 {pending.length}
          </Badge>
          <Badge variant="secondary" className="tabular-nums">
            已处理 {resolved.length}
          </Badge>
        </div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          刷新
        </Button>
      </div>

      <div className="mb-3 flex gap-2 text-sm">
        <button
          type="button"
          className={
            'rounded-md px-2 py-1 ' +
            (tab === 'pending' ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground')
          }
          onClick={() => setTab('pending')}
        >
          待处理
        </button>
        <button
          type="button"
          className={
            'rounded-md px-2 py-1 ' +
            (tab === 'resolved' ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground')
          }
          onClick={() => setTab('resolved')}
        >
          已处理
        </button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
      ) : (tab === 'pending' ? pending : resolved).length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {tab === 'pending' ? '没有待处理的游离数据集' : '还没有已处理的游离数据集'}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {(tab === 'pending' ? pending : resolved).map((o) => (
            <li key={o.id ?? o.nativeId} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{o.nativeName ?? '(未命名)'}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {o.nativeId}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>文档 {o.docCount ?? '-'}</span>
                  <span>首次 {formatTime(o.firstSeenAt)}</span>
                  <span>最近可见 {formatTime(o.lastSeenAt)}</span>
                </div>
                {o.resolvedAction ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{ACTION_LABEL[o.resolvedAction] ?? o.resolvedAction}</Badge>
                    {o.resolvedNote ? <span>备注：{o.resolvedNote}</span> : null}
                    <span>处理于 {formatTime(o.resolvedAt)}</span>
                  </div>
                ) : null}
              </div>
              {tab === 'pending' ? (
                <PermissionGate permission="kb:engine:orphan:handle">
                  <Button size="sm" variant="outline" onClick={() => void openDialog(o)}>
                    处置
                  </Button>
                </PermissionGate>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialog != null} onOpenChange={(v) => (v ? null : closeDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>处置游离数据集</DialogTitle>
            <DialogDescription>
              引擎侧存在但 MIS 无对应知识库的 dataset：{dialog?.nativeName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">处置方式</label>
              <div className="flex flex-wrap gap-2">
                {(['bind_existing', 'adopt_new', 'ignore'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={
                      'rounded-md border px-2.5 py-1 text-sm ' +
                      (action === a
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input text-muted-foreground')
                    }
                    onClick={() => setAction(a)}
                  >
                    {ACTION_LABEL[a]}
                  </button>
                ))}
              </div>
            </div>

            {action === 'bind_existing' ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">认领到知识库</label>
                <KbLibraryCombobox
                  value={targetLibraryId}
                  onChange={(id: number | null, _lib: KbLibrary | null) => setTargetLibraryId(id)}
                  allowClear
                  emptyOptionLabel="请选择目标知识库"
                  activePath="/kb/engine"
                />
                <p className="text-xs text-muted-foreground">
                  目标库必须尚未绑定引擎 dataset；认领后引擎侧名称会改回规范名。
                </p>
              </div>
            ) : null}

            {action === 'adopt_new' ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">新库名称</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">所属分类</label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">请选择</option>
                    {flatCategories.map((c) => (
                      <option key={c.category.id} value={String(c.category.id)}>
                        {' '.repeat(c.depth * 2)}
                        {c.category.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">密级</label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm"
                    value={secrecy}
                    onChange={(e) => setSecrecy(e.target.value)}
                  >
                    {KB_SECRECY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {action === 'ignore' ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  处理备注 <span className="text-destructive">*</span>
                </label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="说明为何忽略（至少 5 个字）；引擎侧数据不会删除，需到 RAGFLOW 后台手工清理"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">至少 5 个字，留作审计记录。</p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={submitting} onClick={closeDialog}>
              取消
            </Button>
            <Button disabled={submitting} onClick={() => void onSubmit()}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              确认处置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
