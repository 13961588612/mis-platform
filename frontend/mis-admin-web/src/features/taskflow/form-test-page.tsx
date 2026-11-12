/**
 * 「测试表单」联调页：
 * 1) 保存 → form_record(SAVED) + 专用宽表；
 * 2) 发起流程 → IN_PROCESS；
 * 3) 首节点无人审过可撤回 → 回 SAVED，可改后再发。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ListError, ListLoading } from '@/components/common/empty-state';
import { PaginationFooter } from '@/components/common/pagination-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/auth-store';
import {
  fetchEnabledFormDefinitions,
  type FormDefinitionItem,
} from '@/lib/api/form-definition';
import { fetchDefinition, fetchDefinitions, type WfDefinition } from '@/lib/api/workflow';
import {
  createFormRecord,
  fetchFormRecords,
  startFormRecordProcess,
  updateFormRecord,
  type FormRecord,
} from '@/lib/api/form-records';
import { hasFormLoader, loadFormEntry } from '@/features/biz/forms/forms/form-loaders';
import { resolveForm } from '@/features/biz/forms/registry';
import type { FormData, FormFieldSchema, FormFieldValue } from '@/features/biz/forms/types';
import { cn } from '@/lib/utils';
import { TodoDetailDrawer } from '@/features/portal/components/todo-detail-drawer';
import { ProcessStartDialog, type ProcessStartConfirm } from './components/process-start-dialog';
import { resolveProcessTitle } from './lib/resolve-process-title';
import { defaultDueFromDefinition, toDatetimeLocalValue } from './lib/default-due-from-definition';
import { formatFormCellValue, mergeFormListFields } from './lib/format-form-cell';

const TENANT = '1';
const PAGE_SIZE = 20;

const RECORD_STATUS: Record<string, { text: string; cls: string }> = {
  SAVED: { text: '保存态', cls: 'bg-muted text-muted-foreground' },
  IN_PROCESS: { text: '审批中', cls: 'bg-info/10 text-info' },
  IN_AUDIT: { text: '审核中', cls: 'bg-warning/10 text-warning' },
  APPROVED: { text: '已通过', cls: 'bg-success/10 text-success' },
  REJECTED: { text: '已驳回', cls: 'bg-destructive/10 text-destructive' },
};

type BoundFormOption = {
  form: FormDefinitionItem;
  definition: WfDefinition;
};

export function FormTestPage() {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? '';

  const [forms, setForms] = useState<FormDefinitionItem[]>([]);
  const [defs, setDefs] = useState<WfDefinition[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);

  const [items, setItems] = useState<FormRecord[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [formCodeFilter, setFormCodeFilter] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInstanceId, setDrawerInstanceId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formCode, setFormCode] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [formValues, setFormValues] = useState<FormData>({});
  const [formReady, setFormReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [pendingStartRecordId, setPendingStartRecordId] = useState<string | null>(null);

  const boundOptions = useMemo<BoundFormOption[]>(() => {
    const enabled = forms.filter((f) => f.status === 'ENABLED');
    const out: BoundFormOption[] = [];
    for (const form of enabled) {
      if (!hasFormLoader(form.code)) continue;
      const def = defs.find(
        (d) =>
          d.status === 'ACTIVE' &&
          (d.supportedFormCodes?.includes(form.code) ||
            // LOCAL 绑定以表单侧为准时仍可能只有前端注册表关联
            false),
      );
      // 回退：任意 ACTIVE 定义含该 formCode
      const def2 =
        def ??
        defs.find((d) => d.status === 'ACTIVE' && (d.supportedFormCodes ?? []).includes(form.code));
      if (def2) out.push({ form, definition: def2 });
    }
    return out;
  }, [forms, defs]);

  const selectedDef = useMemo(
    () => boundOptions.find((o) => o.form.code === formCode)?.definition ?? null,
    [boundOptions, formCode],
  );
  const formMeta = useMemo(
    () => boundOptions.find((o) => o.form.code === formCode)?.form ?? null,
    [boundOptions, formCode],
  );
  const entry = formCode ? resolveForm(formCode) : null;
  const FormComp = entry?.component ?? null;

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const [f, d] = await Promise.all([
        fetchEnabledFormDefinitions(TENANT),
        fetchDefinitions(TENANT, 1, 100),
      ]);
      setForms(f);
      setDefs(d.list);
      // 补全定义详情里的 supportedFormCodes（列表可能不全）
      const details = await Promise.all(
        d.list.filter((x) => x.status === 'ACTIVE').slice(0, 30).map((x) => fetchDefinition(x.id, TENANT)),
      );
      setDefs((prev) => {
        const map = new Map(prev.map((x) => [x.id, x]));
        for (const det of details) map.set(det.id, det);
        return [...map.values()];
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载元数据失败');
    } finally {
      setMetaLoading(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    if (!userId) return;
    setListLoading(true);
    setListError(null);
    try {
      const result = await fetchFormRecords(TENANT, userId, {
        status: statusFilter || undefined,
        formCode: formCodeFilter || undefined,
        page,
        size: PAGE_SIZE,
      });
      let list = result.list;
      if (keyword) {
        const k = keyword.toLowerCase();
        list = list.filter(
          (r) =>
            (r.title ?? '').toLowerCase().includes(k) ||
            r.id.includes(k) ||
            r.formCode.toLowerCase().includes(k),
        );
      }
      setItems(list);
      setTotal(result.total);
    } catch (e) {
      setListError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setListLoading(false);
    }
  }, [userId, page, keyword, statusFilter, formCodeFilter]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!createOpen || !formCode) {
      setFormReady(false);
      return;
    }
    let cancelled = false;
    setFormReady(false);
    void (async () => {
      if (hasFormLoader(formCode)) await loadFormEntry(formCode);
      if (!cancelled) setFormReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [createOpen, formCode]);

  const suggestedTitle = resolveProcessTitle({
    formConfig: formMeta?.config,
    formData: formValues,
  });

  function openCreate() {
    if (boundOptions.length === 0) {
      toast.error('没有可提交的表单：请先注册表单、绑定已发布流程，且前端已注册 FormStructuredStore（如 PUR_FORM）');
      return;
    }
    setEditingId(null);
    setFormCode(boundOptions[0].form.code);
    setBusinessId(`TEST-${Date.now()}`);
    setFormValues({});
    setCreateOpen(true);
  }

  function openEdit(record: FormRecord) {
    if (!record.canEdit) {
      if (record.currentInstanceId) {
        setDrawerInstanceId(record.currentInstanceId);
        setDrawerOpen(true);
      }
      return;
    }
    setEditingId(record.id);
    setFormCode(record.formCode);
    setBusinessId(`FR-${record.id}`);
    setFormValues({ ...(record.values as FormData) });
    setCreateOpen(true);
  }

  async function handleSaveOnly() {
    if (!formCode || !user || !formMeta) return;
    if (!hasFormLoader(formCode) || !FormComp) {
      toast.error(`前端未注册表单组件：${formCode}`);
      return;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        await updateFormRecord(editingId, TENANT, user.id, {
          formCode,
          values: formValues,
          title: suggestedTitle || undefined,
        });
        toast.success('已保存到宽表（保存态）');
      } else {
        const id = await createFormRecord(TENANT, {
          formCode,
          values: formValues,
          title: suggestedTitle || undefined,
          createdBy: user.id,
          createdByName: user.realName || user.username,
        });
        setEditingId(id);
        toast.success('已保存单据，可继续发起流程');
      }
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  function openStartDialog() {
    if (!formCode || !selectedDef) {
      toast.error('请选择已绑定流程的表单');
      return;
    }
    void (async () => {
      setSubmitting(true);
      try {
        let recordId = editingId;
        if (!recordId) {
          recordId = await createFormRecord(TENANT, {
            formCode,
            values: formValues,
            title: suggestedTitle || undefined,
            createdBy: user!.id,
            createdByName: user!.realName || user!.username,
          });
          setEditingId(recordId);
        } else {
          await updateFormRecord(recordId, TENANT, user!.id, {
            formCode,
            values: formValues,
            title: suggestedTitle || undefined,
          });
        }
        setPendingStartRecordId(recordId);
        setStartDialogOpen(true);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '保存失败');
      } finally {
        setSubmitting(false);
      }
    })();
  }

  async function handleConfirm(confirm: ProcessStartConfirm) {
    if (!selectedDef || !user || !pendingStartRecordId) return;
    setSubmitting(true);
    try {
      const instanceId = await startFormRecordProcess(pendingStartRecordId, TENANT, {
        definitionCode: selectedDef.code,
        businessId: businessId.trim() || `FR-${pendingStartRecordId}`,
        title: confirm.title,
        priority: confirm.priority,
        dueDate: confirm.dueDate,
        initiatorId: user.id,
        initiatorName: user.realName || user.username,
      });
      toast.success(`已发起流程 ${instanceId}`);
      setStartDialogOpen(false);
      setCreateOpen(false);
      setPendingStartRecordId(null);
      setPage(1);
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发起失败');
    } finally {
      setSubmitting(false);
    }
  }

  function openProgress(record: FormRecord) {
    const inst = record.currentInstanceId ?? record.lastInstanceId;
    if (!inst) {
      openEdit(record);
      return;
    }
    setDrawerInstanceId(inst);
    setDrawerOpen(true);
  }

  function handleDrawerDone() {
    setDrawerOpen(false);
    void loadList();
  }

  function onSearch() {
    setPage(1);
    setKeyword(keywordDraft.trim());
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const [listFields, setListFields] = useState<FormFieldSchema[]>([]);
  useEffect(() => {
    const codes = formCodeFilter
      ? [formCodeFilter]
      : [...new Set(items.map((i) => i.formCode).filter(Boolean))];
    let cancelled = false;
    void (async () => {
      const fields: FormFieldSchema[] = [];
      const seen = new Set<string>();
      for (const code of codes) {
        if (hasFormLoader(code)) await loadFormEntry(code);
        if (cancelled) return;
        for (const f of resolveForm(code)?.fields ?? []) {
          if (seen.has(f.key)) continue;
          seen.add(f.key);
          fields.push(f);
        }
      }
      const rows = items.map((i) => (i.values ?? {}) as FormData);
      if (!cancelled) setListFields(mergeFormListFields(fields, rows));
    })();
    return () => {
      cancelled = true;
    };
  }, [formCodeFilter, items]);

  function fmtDt(iso: string | null | undefined) {
    return iso ? iso.replace('T', ' ').slice(0, 16) : '—';
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <PageHeader
        title="测试表单"
        description="保存写入专用宽表；发起挂流程；撤回后回保存态可改再发。"
      />

      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        PUR_FORM 已接结构化宽表 <code className="mx-0.5">biz_form_pur_form</code>。使用前请确认
        <Link className="mx-1 text-primary underline-offset-2 hover:underline" to="/system/forms">
          表单注册
        </Link>
        与
        <Link
          className="mx-1 text-primary underline-offset-2 hover:underline"
          to="/system/workflow/definitions"
        >
          流程定义
        </Link>
        已关联发布。当前可提交 {metaLoading ? '…' : boundOptions.length} 个表单。
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="ft-kw" className="text-xs text-muted-foreground">
            关键字
          </label>
          <Input
            id="ft-kw"
            aria-label="关键字"
            className="h-8 w-48"
            placeholder="标题 / 单据号"
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch();
            }}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="ft-status" className="text-xs text-muted-foreground">
            单据状态
          </label>
          <select
            id="ft-status"
            aria-label="单据状态"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value);
            }}
          >
            <option value="">全部</option>
            <option value="SAVED">保存态</option>
            <option value="IN_PROCESS">审批中</option>
            <option value="APPROVED">已通过</option>
            <option value="REJECTED">已驳回</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="ft-form-filter" className="text-xs text-muted-foreground">
            表单
          </label>
          <select
            id="ft-form-filter"
            aria-label="表单筛选"
            className="h-8 max-w-[200px] rounded-md border border-input bg-background px-2 text-sm"
            value={formCodeFilter}
            onChange={(e) => {
              setPage(1);
              setFormCodeFilter(e.target.value);
            }}
          >
            <option value="">全部表单</option>
            {forms.map((f) => (
              <option key={f.id} value={f.code}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={onSearch}>
          <Search className="h-3.5 w-3.5" />
          查询
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => void loadList()}>
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
        <div className="flex-1" />
        <Button type="button" size="sm" className="h-8 gap-1" onClick={openCreate}>
          <FilePlus2 className="h-3.5 w-3.5" />
          新建单据
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {listLoading ? (
          <ListLoading />
        ) : listError ? (
          <ListError message={listError} onRetry={() => void loadList()} />
        ) : items.length === 0 ? (
          <EmptyState title="暂无单据" description="点击「新建单据」保存到宽表，再发起流程。" />
        ) : (
          <Table data-testid="form-process-table">
            <TableHeader>
              <TableRow>
                {listFields.map((f) => (
                  <TableHead key={f.key} className="whitespace-nowrap">
                    {f.label}
                  </TableHead>
                ))}
                <TableHead className="whitespace-nowrap">表单</TableHead>
                <TableHead className="whitespace-nowrap">单据状态</TableHead>
                <TableHead className="whitespace-nowrap">当前流程</TableHead>
                <TableHead className="whitespace-nowrap">更新时间</TableHead>
                <TableHead className="whitespace-nowrap">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const st = RECORD_STATUS[item.status] ?? RECORD_STATUS.SAVED;
                const data = item.values ?? {};
                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => openProgress(item)}
                  >
                    {listFields.map((f) => (
                      <TableCell
                        key={f.key}
                        className="max-w-[180px] truncate"
                        title={formatFormCellValue(f, data[f.key] as FormFieldValue | undefined)}
                      >
                        {formatFormCellValue(f, data[f.key] as FormFieldValue | undefined)}
                      </TableCell>
                    ))}
                    <TableCell className="whitespace-nowrap">{item.formCode}</TableCell>
                    <TableCell>
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px]', st.cls)}>{st.text}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.currentInstanceId ?? item.lastInstanceId ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDt(item.updatedAt)}</TableCell>
                    <TableCell className="space-x-1">
                      {item.canEdit ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(item);
                          }}
                        >
                          编辑
                        </Button>
                      ) : null}
                      {item.currentInstanceId || item.lastInstanceId ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs text-primary border-primary/40"
                          onClick={(e) => {
                            e.stopPropagation();
                            openProgress(item);
                          }}
                        >
                          流程
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <PaginationFooter total={total} page={page} totalPages={totalPages} onPageChange={setPage} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          className={cn(
            'flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl',
          )}
        >
          <DialogHeader className="m-0 shrink-0 space-y-0 border-b px-4 py-3 pr-10">
            <DialogTitle>{editingId ? '编辑单据' : '新建单据'}</DialogTitle>
            <DialogDescription>
              先「保存」写入宽表（保存态）；再「保存并发起」启动本地流程。仅 PUR_FORM 等已注册 Store 的表单可落库。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="ft-create-form" className="text-sm font-medium">
                  表单
                </label>
                <select
                  id="ft-create-form"
                  aria-label="选择表单"
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={formCode}
                  disabled={!!editingId}
                  onChange={(e) => setFormCode(e.target.value)}
                >
                  {boundOptions.map((o) => (
                    <option key={o.form.id} value={o.form.code}>
                      {o.form.name}（{o.form.code}）→ {o.definition.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ft-biz-id" className="text-sm font-medium">
                  业务编号（发起时使用）
                </label>
                <Input
                  id="ft-biz-id"
                  aria-label="业务编号"
                  value={businessId}
                  onChange={(e) => setBusinessId(e.target.value)}
                />
              </div>
            </div>
            <div className="rounded-md border bg-card p-4">
              {!formCode ? (
                <p className="text-sm text-muted-foreground">请选择表单</p>
              ) : !formReady ? (
                <p className="text-sm text-muted-foreground">加载表单组件…</p>
              ) : !FormComp ? (
                <p className="text-sm text-destructive">前端未注册表单组件：{formCode}</p>
              ) : (
                <FormComp
                  formCode={formCode}
                  value={formValues}
                  readOnly={false}
                  fields={entry?.fields ?? []}
                  onChange={setFormValues}
                />
              )}
            </div>
          </div>
          <DialogFooter className="m-0 shrink-0 gap-2 border-t px-4 py-3">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!formCode || submitting}
              onClick={() => void handleSaveOnly()}
            >
              {submitting ? '保存中…' : '保存'}
            </Button>
            <Button
              type="button"
              disabled={!formCode || !selectedDef || submitting}
              onClick={openStartDialog}
            >
              保存并发起
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProcessStartDialog
        open={startDialogOpen}
        onOpenChange={setStartDialogOpen}
        initialTitle={suggestedTitle ?? ''}
        initialDueLocal={toDatetimeLocalValue(defaultDueFromDefinition(selectedDef))}
        initialPriority={2}
        submitting={submitting}
        onConfirm={(v) => void handleConfirm(v)}
      />

      <TodoDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        instanceId={drawerInstanceId}
        onDone={handleDrawerDone}
      />
    </div>
  );
}

export default FormTestPage;
