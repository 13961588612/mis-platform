import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, FolderTree, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  fetchFormDefinitionTree,
  fetchFormDefinitions,
  deleteFormDefinition,
  FORM_STATUS_ENABLED,
  FORM_STATUS_DISABLED,
  FORM_KIND_FORM,
  FORM_KIND_CATEGORY,
  type FormDefinitionItem,
  type FormKind,
} from '@/lib/api/form-definition';
import { hasFormLoader } from './forms/form-loaders';
import { FormDefinitionTree } from './form-definition-tree';
import { FormDefinitionDialog } from './form-definition-dialog';

/** 与 definitions-page 一致：本地固定租户（BFF 单租户原型）。 */
const TENANT_ID = '1';
const OPERATOR_ID = '1';

const STATUS_META: Record<string, { text: string; variant: 'success' | 'outline' }> = {
  [FORM_STATUS_ENABLED]: { text: '启用', variant: 'success' },
  [FORM_STATUS_DISABLED]: { text: '停用', variant: 'outline' },
};

type ManageTab = 'form' | 'category';

/** 收集以 rootId 为根的子树（含自身）所有 id，用于树节点过滤右侧表格。 */
function collectSubtreeIds(nodes: FormDefinitionItem[], rootId: string): Set<string> {
  const result = new Set<string>();
  const find = (list: FormDefinitionItem[]): FormDefinitionItem | null => {
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
  const addAll = (n: FormDefinitionItem) => {
    result.add(n.id);
    n.children?.forEach(addAll);
  };
  addAll(root);
  return result;
}

interface FlatNode {
  id: string;
  name: string;
  depth: number;
}

function flattenTree(nodes: FormDefinitionItem[], depth = 0, acc: FlatNode[] = []): FlatNode[] {
  for (const n of nodes) {
    acc.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) flattenTree(n.children, depth + 1, acc);
  }
  return acc;
}

/** 父级下拉候选：排除自身及其子树（编辑时不能选自己或子孙作父级）。 */
function buildParentOptions(
  nodes: FormDefinitionItem[],
  excludeId?: string | null,
): { id: string; name: string; depth: number }[] {
  const flat = flattenTree(nodes);
  if (!excludeId) return flat;
  const blocked = collectSubtreeIds(nodes, excludeId);
  return flat.filter((n) => !blocked.has(n.id));
}

