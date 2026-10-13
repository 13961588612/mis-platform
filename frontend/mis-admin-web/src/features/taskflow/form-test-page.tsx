/**
 * 「测试表单」联调页 —— 模拟真实业务表单模块：
 * 1) 先在「表单注册」登记并启用；2) 在「流程定义」关联表单并发布；
 * 3) 本页：表格列出表单字段 + 流程审批列；新建提交；点行右侧划入查看进度。
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
import {
  fetchDefinition,
  fetchDefinitions,
  fetchMyProcesses,
  fetchProcessDetail,
  type WfDefinition,
  type WfInstance,
} from '@/lib/api/workflow';
import { hasFormLoader, loadFormEntry } from '@/features/biz/forms/forms/form-loaders';
import { resolveForm } from '@/features/biz/forms/registry';
import type { FormData, FormFieldSchema } from '@/features/biz/forms/types';
import { parseFormData } from '@/features/biz/forms/parse-form-data';
import { cn } from '@/lib/utils';
import { TodoDetailDrawer } from '@/features/portal/components/todo-detail-drawer';
import { formatInitiatorCompany } from '@/features/portal/lib/format-initiator';
import { ProcessStartDialog, type ProcessStartConfirm } from './components/process-start-dialog';
import { resolveProcessTitle } from './lib/resolve-process-title';
import { defaultDueFromDefinition, toDatetimeLocalValue } from './lib/default-due-from-definition';
import { startProcessWithTitle } from './lib/start-process-with-title';
import { formatFormCellValue, mergeFormListFields } from './lib/format-form-cell';

const TENANT = '1';
const PAGE_SIZE = 20;

function hasFormPayload(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'string') return raw.trim() !== '';
  return typeof raw === 'object';
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  RUNNING: { text: '进行中', cls: 'bg-info/10 text-info' },
  COMPLETED: { text: '已完成', cls: 'bg-success/10 text-success' },
  TERMINATED: { text: '已终止', cls: 'bg-destructive/10 text-destructive' },
  SUSPENDED: { text: '已挂起', cls: 'bg-warning/10 text-warning' },
};

/** 已启用且存在「已发布流程绑定」的表单选项。 */
type BoundFormOption = {
  form: FormDefinitionItem;
  definition: WfDefinition;
};

