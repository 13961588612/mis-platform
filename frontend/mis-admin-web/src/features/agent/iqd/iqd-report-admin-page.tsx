/**
 * 报告管理（/iqd/reports）— 左侧分类树（可编辑）+ 右侧报告定义表格。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Folder,
  FolderOpen,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  Shield,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createAiReportAcl,
  createAiReportCategory,
  createAiReportDef,
  deleteAiReportAcl,
  deleteAiReportCategory,
  deleteAiReportDef,
  fetchAiParamSources,
  fetchAiReportAcls,
  fetchAiReportCategoryTree,
  fetchAiReportDefs,
  fetchAiWorkflowPlatforms,
  updateAiReportCategory,
  updateAiReportDef,
  type AiParamSource,
  type AiReportAcl,
  type AiReportCategory,
  type AiReportDef,
  type AiWorkflowPlatform,
} from '@/lib/api/ai-report';
import { listEnabledRoles } from '@/lib/api/roles';
import type { RoleItem } from '@/types/api';
import { cn } from '@/lib/utils';

export const IQD_REPORT_ADMIN_PAGE_PATH = '/iqd/reports';

/** 启用 AI 工作流时的默认绑定（可改）。 */
const DEFAULT_TARGET_AGENT_ID = 'spm-report';
const DEFAULT_TARGET_SKILL_ID = 'sm-report-router';
const DEFAULT_PROMPT_TEMPLATE =
  '【已确认模板报告任务】参数已齐，禁止再打开参数卡。\n请按「{{title}}」直接成文。\n门店：{{storeName}}（{{spmStoreId}}）\n期间：{{spmOrdMonth}}{{spmOrdWeek}}{{spmBizDate}}';

type CatSel = 'all' | 'uncategorized' | string;

type CategoryForm = {
  id: number;
  parent_id: number;
  code: string;
  name: string;
  is_group: boolean;
  sort_order: number;
  enabled: boolean;
};