/** 在分类树中按 id 定位节点（分类管理 Tab 编辑/删除用）。 */
function findCategoryNode(nodes: FormDefinitionItem[], id: string | null): FormDefinitionItem | null {
  if (!id) return null;
  const walk = (list: FormDefinitionItem[]): FormDefinitionItem | null => {
    for (const n of list) {
      if (n.id === id) return n;
      if (n.children?.length) {
        const hit = walk(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(nodes);
}

/**
 * 表单定义管理页（业务 · 表单注册）。
 *
 * <p>V131 起 `form_definition` 单表同时承载「分类节点」与「表单节点」（`kind` 区分）。
 * 本页拆成两个 Tab：
 * <ul>
 *   <li><b>表单管理</b>（默认）：右侧表格列出全部 `FORM` 节点，支持状态/关键字筛选、
 *       编码标红（未关联前端组件者）、新增/编辑/删除。</li>
 *   <li><b>分类管理</b>：左侧分类树（仅 `CATEGORY` 节点）+ 右侧选中节点的新增子分类/编辑/删除。</li>
 * </ul>
 *
 * <p>UI 规范：表格吸顶 `min-h-0 flex-1 overflow-auto` 单层滚动；主色 #4f46e5；表头/标签 13px；
 * 复用 Button/Dialog/Input/Textarea/Select/Table/Badge/sonner。
 */
export function FormDefinitionManagePage() {
  const [categoryTree, setCategoryTree] = useState<FormDefinitionItem[]>([]);
  const [formList, setFormList] = useState<FormDefinitionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ManageTab>('form');

  // 表单管理 Tab 状态
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FormDefinitionItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 分类管理 Tab 状态
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // 新增/编辑对话框
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FormDefinitionItem | null>(null);
  const [dialogKind, setDialogKind] = useState<FormKind>(FORM_KIND_FORM);
  const [dialogDefaultParent, setDialogDefaultParent] = useState<string>('root');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catTree, forms] = await Promise.all([
        fetchFormDefinitionTree(TENANT_ID, FORM_KIND_CATEGORY),
        fetchFormDefinitions(
          TENANT_ID,
          statusFilter === 'all' ? undefined : statusFilter,
          FORM_KIND_FORM,
        ),
      ]);
      setCategoryTree(catTree);
      setFormList(forms);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const parentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: FormDefinitionItem[]) => {
      for (const n of nodes) {
        map.set(n.id, n.name);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(categoryTree);
    return map;
  }, [categoryTree]);

  const visibleForms = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return formList.filter((item) => {
      if (kw && !item.name.toLowerCase().includes(kw) && !item.code.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [formList, keyword]);

  const parentOptions = useMemo(
    () => buildParentOptions(categoryTree, editing ? editing.id : null),
    [categoryTree, editing],
  );

  const selectedCategoryNode = useMemo(
    () => findCategoryNode(categoryTree, selectedCategoryId),
    [categoryTree, selectedCategoryId],
  );

  function openFormCreate() {
    setEditing(null);
    setDialogKind(FORM_KIND_FORM);
    setDialogDefaultParent('root');
    setDialogOpen(true);
  }

  function openFormEdit(item: FormDefinitionItem) {
    setEditing(item);
    setDialogKind(FORM_KIND_FORM);
    setDialogOpen(true);
  }

  function openCategoryCreate(parentId: string | null) {
    setEditing(null);
    setDialogKind(FORM_KIND_CATEGORY);
    setDialogDefaultParent(parentId ?? 'root');
    setDialogOpen(true);
  }

  function openCategoryEdit(node: FormDefinitionItem) {
    setEditing(node);
    setDialogKind(FORM_KIND_CATEGORY);
    setDialogOpen(true);
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleting(true);
    try {
      await deleteFormDefinition(target.id, TENANT_ID);
      toast.success('已删除');
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="表单定义管理"
        description="业务表单注册与分类管理"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()}>
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

          <div className="flex min-h-0 flex-1 overflow-auto rounded-md border bg-card">
            {loading ? (
              <div className="flex h-40 w-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : error ? (
              <div className="flex h-40 w-full flex-col items-center justify-center gap-2 text-sm text-destructive">
                {error}
                <Button size="sm" variant="outline" onClick={() => void load()}>
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
                    <th className="px-3 py-2 font-medium">类型</th>
                    <th className="px-3 py-2 font-medium">父级</th>
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
                        <td className="px-3 py-2 text-[12px]">
                          <Badge variant={item.kind === FORM_KIND_CATEGORY ? 'outline' : 'secondary'}>
                            {item.kind === FORM_KIND_CATEGORY ? '分类' : '表单'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-[12px]">
                          {item.parentId == null ? '—' : (parentNameMap.get(String(item.parentId)) ?? '—')}
                        </td>
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
              <Button size="sm" variant="outline" onClick={() => openCategoryCreate('root')}>
                <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                新增根分类
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <FormDefinitionTree
                tree={categoryTree}
                selectedId={selectedCategoryId}
                onSelect={setSelectedCategoryId}
                rootLabel="全部分类"
                loading={loading}
              />
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card p-4">
            {selectedCategoryNode ? (
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
                    onClick={() => setDeleteTarget(selectedCategoryNode)}
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
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        parentOptions={parentOptions}
        defaultParentId={dialogDefaultParent}
        kind={dialogKind}
        tenantId={TENANT_ID}
        operatorId={OPERATOR_ID}
        onSaved={() => void load()}
      />

      {deleteTarget ? (
        <Dialog open onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>删除确认</DialogTitle>
              <DialogDescription>
                确定删除「{deleteTarget.name}」？该操作不可恢复。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                取消
              </Button>
              <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? '删除中…' : '删除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export default FormDefinitionManagePage;