export function FormTestPage() {
  const user = useAuthStore((s) => s.user);
  const initiatorId = user?.id ?? '';

  // —— 元数据：注册表单 + 已发布流程 ——
  const [forms, setForms] = useState<FormDefinitionItem[]>([]);
  const [defs, setDefs] = useState<WfDefinition[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);

  // —— 列表查询 ——
  const [items, setItems] = useState<WfInstance[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [formCodeFilter, setFormCodeFilter] = useState('');

  // —— 进度抽屉（与门户首页点行同约定：右侧划入，不入 URL）——
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInstanceId, setDrawerInstanceId] = useState<string | null>(null);

  // —— 新建 ——
  const [createOpen, setCreateOpen] = useState(false);
  const [formCode, setFormCode] = useState('');
  const [selectedDef, setSelectedDef] = useState<WfDefinition | null>(null);
  const [formValues, setFormValues] = useState<FormData>({});
  const [formReady, setFormReady] = useState(false);
  const [businessId, setBusinessId] = useState('');
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const boundOptions = useMemo((): BoundFormOption[] => {
    const active = defs.filter((d) => d.status === 'ACTIVE');
    const out: BoundFormOption[] = [];
    for (const form of forms) {
      const def = active.find((d) => (d.supportedFormCodes ?? []).includes(form.code));
      if (def) out.push({ form, definition: def });
    }
    return out;
  }, [forms, defs]);

  const formMeta = useMemo(
    () => boundOptions.find((o) => o.form.code === formCode)?.form ?? null,
    [boundOptions, formCode],
  );
  const entry = formCode ? resolveForm(formCode) : null;
  const FormComp = entry?.component;

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const [f, d] = await Promise.all([
        fetchEnabledFormDefinitions(TENANT),
        fetchDefinitions(TENANT, 1, 200),
      ]);
      setForms(f);
      setDefs(d.list ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载表单/流程失败');
    } finally {
      setMetaLoading(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    if (!initiatorId) return;
    setListLoading(true);
    setListError(null);
    try {
      const result = await fetchMyProcesses(
        TENANT,
        initiatorId,
        statusFilter || undefined,
        page,
        PAGE_SIZE,
        keyword || null,
        null,
        null,
        null,
        null,
        true,
      );
      let list = result.list ?? [];
      if (formCodeFilter) {
        // 后端列表暂无 formCode 参，先对本页结果做客户端筛选（联调够用）
        list = list.filter((i) => i.startedFormCode === formCodeFilter);
      }
      // 旧 BFF/未带 includeFormData 时列表无 form_data，按详情补齐本页
      const missing = list.filter((i) => !hasFormPayload(i.formData));
      if (missing.length > 0) {
        const filled = await Promise.all(
          missing.map(async (i) => {
            try {
              const d = await fetchProcessDetail(String(i.id), TENANT);
              return [String(i.id), d.formData] as const;
            } catch {
              return [String(i.id), null] as const;
            }
          }),
        );
        const byId = new Map(filled);
        list = list.map((i) => {
          const extra = byId.get(String(i.id));
          return extra != null ? { ...i, formData: extra } : i;
        });
      }
      setItems(list);
      setTotal(result.total);
    } catch (e) {
      setListError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setListLoading(false);
    }
  }, [initiatorId, page, keyword, statusFilter, formCodeFilter]);

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
    setFormValues({});
    void (async () => {
      if (hasFormLoader(formCode)) await loadFormEntry(formCode);
      if (!cancelled) setFormReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [createOpen, formCode]);

  useEffect(() => {
    if (!createOpen || !formCode) {
      setSelectedDef(null);
      return;
    }
    const opt = boundOptions.find((o) => o.form.code === formCode);
    if (!opt) {
      setSelectedDef(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        // 详情含 nodes，用于默认过期时间
        const d = await fetchDefinition(opt.definition.id, TENANT);
        if (!cancelled) setSelectedDef(d);
      } catch (e) {
        if (!cancelled) {
          setSelectedDef(opt.definition);
          toast.error(e instanceof Error ? e.message : '加载流程定义失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createOpen, formCode, boundOptions]);

  const suggestedTitle = resolveProcessTitle({
    formConfig: formMeta?.config,
    formData: formValues,
  });

  function openCreate() {
    if (boundOptions.length === 0) {
      toast.error('没有可提交的表单：请先在表单注册启用，并在流程定义中关联且发布');
      return;
    }
    setFormCode(boundOptions[0].form.code);
    setBusinessId(`TEST-${Date.now()}`);
    setFormValues({});
    setCreateOpen(true);
  }

  function openStartDialog() {
    if (!formCode) {
      toast.error('请选择表单');
      return;
    }
    if (!selectedDef) {
      toast.error('该表单尚未绑定已发布流程，请先在流程定义中关联');
      return;
    }
    if (!hasFormLoader(formCode) || !FormComp) {
      toast.error(`前端未注册表单组件：${formCode}`);
      return;
    }
    setStartDialogOpen(true);
  }

  async function handleConfirm(confirm: ProcessStartConfirm) {
    if (!selectedDef || !user || !formMeta) return;
    setSubmitting(true);
    try {
      const r = await startProcessWithTitle({
        tenantId: TENANT,
        definitionCode: selectedDef.code,
        businessType: formMeta.code,
        businessId: businessId.trim() || `TEST-${Date.now()}`,
        startedFormCode: formCode,
        formConfig: formMeta.config,
        formDataObject: formValues,
        initiatorId: user.id,
        initiatorName: user.realName || user.username,
        confirmed: true,
        explicitTitle: confirm.title,
        priority: confirm.priority,
        dueDate: confirm.dueDate,
      });
      if (!r.ok) {
        toast.error(r.needConfirm ? '请填写流程标题' : r.error);
        return;
      }
      toast.success('已提交，可在列表查看进度');
      setStartDialogOpen(false);
      setCreateOpen(false);
      setPage(1);
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发起失败');
    } finally {
      setSubmitting(false);
    }
  }

  /** 点行 / 查看进度：右侧划入抽屉（对齐门户首页 TodoDetailDrawer）。 */
  function openProgress(item: WfInstance) {
    setDrawerInstanceId(String(item.id));
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
      : [...new Set(items.map((i) => i.startedFormCode).filter((c): c is string => Boolean(c)))];
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
      const rows = items.map((i) => {
        const parsed = parseFormData(i.formData);
        return parsed.ok ? parsed.data : {};
      });
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
        description="表格展示表单字段与流程审批状态；点行查看进度。"
      />

      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        使用前请确认：
        <Link className="mx-1 text-primary underline-offset-2 hover:underline" to="/system/forms">
          表单注册
        </Link>
        已启用表单，并在
        <Link
          className="mx-1 text-primary underline-offset-2 hover:underline"
          to="/system/workflow/definitions"
        >
          流程定义
        </Link>
        中关联该表单且已发布。当前可提交 {metaLoading ? '…' : boundOptions.length} 个表单。
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
            placeholder="标题 / 业务编号"
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch();
            }}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="ft-status" className="text-xs text-muted-foreground">
            状态
          </label>
          <select
            id="ft-status"
            aria-label="状态"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value);
            }}
          >
            <option value="">全部</option>
            <option value="RUNNING">进行中</option>
            <option value="COMPLETED">已完成</option>
            <option value="TERMINATED">已终止</option>
            <option value="SUSPENDED">已挂起</option>
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={() => void loadList()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
        <div className="flex-1" />
        <Button type="button" size="sm" className="h-8 gap-1" onClick={openCreate}>
          <FilePlus2 className="h-3.5 w-3.5" />
          新建提交
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {listLoading ? (
          <ListLoading />
        ) : listError ? (
          <ListError message={listError} onRetry={() => void loadList()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="暂无提交记录"
            description="点击右上角「新建提交」发起一笔联调单据。"
          />
        ) : (
          <Table data-testid="form-process-table">
            <TableHeader>
              <TableRow>
                {listFields.map((f) => (
                  <TableHead key={f.key} className="whitespace-nowrap">
                    {f.label}
                  </TableHead>
                ))}
                <TableHead className="whitespace-nowrap">流程代码</TableHead>
                <TableHead className="whitespace-nowrap">表单代码</TableHead>
                <TableHead className="whitespace-nowrap">发起人</TableHead>
                <TableHead className="whitespace-nowrap">发起时间</TableHead>
                <TableHead className="whitespace-nowrap">审批状态</TableHead>
                <TableHead className="whitespace-nowrap">当前审批节点</TableHead>
                <TableHead className="whitespace-nowrap">结束审批时间</TableHead>
                <TableHead className="whitespace-nowrap">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const st = STATUS_LABEL[item.status] ?? STATUS_LABEL.RUNNING;
                const parsed = parseFormData(item.formData);
                const data = parsed.ok ? parsed.data : {};
                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => openProgress(item)}
                  >
                    {listFields.map((f) => (
                      <TableCell key={f.key} className="max-w-[180px] truncate" title={formatFormCellValue(f, data[f.key])}>
                        {formatFormCellValue(f, data[f.key])}
                      </TableCell>
                    ))}
                    <TableCell className="whitespace-nowrap">{item.definitionCode || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{item.startedFormCode || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatInitiatorCompany(item.initiatorName, item.initiatorOrgName) ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDt(item.createdAt)}</TableCell>
                    <TableCell>
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px]', st.cls)}>{st.text}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.currentNodeName ?? item.currentNodeCode ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDt(item.completedAt)}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-primary border-primary/40 hover:bg-primary/10 hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          openProgress(item);
                        }}
                      >
                        查看进度
                      </Button>
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
            // p-0 时必须抵消 Header/Footer 默认 -m-6，否则标题/按钮被 overflow 裁切
            'flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl',
          )}
        >
          <DialogHeader className="m-0 shrink-0 space-y-0 border-b px-4 py-3 pr-10">
            <DialogTitle>新建提交</DialogTitle>
            <DialogDescription>
              仅展示已注册且已绑定已发布流程的表单。提交前将确认标题、过期时间与紧急程度。
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
                  onChange={(e) => setFormCode(e.target.value)}
                >
                  {boundOptions.map((o) => (
                    <option key={o.form.id} value={o.form.code}>
                      {o.form.name}（{o.form.code}）→ {o.definition.name}
                    </option>
                  ))}
                </select>
                {boundOptions.length === 0 ? (
                  <p className="text-xs text-destructive">
                    无可用表单。请先完成
                    <Link className="mx-0.5 underline" to="/system/forms" onClick={() => setCreateOpen(false)}>
                      表单注册
                    </Link>
                    与
                    <Link
                      className="mx-0.5 underline"
                      to="/system/workflow/definitions"
                      onClick={() => setCreateOpen(false)}
                    >
                      流程绑定
                    </Link>
                    。
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ft-biz-id" className="text-sm font-medium">
                  业务编号
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
          <DialogFooter className="m-0 shrink-0 border-t px-4 py-3">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={openStartDialog} disabled={!formCode || !selectedDef}>
              提交并发起
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
