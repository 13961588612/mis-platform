import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, FolderTree, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  fetchFormDefinitions,
  deleteFormDefinition,
  isValidFormCode,
  FORM_STATUS_ENABLED,
  FORM_STATUS_DISABLED,
  type FormDefinitionItem,
} from '@/lib/api/form-definition';
import {
  fetchFormCategoryTree,
  fetchFormCategories,
  createFormCategory,
  updateFormCategory,
  deleteFormCategory,
  type FormCategoryItem,
  type UpsertFormCategoryRequest,
} from '@/lib/api/form-category';
import { hasFormLoader } from './forms/form-loaders';
import { FormCategoryTree } from './form-category-tree';
import { FormDefinitionDialog, type CategorySelectOption } from './form-definition-dialog';
import { CategoryTreeSelect } from '@/components/common/category-tree-select';

/** 与 definitions-page 一致：本地固定租户（BFF 单租户原型）。 */
const TENANT_ID = '1';
const OPERATOR_ID = '1';

const STATUS_META: Record<string, { text: string; variant: 'success' | 'outline' }> = {
  [FORM_STATUS_ENABLED]: { text: '启用', variant: 'success' },
  [FORM_STATUS_DISABLED]: { text: '停用', variant: 'outline' },
};

type ManageTab = 'form' | 'category';

interface FlatCategory {
  id: string;
  name: string;
  depth: number;
}

/** 收集以 rootId 为根的子树（含自身）所有 id，编辑分类时排除自身及子孙作父级。 */
function collectSubtreeIds(nodes: FormCategoryItem[], rootId: string): Set<string> {
  const result = new Set<string>();
  const find = (list: FormCategoryItem[]): FormCategoryItem | null => {
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
  const addAll = (n: FormCategoryItem) => {
    result.add(n.id);
    n.children?.forEach(addAll);
  };
  addAll(root);
  return result;
}

function flattenCategories(nodes: FormCategoryItem[], depth = 0, acc: FlatCategory[] = []): FlatCategory[] {
  for (const n of nodes) {
    acc.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) flattenCategories(n.children, depth + 1, acc);
  }
  return acc;
}

/** 父级下拉候选：排除自身及其子树（编辑时不能选自己或子孙作父级）。 */
function buildParentOptions(nodes: FormCategoryItem[], excludeId?: string | null): FlatCategory[] {
  const flat = flattenCategories(nodes);
  if (!excludeId) return flat;
  const blocked = collectSubtreeIds(nodes, excludeId);
  return flat.filter((n) => !blocked.has(n.id));
}

/**
 * 表单定义管理页（业务 · 表单注册）。
 *
 * <p>分类已独立成表 `form_category`，是表单的<b>属性</b>（`form_definition.categoryId`），
 * 不再是父级。本页两个 Tab：
 * <ul>
 *   <li><b>表单管理</b>（默认）：右侧表格列全部表单，支持状态/分类/关键字筛选、
 *       分类列解析（null→「未分类」）、编码标红（未关联前端组件者）、新增/编辑/删除。</li>
 *   <li><b>分类管理</b>：左侧分类树（`form_category`）+ 右侧选中节点的新增子分类/编辑/删除。</li>
 * </ul>
 *
 * <p>UI 规范：表格吸顶 `min-h-0 flex-1 overflow-auto` 单层滚动；主色 #4f46e5；表头/标签 13px；
 * 复用 Button/Dialog/Input/Textarea/Select/Badge/sonner。
 */
