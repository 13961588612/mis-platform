/**
 * 「测试表单」联调页：
 * 1) 保存 → form_record(SAVED) + 专用宽表；
 * 2) 发起流程 → IN_PROCESS；
 * 3) 首节点无人审过可撤回 → 回 SAVED，可改后再发。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { FilterField, FilterPanel, FILTER_FIELD_CONTROL_CLASS } from '@/components/common/filter-panel';
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
import { FormAiAssistPanel } from '@/features/biz/forms/form-ai-assist-panel';
import { canShowFormAiAssist } from '@/features/biz/forms/lib/form-ai-assist';
import { usePermission } from '@/hooks/use-permission';

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
  const { hasPermission } = usePermission();

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
  const [assistOpen, setAssistOpen] = useState(false);

  const boundOptions = useMemo<BoundFormOption[]>(() => {
    const enabled = forms.filter((f) => f.status === 'ENABLED');
    const out: BoundFormOption[] = [];
    for (const form of enabled) {
      if (!hasFormLoader(form.code)) continue;
      const localId =
        form.workflowDefinitionId != null && form.workflowDefinitionId !== ''
          ? String(form.workflowDefinitionId)
          : '';
      const byFormBinding =
        (form.workflowBindingType ?? 'NONE') === 'LOCAL' && localId
          ? defs.find((d) => d.status === 'ACTIVE' && String(d.id) === localId)
          : undefined;
      const byReverse =
        byFormBinding ??
        defs.find(
          (d) => d.status === 'ACTIVE' && (d.supportedFormCodes ?? []).includes(form.code),
        );
      if (byReverse) out.push({ form, definition: byReverse });
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
  const showAssist = canShowFormAiAssist(formMeta, hasPermission);
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
      toast.error(
        '没有可提交的表单：请在「表单注册」将已启用表单绑定已发布的本地流程（如 PUR_FORM → 采购审批示例），且前端已实现该 formCode。',
      );
      return;
    }
    setEditingId(null);
    setFormCode(boundOptions[0].form.code);
    setBusinessId(`TEST-${Date.now()}`);
    setFormValues({});
    setAssistOpen(false);
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
    setAssistOpen(false);
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

  function onReset() {
    setKeywordDraft('');
    setKeyword('');
    setStatusFilter('');
    setFormCodeFilter('');
    setPage(1);
  }

  const filterCount =
    (keywordDraft.trim() ? 1 : 0) + (statusFilter ? 1 : 0) + (formCodeFilter ? 1 : 0);

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        className="mb-2 shrink-0"
        hideTitle
        title="测试表单"
        breadcrumbs={buildAppBreadcrumbs({ app: 'system', group: '表单管理', title: '测试表单' })}
      />

      <FilterPanel
        filterCount={filterCount}
        onSearch={onSearch}
        onReset={onReset}
        actions={
          <>
            <Button type="button" size="sm" onClick={openCreate}>
              <FilePlus2 className="h-3.5 w-3.5" />
              新建单据
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadList()}>
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </Button>
          </>
        }
      >
        <FilterField label="关键字" col={3} htmlFor="ft-kw">
          <Input
            id="ft-kw"
            aria-label="关键字"
            className={FILTER_FIELD_CONTROL_CLASS}
            placeholder="标题 / 单据号"
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch();
            }}
          />
        </FilterField>
        <FilterField label="单据状态" col={3} htmlFor="ft-status">
          <select
            id="ft-status"
            aria-label="单据状态"
            className={FILTER_FIELD_CONTROL_CLASS}
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
        </FilterField>
        <FilterField label="表单" col={4} htmlFor="ft-form-filter">
          <select
            id="ft-form-filter"
            aria-label="表单筛选"
            className={FILTER_FIELD_CONTROL_CLASS}
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
        </FilterField>
      </FilterPanel>

      <div className="mb-4 shrink-0 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
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

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setAssistOpen(false);
        }}
      >
        <DialogContent
          className={cn(
            'flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0',
            assistOpen && showAssist ? 'max-w-5xl sm:max-w-5xl' : 'max-w-3xl sm:max-w-3xl',
          )}
        >
          <DialogHeader className="m-0 shrink-0 space-y-0 border-b px-4 py-3 pr-10">
            <DialogTitle>{editingId ? '编辑单据' : '新建单据'}</DialogTitle>
            <DialogDescription>
              先「保存」写入宽表（保存态）；再「保存并发起」启动本地流程。仅 PUR_FORM 等已注册 Store 的表单可落库。
            </DialogDescription>
          </DialogHeader>
          {showAssist ? (
            <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
              <Button
                type="button"
                variant={assistOpen ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAssistOpen((v) => !v)}
              >
                <Sparkles className="h-4 w-4" />
                {assistOpen ? '收起辅助' : '辅助录入'}
              </Button>
              <span className="text-xs text-muted-foreground">
                {assistOpen ? '右侧解析后勾选填入左侧，请核对再保存' : '打开后可上传文档/图片或对话抽取'}
              </span>
            </div>
          ) : null}
          <div
            className={cn(
              'min-h-0 flex-1 overflow-hidden',
              assistOpen && showAssist ? 'flex flex-row' : 'overflow-auto',
            )}
          >
            <div
              className={cn(
                'min-h-0 space-y-4 overflow-auto px-4 py-3',
                assistOpen && showAssist ? 'w-1/2 border-r' : 'flex-1',
              )}
            >
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
            {assistOpen && showAssist && formMeta?.aiAgentId && formMeta.aiSkillId ? (
              <div className="min-h-0 w-1/2 overflow-auto px-4 py-3">
                <FormAiAssistPanel
                  formCode={formCode}
                  agentId={formMeta.aiAgentId}
                  skillId={formMeta.aiSkillId}
                  fields={entry?.fields ?? []}
                  currentValues={formValues}
                  onApply={(partial) => setFormValues((prev) => ({ ...prev, ...partial }))}
                />
              </div>
            ) : null}
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
