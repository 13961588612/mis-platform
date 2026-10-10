import { useCallback, useEffect, useMemo, useState } from 'react';
import { Undo2, FilePlus2, GitBranch, Layers, RefreshCw, Search, Workflow, FolderTree, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PermissionGate } from '@/components/auth/permission-gate';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  fetchDefinitions,
  activateDefinition,
  deactivateDefinition,
  type WfDefinition,
} from '@/lib/api/workflow';
import {
  fetchWfCategoryTree,
  fetchWfCategories,
  createWfCategory,
  updateWfCategory,
  deleteWfCategory,
  type WfCategoryItem,
  type UpsertWfCategoryRequest,
} from '@/lib/api/wf-category';
import { DesignerDialog } from './designer-dialog';
import { DefinitionDialog, type DefinitionDraft } from './definition-dialog';
import { WfCategoryTree } from './wf-category-tree';
import type { FlowMeta } from './property-panel';
import { cn } from '@/lib/utils';
import { CategoryTreeSelect } from '@/components/common/category-tree-select';

/** 流程编排 / 定义编辑的权限码（菜单 95006 `workflow:definition:edit`，V132 由 95007 合并而来）。 */
const PERM_EDIT = 'workflow:definition:edit';
const TENANT_ID = '1';
const OPERATOR_ID = '1';

type DesignerState = {
  open: boolean;
  definitionId?: string;
  initialFlowMeta?: Partial<FlowMeta>;
};
const CLOSED: DesignerState = { open: false };

const STATUS: Record<string, { text: string; cls: string }> = {
  DRAFT: { text: '草稿', cls: 'bg-muted text-muted-foreground' },
  ACTIVE: { text: '已发布', cls: 'bg-success/10 text-success' },
  ARCHIVED: { text: '已归档', cls: 'bg-warning/10 text-warning' },
};

const DEF_SIZE = 20;

