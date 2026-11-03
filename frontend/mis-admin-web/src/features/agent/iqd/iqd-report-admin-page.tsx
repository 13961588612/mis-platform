/**
 * 报告管理（/iqd/reports）— 分类树（含分组标记）+ 报告定义编排。
 * UX 参考样本分类树，数据走独立 ai-reports API，不复用样本表。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FileText, Folder, FolderOpen, Inbox, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  createAiReportCategory,
  createAiReportDef,
  deleteAiReportCategory,
  deleteAiReportDef,
  fetchAiParamSources,
  fetchAiReportCategoryTree,
  fetchAiReportDefs,
  fetchAiWorkflowPlatforms,
  updateAiReportCategory,
  updateAiReportDef,
  type AiParamSource,
  type AiReportCategory,
  type AiReportDef,
  type AiWorkflowPlatform,
} from '@/lib/api/ai-report';
import { cn } from '@/lib/utils';

export const IQD_REPORT_ADMIN_PAGE_PATH = '/iqd/reports';

type CatSel = 'all' | 'uncategorized' | string;

export default function IqdReportAdminPage() {
  const [tree, setTree] = useState<AiReportCategory[]>([]);
  const [sources, setSources] = useState<AiParamSource[]>([]);
  const [platforms, setPlatforms] = useState<AiWorkflowPlatform[]>([]);
  const [reports, setReports] = useState<AiReportDef[]>([]);
  const [selected, setSelected] = useState<CatSel>('all');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AiReportDef | null>(null);
  const [creating, setCreating] = useState(false);

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
    if (selected === 'all') {
      setReports(await fetchAiReportDefs());
    } else if (selected === 'uncategorized') {
      setReports(await fetchAiReportDefs({ uncategorized: true }));
    } else {
      setReports(await fetchAiReportDefs({ categoryId: Number(selected) }));
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
      try {
        const rows = selected === 'all'
          ? await fetchAiReportDefs()
          : selected === 'uncategorized'
            ? await fetchAiReportDefs({ uncategorized: true })
            : await fetchAiReportDefs({ categoryId: Number(selected) });
        if (!cancelled) setReports(rows);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : '加载报告失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const flatCats = useMemo(() => flattenCategories(tree), [tree]);

  const openCreate = () => {
    setCreating(true);
    setEditing({
      id: 0,
      report_code: '',
      title: '',
      description: '',
      category_id: selected !== 'all' && selected !== 'uncategorized' ? Number(selected) : null,
      slots: sources.slice(0, 1).map((s) => ({ source_code: s.source_code, required: true })),
      use_ai_workflow: false,
      workflow_platform_code: null,
      workflow_code: null,
      enabled: true,
      sort_order: 0,
    });
  };

  const saveReport = async () => {
    if (!editing) return;
    if (!editing.report_code.trim() || !editing.title.trim()) {
      toast.error('请填写报告编号与名称');
      return;
    }
    const body = {
      report_code: editing.report_code.trim(),
      title: editing.title.trim(),
      description: editing.description || null,
      category_id: editing.category_id ?? null,
      slots: editing.slots,
      use_ai_workflow: editing.use_ai_workflow,
      workflow_platform_code: editing.workflow_platform_code || null,
      workflow_code: editing.workflow_code || null,
      sort_order: editing.sort_order,
      enabled: editing.enabled,
    };
    try {
      if (creating || editing.id === 0) {
        await createAiReportDef(body);
        toast.success('已创建报告');
      } else {
        await updateAiReportDef(editing.id, body);
        toast.success('已保存报告');
      }
      setEditing(null);
      setCreating(false);
      await reloadReports();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const onAddCategory = async () => {
    const code = window.prompt('分类编号（唯一）');
    if (!code?.trim()) return;
    const name = window.prompt('分类名称');
    if (!name?.trim()) return;
    const isGroup = window.confirm('是否标记为「分组」（仅分组出现在 Copilot 栏）？');
    try {
      await createAiReportCategory({
        parent_id: selected !== 'all' && selected !== 'uncategorized' ? Number(selected) : 0,
        code: code.trim(),
        name: name.trim(),
        is_group: isGroup,
        sort_order: 0,
        enabled: true,
      });
      toast.success('已创建分类');
      await reloadMeta();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建分类失败');
    }
  };

  const onToggleGroup = async (cat: AiReportCategory) => {
    try {
      await updateAiReportCategory(cat.id, {
        parent_id: cat.parent_id,
        code: cat.code,
        name: cat.name,
        is_group: !cat.is_group,
        sort_order: cat.sort_order,
        enabled: cat.enabled,
      });
      await reloadMeta();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新失败');
    }
  };

  const onDeleteCategory = async (cat: AiReportCategory) => {
    if (!window.confirm(`删除分类「${cat.name}」？`)) return;
    try {
      await deleteAiReportCategory(cat.id);
      if (selected === String(cat.id)) setSelected('all');
      await reloadMeta();
      await reloadReports();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const onDeleteReport = async (r: AiReportDef) => {
    if (!window.confirm(`删除报告「${r.title}」？`)) return;
    try {
      await deleteAiReportDef(r.id);
      if (editing?.id === r.id) {
        setEditing(null);
        setCreating(false);
      }
      await reloadReports();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  };

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
            <Button type="button" size="sm" variant="ghost" onClick={() => void onAddCategory()}>
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
                onToggleGroup={(c) => void onToggleGroup(c)}
                onDelete={(c) => void onDeleteCategory(c)}
              />
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">报告列表</span>
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" /> 新建报告
            </Button>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-2">
            <div className="min-h-0 overflow-auto border-b lg:border-b-0 lg:border-r">
              <ul className="divide-y">
                {reports.length === 0 ? (
                  <li className="px-3 py-6 text-sm text-muted-foreground">暂无报告</li>
                ) : (
                  reports.map((r) => (
                    <li
                      key={r.id}
                      className={cn(
                        'flex cursor-pointer items-start justify-between gap-2 px-3 py-2 hover:bg-muted/50',
                        editing?.id === r.id && 'bg-muted/60',
                      )}
                      onClick={() => {
                        setCreating(false);
                        setEditing({ ...r, slots: r.slots ?? [] });
                      }}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{r.report_code}</div>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDeleteReport(r);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="min-h-0 overflow-auto p-3">
              {!editing ? (
                <p className="text-sm text-muted-foreground">选择或新建报告以编辑参数槽位与工作流。</p>
              ) : (
                <ReportEditor
                  value={editing}
                  sources={sources}
                  platforms={platforms}
                  categories={flatCats}
                  onChange={setEditing}
                  onSave={() => void saveReport()}
                  onCancel={() => {
                    setEditing(null);
                    setCreating(false);
                  }}
                />
              )}
            </div>
          </div>
        </section>
      </div>
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
  onToggleGroup,
  onDelete,
}: {
  tree: AiReportCategory[];
  selected: CatSel;
  onSelect: (s: CatSel) => void;
  onToggleGroup: (c: AiReportCategory) => void;
  onDelete: (c: AiReportCategory) => void;
}) {
  return (
    <div className="space-y-0.5">
      <TreeBtn active={selected === 'all'} onClick={() => onSelect('all')} label="全部报告" icon={<Folder className="h-4 w-4" />} />
      <TreeBtn
        active={selected === 'uncategorized'}
        onClick={() => onSelect('uncategorized')}
        label="未分类"
        icon={<Inbox className="h-4 w-4" />}
      />
      <CatLevel nodes={tree} depth={0} selected={selected} onSelect={onSelect} onToggleGroup={onToggleGroup} onDelete={onDelete} />
    </div>
  );
}

function CatLevel({
  nodes,
  depth,
  selected,
  onSelect,
  onToggleGroup,
  onDelete,
}: {
  nodes: AiReportCategory[];
  depth: number;
  selected: CatSel;
  onSelect: (s: CatSel) => void;
  onToggleGroup: (c: AiReportCategory) => void;
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
                )}
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() => onSelect(id)}
              >
                {active ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{n.name}</span>
                {n.is_group ? (
                  <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800">分组</span>
                ) : null}
              </button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100" title="切换分组" onClick={() => onToggleGroup(n)}>
                <FileText className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => onDelete(n)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
            {n.children?.length ? (
              <CatLevel nodes={n.children} depth={depth + 1} selected={selected} onSelect={onSelect} onToggleGroup={onToggleGroup} onDelete={onDelete} />
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
  onSave,
  onCancel,
}: {
  value: AiReportDef;
  sources: AiParamSource[];
  platforms: AiWorkflowPlatform[];
  categories: Array<AiReportCategory & { depth: number }>;
  onChange: (v: AiReportDef) => void;
  onSave: () => void;
  onCancel: () => void;
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

  return (
    <div className="space-y-3">
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
      <div className="space-y-2">
        <Label>参数槽位（勾选来源）</Label>
        <div className="space-y-1 rounded-md border p-2">
          {sources.map((s) => {
            const checked = value.slots?.some((x) => x.source_code === s.source_code) ?? false;
            return (
              <label key={s.source_code} className="flex items-center gap-2 text-sm">
                <Checkbox checked={checked} onCheckedChange={(c) => toggleSource(s.source_code, c === true)} />
                <span>
                  {s.name} <span className="text-muted-foreground">({s.source_code} / {s.value_type})</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div>
          <div className="text-sm font-medium">在 AI 工作流平台运行</div>
          <div className="text-xs text-muted-foreground">启用后须填写工作流编号</div>
        </div>
        <Switch
          checked={value.use_ai_workflow}
          onCheckedChange={(c) => onChange({ ...value, use_ai_workflow: c })}
        />
      </div>
      {value.use_ai_workflow ? (
        <>
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
            <Label>工作流编号</Label>
            <Input
              value={value.workflow_code || ''}
              onChange={(e) => onChange({ ...value, workflow_code: e.target.value })}
              placeholder="wf_store_daily_v1"
            />
          </div>
        </>
      ) : null}
      <div className="flex gap-2 pt-2">
        <Button type="button" onClick={onSave}>
          保存
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