export default function IqdReportAdminPage() {
  const [tree, setTree] = useState<AiReportCategory[]>([]);
  const [sources, setSources] = useState<AiParamSource[]>([]);
  const [platforms, setPlatforms] = useState<AiWorkflowPlatform[]>([]);
  const [reports, setReports] = useState<AiReportDef[]>([]);
  const [selected, setSelected] = useState<CatSel>('all');
  const [loading, setLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(false);

  const [editingReport, setEditingReport] = useState<AiReportDef | null>(null);
  const [creatingReport, setCreatingReport] = useState(false);
  const [savingReport, setSavingReport] = useState(false);

  const [categoryForm, setCategoryForm] = useState<CategoryForm | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);

  const [aclReport, setAclReport] = useState<AiReportDef | null>(null);
  const [aclRows, setAclRows] = useState<AiReportAcl[]>([]);
  const [aclRoles, setAclRoles] = useState<RoleItem[]>([]);
  const [aclLoading, setAclLoading] = useState(false);
  const [aclAdding, setAclAdding] = useState(false);
  const [aclPickRoleId, setAclPickRoleId] = useState<string>('');

  const reloadMeta = useCallback(async () => {
    const [t, s, p] = await Promise.all([
      fetchAiReportCategoryTree(),
      fetchAiParamSources(),
      fetchAiWorkflowPlatforms(),
    ]);
    setTree(t);
    setSources(s);
    setPlatforms(p);
  }, []);

  const reloadReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      if (selected === 'all') {
        setReports(await fetchAiReportDefs());
      } else if (selected === 'uncategorized') {
        setReports(await fetchAiReportDefs({ uncategorized: true }));
      } else {
        setReports(await fetchAiReportDefs({ categoryId: Number(selected) }));
      }
    } finally {
      setReportsLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await reloadMeta();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载分类失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadMeta]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReportsLoading(true);
      try {
        const rows =
          selected === 'all'
            ? await fetchAiReportDefs()
            : selected === 'uncategorized'
              ? await fetchAiReportDefs({ uncategorized: true })
              : await fetchAiReportDefs({ categoryId: Number(selected) });
        if (!cancelled) setReports(rows);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : '加载报告失败');
      } finally {
        if (!cancelled) setReportsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const flatCats = useMemo(() => flattenCategories(tree), [tree]);
  const categoryNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of flatCats) m.set(c.id, c.name);
    return m;
  }, [flatCats]);
  const platformNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of platforms) m.set(p.platform_code, p.name);
    return m;
  }, [platforms]);
  const sourceLabelByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sources) m.set(s.source_code, s.name);
    return m;
  }, [sources]);

  const openCreateReport = () => {
    setCreatingReport(true);
    setEditingReport({
      id: 0,
      report_code: '',
      title: '',
      description: '',
      category_id: selected !== 'all' && selected !== 'uncategorized' ? Number(selected) : null,
      slots: sources.slice(0, 1).map((s) => ({ source_code: s.source_code, required: true })),
      use_ai_workflow: true,
      workflow_platform_code: platforms[0]?.platform_code ?? null,
      workflow_code: null,
      enabled: true,
      sort_order: 0,
      target_agent_id: DEFAULT_TARGET_AGENT_ID,
      target_skill_id: DEFAULT_TARGET_SKILL_ID,
      prompt_template: DEFAULT_PROMPT_TEMPLATE,
      cache_ttl_hours: 24,
    });
  };

  const openEditReport = (r: AiReportDef) => {
    setCreatingReport(false);
    setEditingReport({
      ...r,
      slots: r.slots ?? [],
      target_agent_id: r.target_agent_id || DEFAULT_TARGET_AGENT_ID,
      target_skill_id: r.target_skill_id || DEFAULT_TARGET_SKILL_ID,
      prompt_template: r.prompt_template || DEFAULT_PROMPT_TEMPLATE,
      cache_ttl_hours: r.cache_ttl_hours ?? 24,
    });
  };

  const saveReport = async () => {
    if (!editingReport) return;
    if (!editingReport.report_code.trim() || !editingReport.title.trim()) {
      toast.error('请填写报告编号与名称');
      return;
    }
    if (editingReport.use_ai_workflow && !editingReport.workflow_code?.trim()) {
      toast.error('启用 AI 工作流时须填写工作流编号');
      return;
    }
    const body = {
      report_code: editingReport.report_code.trim(),
      title: editingReport.title.trim(),
      description: editingReport.description || null,
      category_id: editingReport.category_id ?? null,
      slots: editingReport.slots,
      use_ai_workflow: editingReport.use_ai_workflow,
      workflow_platform_code: editingReport.workflow_platform_code || null,
      workflow_code: editingReport.workflow_code || null,
      target_agent_id: editingReport.target_agent_id || null,
      target_skill_id: editingReport.target_skill_id || null,
      prompt_template: editingReport.prompt_template || null,
      cache_ttl_hours: editingReport.cache_ttl_hours ?? 24,
      sort_order: editingReport.sort_order,
      enabled: editingReport.enabled,
    };
    setSavingReport(true);
    try {
      if (creatingReport || editingReport.id === 0) {
        await createAiReportDef(body);
        toast.success('已创建报告');
      } else {
        await updateAiReportDef(editingReport.id, body);
        toast.success('已保存报告');
      }
      setEditingReport(null);
      setCreatingReport(false);
      await reloadReports();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingReport(false);
    }
  };

  const onToggleReportEnabled = async (r: AiReportDef) => {
    const next = !r.enabled;
    const label = next ? '启用' : '停用';
    if (!window.confirm(`确认${label}报告「${r.title}」？`)) return;
    try {
      await updateAiReportDef(r.id, {
        report_code: r.report_code,
        title: r.title,
        description: r.description ?? null,
        category_id: r.category_id ?? null,
        slots: r.slots ?? [],
        use_ai_workflow: r.use_ai_workflow,
        workflow_platform_code: r.workflow_platform_code ?? null,
        workflow_code: r.workflow_code ?? null,
        target_agent_id: r.target_agent_id ?? null,
        target_skill_id: r.target_skill_id ?? null,
        prompt_template: r.prompt_template ?? null,
        cache_ttl_hours: r.cache_ttl_hours ?? 24,
        sort_order: r.sort_order,
        enabled: next,
      });
      toast.success(`已${label}`);
      await reloadReports();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label}失败`);
    }
  };

  const onDeleteReport = async (r: AiReportDef) => {
    if (!window.confirm(`删除报告「${r.title}」？`)) return;
    try {
      await deleteAiReportDef(r.id);
      if (editingReport?.id === r.id) {
        setEditingReport(null);
        setCreatingReport(false);
      }
      toast.success('已删除');
      await reloadReports();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const openCreateCategory = () => {
    setCategoryForm({
      id: 0,
      parent_id: selected !== 'all' && selected !== 'uncategorized' ? Number(selected) : 0,
      code: '',
      name: '',
      is_group: false,
      sort_order: 0,
      enabled: true,
    });
  };

  const openEditCategory = (cat: AiReportCategory) => {
    setCategoryForm({
      id: cat.id,
      parent_id: cat.parent_id ?? 0,
      code: cat.code,
      name: cat.name,
      is_group: Boolean(cat.is_group),
      sort_order: cat.sort_order ?? 0,
      enabled: cat.enabled !== false,
    });
  };

  const saveCategory = async () => {
    if (!categoryForm) return;
    if (!categoryForm.code.trim() || !categoryForm.name.trim()) {
      toast.error('请填写分类编号与名称');
      return;
    }
    setSavingCategory(true);
    const body = {
      parent_id: categoryForm.parent_id || 0,
      code: categoryForm.code.trim(),
      name: categoryForm.name.trim(),
      is_group: categoryForm.is_group,
      sort_order: categoryForm.sort_order,
      enabled: categoryForm.enabled,
    };
    try {
      if (categoryForm.id === 0) {
        await createAiReportCategory(body);
        toast.success('已创建分类');
      } else {
        await updateAiReportCategory(categoryForm.id, body);
        toast.success('已保存分类');
      }
      setCategoryForm(null);
      await reloadMeta();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存分类失败');
    } finally {
      setSavingCategory(false);
    }
  };

  const onDeleteCategory = async (cat: AiReportCategory) => {
    if (!window.confirm(`删除分类「${cat.name}」？`)) return;
    try {
      await deleteAiReportCategory(cat.id);
      if (selected === String(cat.id)) setSelected('all');
      toast.success('已删除分类');
      await reloadMeta();
      await reloadReports();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const openAclDialog = async (r: AiReportDef) => {
    setAclReport(r);
    setAclPickRoleId('');
    setAclRows([]);
    setAclLoading(true);
    try {
      const [rows, roles] = await Promise.all([
        fetchAiReportAcls(r.report_code),
        aclRoles.length > 0 ? Promise.resolve(aclRoles) : listEnabledRoles(),
      ]);
      setAclRows(rows);
      if (aclRoles.length === 0) setAclRoles(roles);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载报告权限失败');
      setAclReport(null);
    } finally {
      setAclLoading(false);
    }
  };

  const reloadAcls = async (reportCode: string) => {
    setAclRows(await fetchAiReportAcls(reportCode));
  };

  const onAddAcl = async () => {
    if (!aclReport || !aclPickRoleId) {
      toast.error('请选择角色');
      return;
    }
    const exists = aclRows.some(
      (a) => a.subject_type === 'ROLE' && a.subject_id === aclPickRoleId,
    );
    if (exists) {
      toast.message('该角色已授权');
      return;
    }
    setAclAdding(true);
    try {
      await createAiReportAcl({
        report_code: aclReport.report_code,
        subject_type: 'ROLE',
        subject_id: aclPickRoleId,
      });
      toast.success('已添加权限');
      setAclPickRoleId('');
      await reloadAcls(aclReport.report_code);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加失败');
    } finally {
      setAclAdding(false);
    }
  };

  const onRemoveAcl = async (acl: AiReportAcl) => {
    if (!aclReport) return;
    if (!window.confirm('移除该角色的报告权限？')) return;
    try {
      await deleteAiReportAcl(acl.id);
      toast.success('已移除');
      await reloadAcls(aclReport.report_code);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '移除失败');
    }
  };

  const roleLabel = (roleId: string) => {
    const role = aclRoles.find((r) => String(r.id) === String(roleId));
    return role ? `${role.name}（${role.code}）` : `角色 #${roleId}`;
  };

  const aclSelectableRoles = useMemo(() => {
    const granted = new Set(
      aclRows.filter((a) => a.subject_type === 'ROLE').map((a) => String(a.subject_id)),
    );
    return aclRoles.filter((r) => !granted.has(String(r.id)));
  }, [aclRoles, aclRows]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        title="报告管理"
        description="分类（分组标记）与报告参数槽位编排；Copilot 仅展示带分组标记且有权限报告的分类。"
        breadcrumbs={buildAppBreadcrumbs({ app: 'agent', title: '报告管理' })}
      />
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-3 pb-3">
        <aside className="flex w-64 shrink-0 flex-col rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-2 py-2">
            <span className="text-sm font-medium">分类</span>
            <Button type="button" size="sm" variant="ghost" onClick={openCreateCategory}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {loading ? (
              <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
              </div>
            ) : (
              <CategoryTree
                tree={tree}
                selected={selected}
                onSelect={setSelected}
                onEdit={openEditCategory}
                onDelete={(c) => void onDeleteCategory(c)}
              />
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">报告定义</span>
              {reportsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            </div>
            <Button type="button" size="sm" onClick={openCreateReport}>
              <Plus className="mr-1 h-4 w-4" /> 新建报告
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 whitespace-nowrap">排序</TableHead>
                  <TableHead className="whitespace-nowrap">编号</TableHead>
                  <TableHead className="whitespace-nowrap">名称</TableHead>
                  <TableHead className="whitespace-nowrap">归属分类</TableHead>
                  <TableHead className="min-w-[8rem]">参数槽位</TableHead>
                  <TableHead className="whitespace-nowrap">AI 工作流</TableHead>
                  <TableHead className="whitespace-nowrap">平台编号</TableHead>
                  <TableHead className="whitespace-nowrap">平台名称</TableHead>
                  <TableHead className="whitespace-nowrap">工作流编号</TableHead>
                  <TableHead className="whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                      暂无报告
                    </TableCell>
                  </TableRow>
                ) : (
                  reports.map((r) => {
                    const platformCode = r.workflow_platform_code || '';
                    const platformName = platformCode
                      ? platformNameByCode.get(platformCode) || '—'
                      : '—';
                    const categoryLabel =
                      r.category_id != null
                        ? categoryNameById.get(r.category_id) || `分类#${r.category_id}`
                        : '未分类';
                    const slots = r.slots ?? [];
                    return (
                      <TableRow key={r.id} className={cn(!r.enabled && 'opacity-60')}>
                        <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                          {r.sort_order ?? 0}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.report_code}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">{r.title}</span>
                            {!r.enabled ? (
                              <Badge variant="outline" className="text-[10px]">
                                已停用
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{categoryLabel}</TableCell>
                        <TableCell>
                          {slots.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <ul className="space-y-0.5 text-xs leading-5">
                              {slots.map((slot) => (
                                <li key={slot.source_code}>
                                  {sourceLabelByCode.get(slot.source_code) || slot.source_code}
                                  {slot.required === false ? (
                                    <span className="text-muted-foreground">（可选）</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.use_ai_workflow ? '是' : '否'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.use_ai_workflow ? platformCode || '—' : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.use_ai_workflow ? platformName : '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.use_ai_workflow ? r.workflow_code || '—' : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditReport(r)}
                            >
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              编辑
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => void openAclDialog(r)}
                            >
                              <Shield className="mr-1 h-3.5 w-3.5" />
                              权限
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => void onToggleReportEnabled(r)}
                            >
                              {r.enabled ? '停用' : '启用'}
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="删除"
                              onClick={() => void onDeleteReport(r)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>

      <Dialog
        open={categoryForm != null}
        onOpenChange={(open) => {
          if (!open) setCategoryForm(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{categoryForm?.id ? '编辑分类' : '新建分类'}</DialogTitle>
          </DialogHeader>
          {categoryForm ? (
            <div className="space-y-3 py-1">
              <div className="grid gap-2">
                <Label>编号</Label>
                <Input
                  value={categoryForm.code}
                  onChange={(e) => setCategoryForm({ ...categoryForm, code: e.target.value })}
                  placeholder="spm-store"
                />
              </div>
              <div className="grid gap-2">
                <Label>名称</Label>
                <Input
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>上级分类</Label>
                <Select
                  value={String(categoryForm.parent_id || 0)}
                  onValueChange={(v) =>
                    setCategoryForm({ ...categoryForm, parent_id: Number(v) || 0 })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="无（根）" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">无（根）</SelectItem>
                    {flatCats
                      .filter((c) => c.id !== categoryForm.id)
                      .map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {'—'.repeat(c.depth)} {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>排序</Label>
                <Input
                  type="number"
                  value={categoryForm.sort_order}
                  onChange={(e) =>
                    setCategoryForm({
                      ...categoryForm,
                      sort_order: Number.isFinite(Number(e.target.value))
                        ? Number(e.target.value)
                        : 0,
                    })
                  }
                  placeholder="数值越小越靠前"
                />
                <p className="text-xs text-muted-foreground">
                  同级分类按此字段升序；Copilot 分组标签亦按此排序
                </p>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">Copilot 分组</div>
                  <div className="text-xs text-muted-foreground">仅分组出现在会话输入栏上方</div>
                </div>
                <Switch
                  checked={categoryForm.is_group}
                  onCheckedChange={(c) => setCategoryForm({ ...categoryForm, is_group: c })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="text-sm font-medium">启用</div>
                <Switch
                  checked={categoryForm.enabled}
                  onCheckedChange={(c) => setCategoryForm({ ...categoryForm, enabled: c })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCategoryForm(null)}>
              取消
            </Button>
            <Button type="button" disabled={savingCategory} onClick={() => void saveCategory()}>
              {savingCategory ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={aclReport != null}
        onOpenChange={(open) => {
          if (!open) {
            setAclReport(null);
            setAclRows([]);
            setAclPickRoleId('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              权限 — {aclReport?.title}
              {aclReport ? (
                <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">
                  （{aclReport.report_code}）
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              授权角色后，该角色用户可在 Copilot 模板报告栏看到并打开本报告。门店可选范围仍由 IAM 数据范围控制。
            </p>
            {aclLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
              </div>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {aclRows.filter((a) => a.subject_type === 'ROLE').length === 0 ? (
                  <li className="px-1 py-4 text-center text-sm text-muted-foreground">
                    尚未授权任何角色
                  </li>
                ) : (
                  aclRows
                    .filter((a) => a.subject_type === 'ROLE')
                    .map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-2 rounded-sm px-1.5 py-1.5 text-sm hover:bg-muted/50"
                      >
                        <span className="min-w-0 truncate">{roleLabel(a.subject_id)}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 shrink-0 text-destructive"
                          onClick={() => void onRemoveAcl(a)}
                        >
                          移除
                        </Button>
                      </li>
                    ))
                )}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label>添加角色</Label>
                <Select
                  value={aclPickRoleId || undefined}
                  onValueChange={setAclPickRoleId}
                  disabled={aclLoading || aclAdding}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择角色" />
                  </SelectTrigger>
                  <SelectContent>
                    {aclSelectableRoles.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        无可添加角色
                      </SelectItem>
                    ) : (
                      aclSelectableRoles.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.name}（{r.code}）
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                disabled={aclLoading || aclAdding || !aclPickRoleId}
                onClick={() => void onAddAcl()}
              >
                {aclAdding ? '添加中…' : '添加'}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAclReport(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingReport != null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingReport(null);
            setCreatingReport(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{creatingReport || editingReport?.id === 0 ? '新建报告' : '编辑报告'}</DialogTitle>
          </DialogHeader>
          {editingReport ? (
            <ReportEditor
              value={editingReport}
              sources={sources}
              platforms={platforms}
              categories={flatCats}
              onChange={setEditingReport}
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditingReport(null);
                setCreatingReport(false);
              }}
            >
              取消
            </Button>
            <Button type="button" disabled={savingReport} onClick={() => void saveReport()}>
              {savingReport ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function flattenCategories(nodes: AiReportCategory[], depth = 0): Array<AiReportCategory & { depth: number }> {
  const out: Array<AiReportCategory & { depth: number }> = [];
  for (const n of nodes) {
    out.push({ ...n, depth });
    if (n.children?.length) out.push(...flattenCategories(n.children, depth + 1));
  }
  return out;
}

function CategoryTree({
  tree,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  tree: AiReportCategory[];
  selected: CatSel;
  onSelect: (s: CatSel) => void;
  onEdit: (c: AiReportCategory) => void;
  onDelete: (c: AiReportCategory) => void;
}) {
  return (
    <div className="space-y-0.5">
      <TreeBtn
        active={selected === 'all'}
        onClick={() => onSelect('all')}
        label="全部报告"
        icon={<Folder className="h-4 w-4" />}
      />
      <TreeBtn
        active={selected === 'uncategorized'}
        onClick={() => onSelect('uncategorized')}
        label="未分类"
        icon={<Inbox className="h-4 w-4" />}
      />
      <CatLevel
        nodes={tree}
        depth={0}
        selected={selected}
        onSelect={onSelect}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}

function CatLevel({
  nodes,
  depth,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  nodes: AiReportCategory[];
  depth: number;
  selected: CatSel;
  onSelect: (s: CatSel) => void;
  onEdit: (c: AiReportCategory) => void;
  onDelete: (c: AiReportCategory) => void;
}) {
  return (
    <>
      {nodes.map((n) => {
        const id = String(n.id);
        const active = selected === id;
        return (
          <div key={n.id}>
            <div className="group flex items-center gap-0.5">
              <button
                type="button"
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm',
                  active ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                  n.enabled === false && 'opacity-50',
                )}
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() => onSelect(id)}
              >
                {active ? (
                  <FolderOpen className="h-4 w-4 shrink-0" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{n.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  #{n.sort_order ?? 0}
                </span>
                {n.is_group ? (
                  <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800">
                    分组
                  </span>
                ) : null}
              </button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-0 group-hover:opacity-100"
                title="编辑分类"
                onClick={() => onEdit(n)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-0 group-hover:opacity-100"
                title="删除分类"
                onClick={() => onDelete(n)}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
            {n.children?.length ? (
              <CatLevel
                nodes={n.children}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function TreeBtn({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm',
        active ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function ReportEditor({
  value,
  sources,
  platforms,
  categories,
  onChange,
}: {
  value: AiReportDef;
  sources: AiParamSource[];
  platforms: AiWorkflowPlatform[];
  categories: Array<AiReportCategory & { depth: number }>;
  onChange: (v: AiReportDef) => void;
}) {
  const toggleSource = (code: string, checked: boolean) => {
    const slots = [...(value.slots ?? [])];
    if (checked) {
      if (!slots.some((s) => s.source_code === code)) {
        slots.push({ source_code: code, required: true });
      }
    } else {
      onChange({ ...value, slots: slots.filter((s) => s.source_code !== code) });
      return;
    }
    onChange({ ...value, slots });
  };

  const enableAiWorkflow = (on: boolean) => {
    if (!on) {
      onChange({ ...value, use_ai_workflow: false });
      return;
    }
    onChange({
      ...value,
      use_ai_workflow: true,
      workflow_platform_code:
        value.workflow_platform_code || platforms[0]?.platform_code || null,
      target_agent_id: value.target_agent_id || DEFAULT_TARGET_AGENT_ID,
      target_skill_id: value.target_skill_id || DEFAULT_TARGET_SKILL_ID,
      prompt_template: value.prompt_template || DEFAULT_PROMPT_TEMPLATE,
      cache_ttl_hours: value.cache_ttl_hours ?? 24,
    });
  };

  return (
    <div className="space-y-3 py-1">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>报告编号</Label>
          <Input
            value={value.report_code}
            onChange={(e) => onChange({ ...value, report_code: e.target.value })}
            placeholder="RPT_DAILY"
          />
        </div>
        <div className="grid gap-2">
          <Label>名称</Label>
          <Input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label>分类</Label>
          <Select
            value={value.category_id != null ? String(value.category_id) : 'none'}
            onValueChange={(v) => onChange({ ...value, category_id: v === 'none' ? null : Number(v) })}
          >
            <SelectTrigger>
              <SelectValue placeholder="未分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">未分类</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {'—'.repeat(c.depth)} {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>排序</Label>
          <Input
            type="number"
            value={value.sort_order ?? 0}
            onChange={(e) =>
              onChange({
                ...value,
                sort_order: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0,
              })
            }
            placeholder="数值越小越靠前"
          />
          <p className="text-xs text-muted-foreground">同分类升序；Copilot 组内按此排序</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>参数槽位（勾选来源）</Label>
        <div className="grid grid-cols-1 gap-1 rounded-md border p-2 sm:grid-cols-2">
          {sources.map((s) => {
            const checked = value.slots?.some((x) => x.source_code === s.source_code) ?? false;
            return (
              <label key={s.source_code} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => toggleSource(s.source_code, c === true)}
                />
                <span>
                  {s.name}{' '}
                  <span className="text-muted-foreground">
                    ({s.source_code} / {s.value_type})
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div>
          <div className="text-sm font-medium">在 AI 工作流平台运行</div>
          <div className="text-xs text-muted-foreground">启用后绑定智能体成文；默认 spm-report</div>
        </div>
        <Switch checked={value.use_ai_workflow} onCheckedChange={enableAiWorkflow} />
      </div>

      {value.use_ai_workflow ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>工作流平台</Label>
            <Select
              value={value.workflow_platform_code || 'none'}
              onValueChange={(v) =>
                onChange({ ...value, workflow_platform_code: v === 'none' ? null : v })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="可选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不指定</SelectItem>
                {platforms.map((p) => (
                  <SelectItem key={p.platform_code} value={p.platform_code}>
                    {p.name} ({p.platform_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>缓存 TTL（小时）</Label>
            <Input
              type="number"
              value={value.cache_ttl_hours ?? 24}
              onChange={(e) =>
                onChange({
                  ...value,
                  cache_ttl_hours: Number.isFinite(Number(e.target.value))
                    ? Number(e.target.value)
                    : 24,
                })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>目标智能体 ID</Label>
            <Input
              value={value.target_agent_id || ''}
              onChange={(e) => onChange({ ...value, target_agent_id: e.target.value || null })}
              placeholder={DEFAULT_TARGET_AGENT_ID}
            />
          </div>
          <div className="grid gap-2">
            <Label>目标 Skill ID</Label>
            <Input
              value={value.target_skill_id || ''}
              onChange={(e) => onChange({ ...value, target_skill_id: e.target.value || null })}
              placeholder={DEFAULT_TARGET_SKILL_ID}
            />
            <p className="text-xs text-muted-foreground">强制先加载该 Skill；须在智能体启用列表内</p>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label>任务提示词模板</Label>
            <Textarea
              rows={4}
              value={value.prompt_template || ''}
              onChange={(e) => onChange({ ...value, prompt_template: e.target.value || null })}
              placeholder={DEFAULT_PROMPT_TEMPLATE}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              占位符 {'{{wire_key}}'} / {'{{title}}'} / {'{{storeName}}'} 等
            </p>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label>工作流编号（兼容旧字段）</Label>
            <Input
              value={value.workflow_code || ''}
              onChange={(e) => onChange({ ...value, workflow_code: e.target.value })}
              placeholder="可选"
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div className="text-sm font-medium">启用</div>
        <Switch
          checked={value.enabled}
          onCheckedChange={(c) => onChange({ ...value, enabled: c })}
        />
      </div>
    </div>
  );
}