/** 收集以 rootId 为根的子树（含自身）所有 id，用于分类删除时排除自身及子孙。 */
function collectWfSubtreeIds(nodes: WfCategoryItem[], rootId: string): Set<string> {
  const result = new Set<string>();
  const find = (list: WfCategoryItem[]): WfCategoryItem | null => {
    for (const n of list) {
      if (n.id === rootId) return n;
      if (n.children?.length) {
        const hit = find(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  const root = find(nodes);
  if (!root) return result;
  const addAll = (n: WfCategoryItem) => {
    result.add(n.id);
    n.children?.forEach(addAll);
  };
  addAll(root);
  return result;
}

/**
 * 将勾选的分类展开为「自身 + 全部子孙」id 列表（选父含子集）。
 * 树中找不到某 id 时仍保留该 id，避免误丢过滤条件。
 */
function expandCategoryIdsWithDescendants(tree: WfCategoryItem[], selectedIds: number[]): number[] {
  if (selectedIds.length === 0) return [];
  const result = new Set<number>();
  for (const id of selectedIds) {
    const subtree = collectWfSubtreeIds(tree, String(id));
    if (subtree.size === 0) {
      result.add(id);
    } else {
      for (const sid of subtree) result.add(Number(sid));
    }
  }
  return [...result];
}

interface FlatCat {
  id: string;
  name: string;
  depth: number;
}

function flattenWfCategories(nodes: WfCategoryItem[], depth = 0, acc: FlatCat[] = []): FlatCat[] {
  for (const n of nodes) {
    acc.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) flattenWfCategories(n.children, depth + 1, acc);
  }
  return acc;
}

/**
 * 系统管理 · 流程中心：流程定义列表 + 流程分类管理。
 *
 * <p>两个 Tab：
 * <ul>
 *   <li><b>流程定义</b>：列出自租户流程定义（含表单白名单与节点数），支持按分类/名称或编码筛选（点查询才请求；选父含子集）、发布与进入编排。</li>
 *   <li><b>分类管理</b>：维护 `wf_category` 邻接树（新增/编辑/删除），删除被引用的分类会被拦截。</li>
 * </ul>
 */
export function WorkflowDefinitionPage() {
  const [activeTab, setActiveTab] = useState<'definitions' | 'categories'>('definitions');

  // 流程定义列表状态
  const [items, setItems] = useState<WfDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  /** 筛选草稿（改条件不立刻请求；点「查询」后写入 applied*）。 */
  const [filterCategoryIds, setFilterCategoryIds] = useState<number[]>([]);
  const [filterKeyword, setFilterKeyword] = useState('');
  /** 已生效的查询条件（含展开后的分类 id）。 */
  const [appliedCategoryIds, setAppliedCategoryIds] = useState<number[]>([]);
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [designer, setDesigner] = useState<DesignerState>(CLOSED);

  // 流程分类状态
  const [categoryTree, setCategoryTree] = useState<WfCategoryItem[]>([]);
  const [categoryList, setCategoryList] = useState<WfCategoryItem[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<WfCategoryItem | null>(null);
  const [catDefaultParent, setCatDefaultParent] = useState<string | null>(null);
  const [catDeleteTarget, setCatDeleteTarget] = useState<WfCategoryItem | null>(null);
  const [catDeleting, setCatDeleting] = useState(false);

  const loadDefinitions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchDefinitions(
        TENANT_ID,
        page,
        DEF_SIZE,
        appliedCategoryIds.length > 0 ? appliedCategoryIds : undefined,
        appliedKeyword || undefined,
      );
      setItems(r.list);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, appliedCategoryIds, appliedKeyword]);

  /** 点「查询」：展开选中分类的子孙后生效，并回到第 1 页。 */
  const onSearch = useCallback(() => {
    setAppliedCategoryIds(expandCategoryIdsWithDescendants(categoryTree, filterCategoryIds));
    setAppliedKeyword(filterKeyword.trim());
    setPage(1);
  }, [categoryTree, filterCategoryIds, filterKeyword]);

  const loadCategories = useCallback(async () => {
    setCatLoading(true);
    setCatError(null);
    try {
      const [tree, list] = await Promise.all([
        fetchWfCategoryTree(TENANT_ID),
        fetchWfCategories(TENANT_ID),
      ]);
      setCategoryTree(tree);
      setCategoryList(list);
    } catch (e) {
      setCatError(e instanceof Error ? e.message : '加载分类失败');
    } finally {
      setCatLoading(false);
    }
  }, [TENANT_ID]);

  useEffect(() => {
    void loadDefinitions();
  }, [loadDefinitions]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  // 分类 id → name，用于列表「分类」列解析。
  const categoryNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categoryList) m.set(c.id, c.name);
    return m;
  }, [categoryList]);

  function categoryLabel(def: WfDefinition): string {
    if (def.categoryId != null) {
      return categoryNameMap.get(String(def.categoryId)) ?? `分类#${def.categoryId}`;
    }
    return def.category || '未分类';
  }

  async function onActivate(def: WfDefinition) {
    setActing(def.id);
    try {
      await activateDefinition(def.id, TENANT_ID);
      await loadDefinitions();
    } catch (e) {
      setError(e instanceof Error ? e.message : '发布失败');
    } finally {
      setActing(null);
    }
  }

  async function onDeactivate(def: WfDefinition) {
    setActing(def.id);
    try {
      await deactivateDefinition(def.id, TENANT_ID);
      await loadDefinitions();
    } catch (e) {
      setError(e instanceof Error ? e.message : '取消发布失败');
    } finally {
      setActing(null);
    }
  }

  const onDesignerSaved = useCallback(async () => {
    await loadDefinitions();
    setDesigner(CLOSED);
  }, [loadDefinitions]);

  const totalPages = Math.max(1, Math.ceil(total / DEF_SIZE));

  // ---- 分类管理 ----
  const selectedCategoryNode = useMemo(
    () => categoryList.find((c) => c.id === selectedCategoryId) ?? null,
    [categoryList, selectedCategoryId],
  );
  const catParentOptions = useMemo(() => {
    const flat = flattenWfCategories(categoryTree);
    if (!editingCategory) return flat;
    const blocked = collectWfSubtreeIds(categoryTree, editingCategory.id);
    return flat.filter((n) => !blocked.has(n.id));
  }, [categoryTree, editingCategory]);

  function openCategoryCreate(parentId: string | null) {
    setEditingCategory(null);
    setCatDefaultParent(parentId);
    setCatDialogOpen(true);
  }

  function openCategoryEdit(node: WfCategoryItem) {
    setEditingCategory(node);
    setCatDialogOpen(true);
  }

  async function confirmDeleteCategory() {
    const target = catDeleteTarget;
    if (!target) return;
    setCatDeleting(true);
    try {
      // 引用校验：若该分类下还有流程定义则拦截（避免产生孤儿定义）。
      const ref = await fetchDefinitions(TENANT_ID, 1, 1, [Number(target.id)]);
      if (ref.total > 0) {
        toast.error(`该分类下还有 ${ref.total} 个流程定义，无法删除`);
        setCatDeleteTarget(null);
        return;
      }
      await deleteWfCategory(target.id, TENANT_ID);
      toast.success('已删除分类');
      setCatDeleteTarget(null);
      if (selectedCategoryId === target.id) setSelectedCategoryId(null);
      await loadCategories();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setCatDeleting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="流程中心"
        description="流程定义、画布编排与表单白名单配置"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => (activeTab === 'definitions' ? void loadDefinitions() : void loadCategories())}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              刷新
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-1 rounded-lg border bg-card p-1 text-sm">
        <button
          type="button"
          onClick={() => setActiveTab('definitions')}
          className={
            activeTab === 'definitions'
              ? 'rounded-md bg-primary/10 px-3 py-1.5 font-medium text-primary'
              : 'rounded-md px-3 py-1.5 text-foreground hover:bg-accent'
          }
        >
          流程定义
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('categories')}
          className={
            activeTab === 'categories'
              ? 'rounded-md bg-primary/10 px-3 py-1.5 font-medium text-primary'
              : 'rounded-md px-3 py-1.5 text-foreground hover:bg-accent'
          }
        >
          分类管理
        </button>
      </div>

      {activeTab === 'definitions' ? (
        <>
          <div className="flex flex-nowrap items-center gap-2">
            <CategoryTreeSelect
              tree={categoryTree}
              value={filterCategoryIds.map(String)}
              onChange={(ids) => setFilterCategoryIds(ids.map(Number))}
              placeholder="全部分类"
              triggerClassName="w-56"
            />
            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filterKeyword}
                onChange={(e) => setFilterKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSearch();
                }}
                placeholder="流程名称或编码"
                className="h-9 w-64 pl-8"
                aria-label="流程名称或编码"
              />
            </div>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={onSearch}>
              <Search className="mr-1 h-3.5 w-3.5" />
              查询
            </Button>
            <Button size="sm" className="ml-auto shrink-0" onClick={() => setCreateOpen(true)}>
              <FilePlus2 className="mr-1 h-3.5 w-3.5" />
              新建流程
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : error ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-destructive">
                {error}
                <Button size="sm" variant="outline" onClick={() => void loadDefinitions()}>
                  重试
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Workflow className="h-6 w-6 opacity-40" />
                暂无流程定义
                <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                  去创建一个
                </Button>
              </div>
            ) : (
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">流程名称</th>
                    <th className="px-3 py-2 font-medium">编码</th>
                    <th className="px-3 py-2 font-medium">分类</th>
                    <th className="px-3 py-2 font-medium">版本</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">节点 / 表单</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((def) => {
                    const st = STATUS[def.status] ?? STATUS.DRAFT;
                    return (
                      <tr key={def.id} className="border-t transition hover:bg-muted/40">
                        <td className="px-3 py-2">
                          <div className="text-[13px] font-medium">{def.name}</div>
                          {def.description ? (
                            <div className="truncate text-[11px] text-muted-foreground" title={def.description}>
                              {def.description}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{def.code}</td>
                        <td className="px-3 py-2 text-[12px]">{categoryLabel(def)}</td>
                        <td className="px-3 py-2 tabular-nums text-[12px]">v{def.version}</td>
                        <td className="px-3 py-2">
                          <span className={cn('rounded px-1.5 py-0.5 text-[11px]', st.cls)}>{st.text}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-0.5">
                              <Layers className="h-3 w-3" /> {def.nodes?.length ?? 0}
                            </span>
                            <span className="inline-flex items-center gap-0.5">
                              <GitBranch className="h-3 w-3" />
                              {(def.supportedFormCodes ?? []).length > 0
                                ? def.supportedFormCodes.join(', ')
                                : '未配置表单'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={def.status === 'ACTIVE'}
                              title={def.status === 'ACTIVE' ? '已发布流程不可编辑，请先取消发布' : undefined}
                              onClick={() =>
                                setDesigner({
                                  open: true,
                                  definitionId: def.id,
                                  initialFlowMeta: {
                                    code: def.code,
                                    name: def.name,
                                    categoryId: def.categoryId ?? null,
                                    description: def.description ?? '',
                                    supportedFormCodes: (def.supportedFormCodes ?? []).join(','),
                                  },
                                })
                              }
                            >
                              编排
                            </Button>
                            <PermissionGate permission={PERM_EDIT}>
                              {def.status !== 'ACTIVE' ? (
                                <Button size="sm" disabled={acting === def.id} onClick={() => void onActivate(def)}>
                                  {acting === def.id ? '发布中…' : '发布'}
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={acting === def.id}
                                  onClick={() => void onDeactivate(def)}
                                  title="取消发布后回到草稿，可再次编排"
                                >
                                  <Undo2 className="mr-1 h-3.5 w-3.5" />
                                  {acting === def.id ? '取消中…' : '取消发布'}
                                </Button>
                              )}
                            </PermissionGate>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              共 <b className="text-foreground">{total}</b> 条 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FolderTree className="h-4 w-4" />
                分类树
              </div>
              <Button size="sm" variant="outline" onClick={() => openCategoryCreate(null)}>
                <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                新增根分类
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <WfCategoryTree
                tree={categoryTree}
                selectedId={selectedCategoryId}
                onSelect={setSelectedCategoryId}
                loading={catLoading}
              />
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card p-4">
            {catError ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-destructive">
                {catError}
                <Button size="sm" variant="outline" onClick={() => void loadCategories()}>
                  重试
                </Button>
              </div>
            ) : selectedCategoryNode ? (
              <div className="space-y-3">
                <div>
                  <div className="text-[13px] font-medium">{selectedCategoryNode.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{selectedCategoryNode.code}</div>
                  {categoryList.find((c) => c.id === selectedCategoryNode.id)?.description ? (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {categoryList.find((c) => c.id === selectedCategoryNode.id)?.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openCategoryCreate(selectedCategoryNode.id)}>
                    <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                    新增子分类
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openCategoryEdit(selectedCategoryNode)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setCatDeleteTarget(selectedCategoryNode)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <FolderTree className="h-6 w-6 opacity-40" />
                从左侧选择分类，或新增根分类
              </div>
            )}
          </div>
        </div>
      )}

      {createOpen ? (
        <DefinitionDialog
          open
          onOpenChange={setCreateOpen}
          onSubmit={(draft: DefinitionDraft) =>
            setDesigner({
              open: true,
              initialFlowMeta: { ...draft, supportedFormCodes: draft.supportedFormCodes.join(',') },
            })
          }
        />
      ) : null}
      <DesignerDialog
        open={designer.open}
        definitionId={designer.definitionId}
        initialFlowMeta={designer.initialFlowMeta}
        onOpenChange={(open) => setDesigner((s) => ({ ...s, open }))}
        onSaved={() => void onDesignerSaved()}
      />

      <CategoryDialog
        open={catDialogOpen}
        onOpenChange={setCatDialogOpen}
        initial={editingCategory}
        parentOptions={catParentOptions}
        defaultParentId={catDefaultParent}
        tenantId={TENANT_ID}
        operatorId={OPERATOR_ID}
        onSaved={() => void loadCategories()}
      />

      {catDeleteTarget ? (
        <Dialog open onOpenChange={(o) => !o && setCatDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>删除流程分类</DialogTitle>
              <DialogDescription>
                确定删除「{catDeleteTarget.name}」？若该分类下还有流程定义将无法删除。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCatDeleteTarget(null)} disabled={catDeleting}>
                取消
              </Button>
              <Button variant="destructive" onClick={() => void confirmDeleteCategory()} disabled={catDeleting}>
                {catDeleting ? '删除中…' : '删除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** 流程分类新增/编辑对话框（对应 `wf_category` 表）。 */
function CategoryDialog({
  open,
  onOpenChange,
  initial,
  parentOptions,
  defaultParentId,
  tenantId,
  operatorId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: WfCategoryItem | null;
  parentOptions: FlatCat[];
  defaultParentId: string | null;
  tenantId: string;
  operatorId: string;
  onSaved: () => void;
}) {
  const isEdit = initial !== null;
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('');
  const [parentId, setParentId] = useState<string>('root');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setCode(initial.code);
      setName(initial.name);
      setDescription(initial.description ?? '');
      setSortOrder(initial.sortOrder == null ? '' : String(initial.sortOrder));
      setParentId(initial.parentId == null ? 'root' : String(initial.parentId));
    } else {
      setCode('');
      setName('');
      setDescription('');
      setSortOrder('');
      setParentId(defaultParentId == null ? 'root' : defaultParentId);
    }
  }, [open, initial, defaultParentId]);

  async function handleSubmit() {
    if (!code.trim() || !name.trim()) {
      toast.error('请填写编码与名称');
      return;
    }
    const body: UpsertWfCategoryRequest = {
      code: code.trim(),
      name: name.trim(),
      description: description.trim().length === 0 ? null : description.trim(),
      sortOrder: sortOrder.trim().length === 0 ? null : Number(sortOrder),
      parentId: parentId === 'root' ? null : Number(parentId),
      config: null,
    };
    setSaving(true);
    try {
      if (isEdit && initial) {
        await updateWfCategory(initial.id, tenantId, body);
        toast.success('已更新分类');
      } else {
        await createWfCategory(tenantId, operatorId, body);
        toast.success('已创建分类');
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑流程分类' : '新增流程分类'}</DialogTitle>
          <DialogDescription>分类用于组织流程定义，支持多级嵌套。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3 px-1 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-1.5">
            <Label className="block text-sm font-medium text-foreground">编码 *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 PURCHASE" aria-label="分类编码" />
          </div>
          <div className="space-y-1.5">
            <Label className="block text-sm font-medium text-foreground">名称 *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 采购类" aria-label="分类名称" />
          </div>
          <div className="space-y-1.5">
            <Label className="block text-sm font-medium text-foreground">父级分类</Label>
            <select
              aria-label="父级分类"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="root">根节点（无父级）</option>
              {parentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {' '.repeat(opt.depth * 2)}
                  {opt.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="block text-sm font-medium text-foreground">排序</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="block text-sm font-medium text-foreground">描述</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="可选" />
          </div>
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default WorkflowDefinitionPage;