export function FormDefinitionManagePage() {
  const [activeTab, setActiveTab] = useState<ManageTab>('form');

  // 表单管理 Tab 状态
  const [formList, setFormList] = useState<FormDefinitionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [keyword, setKeyword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FormDefinitionItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 分类管理 Tab 状态
  const [categoryTree, setCategoryTree] = useState<FormCategoryItem[]>([]);
  const [categoryList, setCategoryList] = useState<FormCategoryItem[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FormCategoryItem | null>(null);
  const [catDefaultParent, setCatDefaultParent] = useState<string | null>(null);
  const [catDeleteTarget, setCatDeleteTarget] = useState<FormCategoryItem | null>(null);
  const [catDeleting, setCatDeleting] = useState(false);

  // 表单新增/编辑对话框
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<FormDefinitionItem | null>(null);

  const loadForms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const forms = await fetchFormDefinitions(
        TENANT_ID,
        statusFilter === 'all' ? undefined : statusFilter,
        categoryIds.length > 0 ? categoryIds : undefined,
      );
      setFormList(forms);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryIds]);

  const loadCategories = useCallback(async () => {
    setCatLoading(true);
    setCatError(null);
    try {
      const [tree, list] = await Promise.all([
        fetchFormCategoryTree(TENANT_ID),
        fetchFormCategories(TENANT_ID),
      ]);
      setCategoryTree(tree);
      setCategoryList(list);
    } catch (e) {
      setCatError(e instanceof Error ? e.message : '加载分类失败');
    } finally {
      setCatLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  // 分类 id → name，用于表单列表「分类」列解析（id 是 number，name map 用 string 归一化）。
  const categoryNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categoryList) map.set(c.id, c.name);
    return map;
  }, [categoryList]);

  const visibleForms = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return formList.filter((item) => {
      if (kw && !item.name.toLowerCase().includes(kw) && !item.code.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [formList, keyword]);

  // 表单对话框的「分类」下拉：来自分类树（扁平 + 缩进）。
  const formCategoryOptions: CategorySelectOption[] = useMemo(
    () => flattenCategories(categoryTree).map((c) => ({ id: c.id, name: c.name, depth: c.depth })),
    [categoryTree],
  );

  const catParentOptions = useMemo(
    () => buildParentOptions(categoryTree, editingCategory ? editingCategory.id : null),
    [categoryTree, editingCategory],
  );

  const selectedCategoryNode = useMemo(
    () => categoryList.find((c) => c.id === selectedCategoryId) ?? null,
    [categoryList, selectedCategoryId],
  );

  function categoryLabel(item: FormDefinitionItem): string {
    if (item.categoryId != null) {
      return categoryNameMap.get(String(item.categoryId)) ?? `分类#${item.categoryId}`;
    }
    return '未分类';
  }

  function openFormCreate() {
    setEditingForm(null);
    setFormDialogOpen(true);
  }

  function openFormEdit(item: FormDefinitionItem) {
    setEditingForm(item);
    setFormDialogOpen(true);
  }

  async function confirmDeleteForm() {
    const target = deleteTarget;
    if (!target) return;
    setDeleting(true);
    try {
      await deleteFormDefinition(target.id, TENANT_ID);
      toast.success('已删除');
      setDeleteTarget(null);
      await loadForms();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  function openCategoryCreate(parentId: string | null) {
    setEditingCategory(null);
    setCatDefaultParent(parentId);
    setCatDialogOpen(true);
  }

  function openCategoryEdit(node: FormCategoryItem) {
    setEditingCategory(node);
    setCatDialogOpen(true);
  }

  async function confirmDeleteCategory() {
    const target = catDeleteTarget;
    if (!target) return;
    setCatDeleting(true);
    try {
      // 引用校验：若该分类下还有表单则拦截（避免前端与后端错误信息不一致）。
      const refs = await fetchFormDefinitions(TENANT_ID, undefined, [Number(target.id)]);
      if (refs.length > 0) {
        toast.error(`该分类下还有 ${refs.length} 个表单，无法删除`);
        setCatDeleteTarget(null);
        return;
      }
      await deleteFormCategory(target.id, TENANT_ID);
      toast.success('已删除分类');
      setCatDeleteTarget(null);
      if (selectedCategoryId === target.id) setSelectedCategoryId(null);
      await loadCategories();
      setCategoryIds((prev) => prev.filter((id) => String(id) !== target.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除分类失败');
    } finally {
      setCatDeleting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="表单定义管理"
        description="业务表单注册与分类管理"
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void (activeTab === 'form' ? loadForms() : loadCategories())}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              刷新
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-1 rounded-lg border bg-card p-1 text-sm">
        <button
          type="button"
          onClick={() => setActiveTab('form')}
          className={
            activeTab === 'form'
              ? 'rounded-md bg-primary/10 px-3 py-1.5 font-medium text-primary'
              : 'rounded-md px-3 py-1.5 text-foreground hover:bg-accent'
          }
        >
          表单管理
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('category')}
          className={
            activeTab === 'category'
              ? 'rounded-md bg-primary/10 px-3 py-1.5 font-medium text-primary'
              : 'rounded-md px-3 py-1.5 text-foreground hover:bg-accent'
          }
        >
          分类管理
        </button>
      </div>

      {activeTab === 'form' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value={FORM_STATUS_ENABLED}>启用</SelectItem>
                <SelectItem value={FORM_STATUS_DISABLED}>停用</SelectItem>
              </SelectContent>
            </Select>
            <CategoryTreeSelect
              tree={categoryTree}
              value={categoryIds.map(String)}
              onChange={(ids) => setCategoryIds(ids.map(Number))}
              placeholder="全部分类"
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索名称或编码"
                className="h-9 w-64 pl-8"
              />
            </div>
            <Button size="sm" onClick={openFormCreate}>
              <FilePlus2 className="mr-1 h-3.5 w-3.5" />
              新增表单
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
            {loading ? (
              <div className="flex h-40 w-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : error ? (
              <div className="flex h-40 w-full flex-col items-center justify-center gap-2 text-sm text-destructive">
                {error}
                <Button size="sm" variant="outline" onClick={() => void loadForms()}>
                  重试
                </Button>
              </div>
            ) : visibleForms.length === 0 ? (
              <div className="flex h-40 w-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <FolderTree className="h-6 w-6 opacity-40" />
                暂无表单定义
                <Button size="sm" variant="outline" onClick={openFormCreate}>
                  去创建一个
                </Button>
              </div>
            ) : (
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">名称</th>
                    <th className="px-3 py-2 font-medium">编码</th>
                    <th className="px-3 py-2 font-medium">分类</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">排序</th>
                    <th className="px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleForms.map((item) => {
                    const st = STATUS_META[item.status] ?? STATUS_META[FORM_STATUS_ENABLED];
                    const linked = hasFormLoader(item.code);
                    return (
                      <tr key={item.id} className="border-t transition hover:bg-muted/40">
                        <td className="px-3 py-2">
                          <div className="text-[13px] font-medium">{item.name}</div>
                          {item.description ? (
                            <div className="truncate text-[11px] text-muted-foreground" title={item.description}>
                              {item.description}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-[12px]">
                          <span className={linked ? 'text-muted-foreground' : 'text-destructive'}>{item.code}</span>
                          {!linked ? (
                            <span className="ml-1 rounded border border-destructive/40 px-1.5 py-0.5 text-[11px] text-destructive">
                              未关联组件
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-[12px]">{categoryLabel(item)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={st.variant}>{st.text}</Badge>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[12px]">{item.sortOrder ?? '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => openFormEdit(item)}>
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              编辑
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-destructive/40 text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteTarget(item)}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              删除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
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
              <FormCategoryTree
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
                  {selectedCategoryNode.description ? (
                    <p className="mt-1 text-[12px] text-muted-foreground">{selectedCategoryNode.description}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openCategoryCreate(selectedCategoryNode.id)}>
                    <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                    新增子分类
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openCategoryEdit(selectedCategoryNode)}>
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

      <FormDefinitionDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        initial={editingForm}
        categoryOptions={formCategoryOptions}
        tenantId={TENANT_ID}
        operatorId={OPERATOR_ID}
        onSaved={() => void loadForms()}
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

      {deleteTarget ? (
        <Dialog open onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>删除确认</DialogTitle>
              <DialogDescription>确定删除「{deleteTarget.name}」？该操作不可恢复。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                取消
              </Button>
              <Button variant="destructive" onClick={() => void confirmDeleteForm()} disabled={deleting}>
                {deleting ? '删除中…' : '删除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {catDeleteTarget ? (
        <Dialog open onOpenChange={(o) => !o && setCatDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>删除表单分类</DialogTitle>
              <DialogDescription>
                确定删除「{catDeleteTarget.name}」？若该分类下还有表单将无法删除。
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

/** 表单分类新增/编辑对话框（对应 `form_category` 表）。 */
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
  initial: FormCategoryItem | null;
  parentOptions: FlatCategory[];
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
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
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
    setCodeError(null);
    setNameError(null);
  }, [open, initial, defaultParentId]);

  async function handleSubmit() {
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    const cErr = isValidFormCode(trimmedCode) ? null : '编码格式不正确（需以大写字母开头，仅含大写字母、数字、下划线，长度 2-64）';
    const nErr = trimmedName.length === 0 ? '请填写名称' : null;
    setCodeError(cErr);
    setNameError(nErr);
    if (cErr || nErr) return;

    const body: UpsertFormCategoryRequest = {
      code: trimmedCode,
      name: trimmedName,
      description: description.trim().length === 0 ? null : description.trim(),
      sortOrder: sortOrder.trim().length === 0 ? null : Number(sortOrder),
      parentId: parentId === 'root' ? null : Number(parentId),
      config: null,
    };
    setSaving(true);
    try {
      if (isEdit && initial) {
        await updateFormCategory(initial.id, tenantId, body);
        toast.success('已更新分类');
      } else {
        await createFormCategory(tenantId, operatorId, body);
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
          <DialogTitle>{isEdit ? '编辑表单分类' : '新增表单分类'}</DialogTitle>
          <DialogDescription>分类用于组织表单，支持多级嵌套。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3 px-1 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="fc-code" className="block text-sm font-medium text-foreground">
              编码 *
            </label>
            <Input
              id="fc-code"
              aria-label="分类编码"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (codeError) setCodeError(null);
              }}
              placeholder="如 PURCHASE"
            />
            {codeError ? <p className="text-xs text-destructive">{codeError}</p> : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fc-name" className="block text-sm font-medium text-foreground">
              名称 *
            </label>
            <Input
              id="fc-name"
              aria-label="分类名称"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="如 采购类"
            />
            {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fc-parent" className="block text-sm font-medium text-foreground">
              父级分类
            </label>
            <select
              id="fc-parent"
              aria-label="父级分类"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="root">根节点（无父级）</option>
              {parentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {' '.repeat(opt.depth * 2)}
                  {opt.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fc-sort" className="block text-sm font-medium text-foreground">
              排序
            </label>
            <Input
              id="fc-sort"
              type="number"
              aria-label="分类排序"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fc-desc" className="block text-sm font-medium text-foreground">
              描述
            </label>
            <Textarea
              id="fc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="可选"
            />
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

export default FormDefinitionManagePage;
