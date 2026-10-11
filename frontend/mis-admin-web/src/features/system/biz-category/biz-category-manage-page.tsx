import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, FolderTree, Pencil, RefreshCw, Trash2, Info } from 'lucide-react';
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
  fetchBizCategoryTree,
  fetchBizCategories,
  createBizCategory,
  updateBizCategory,
  deleteBizCategory,
  UNCATEGORIZED_ID,
  type BizCategoryItem,
  type UpsertBizCategoryRequest,
} from '@/lib/api/biz-category';
import { BizCategoryTree } from './biz-category-tree';

/** 业务分类维护权限码（菜单 95012 `biz:category:list`，V139 登记）。 */
const PERM = 'biz:category:list';
const TENANT_ID = '1';
const OPERATOR_ID = '1';

interface FlatCat {
  id: string;
  name: string;
  depth: number;
}

/** 收集以 rootId 为根的子树（含自身）所有 id，用于父级候选排除自身及子孙（防环）。 */
function collectSubtreeIds(nodes: BizCategoryItem[], rootId: string): Set<string> {
  const result = new Set<string>();
  const find = (list: BizCategoryItem[]): BizCategoryItem | null => {
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
  const addAll = (n: BizCategoryItem) => {
    result.add(n.id);
    n.children?.forEach(addAll);
  };
  addAll(root);
  return result;
}

/** 将嵌套树拍平为「id / name / depth」列表，用于父级下拉。 */
function flattenCategories(nodes: BizCategoryItem[], depth = 0, acc: FlatCat[] = []): FlatCat[] {
  for (const n of nodes) {
    acc.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) flattenCategories(n.children, depth + 1, acc);
  }
  return acc;
}

/**
 * 系统管理 · 业务分类：租户通用邻接树（`biz_category`）维护页。
 *
 * <p>业务分类与 APP 无关，是流程定义 / 表单定义 / 消息 / 待办共用的业务类型载体；
 * 叶子节点的 `code` 即业务类型编码。左侧分类树 + 右侧详情，支持新增根/子分类、编辑、
 * 删除（后端校验：有子节点或被定义引用时拦截）；固定「未分类」兜底节点（id=991001）
 * 不可删除、不可改编码/名称。
 */
export function BizCategoryManagePage() {
  const [tree, setTree] = useState<BizCategoryItem[]>([]);
  const [list, setList] = useState<BizCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BizCategoryItem | null>(null);
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BizCategoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, l] = await Promise.all([
        fetchBizCategoryTree(TENANT_ID),
        fetchBizCategories(TENANT_ID),
      ]);
      setTree(t);
      setList(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载业务分类失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedNode = useMemo(
    () => list.find((c) => c.id === selectedId) ?? null,
    [list, selectedId],
  );

  const parentOptions = useMemo(() => {
    const flat = flattenCategories(tree);
    if (!editing) return flat;
    const blocked = collectSubtreeIds(tree, editing.id);
    return flat.filter((n) => !blocked.has(n.id));
  }, [tree, editing]);

  function openCreate(parentId: string | null) {
    setEditing(null);
    setDefaultParentId(parentId);
    setDialogOpen(true);
  }

  function openEdit(node: BizCategoryItem) {
    setEditing(node);
    setDialogOpen(true);
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleting(true);
    try {
      await deleteBizCategory(target.id, TENANT_ID);
      toast.success('已删除业务分类');
      setDeleteTarget(null);
      if (selectedId === target.id) setSelectedId(null);
      await load();
    } catch (e) {
      // 后端已做「有子节点 / 被定义引用」校验，直接透传其业务提示。
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  const isFallback = selectedNode?.id === UNCATEGORIZED_ID;

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="业务分类"
        description="租户通用业务分类与业务类型（流程 / 表单 / 消息 / 待办共用，与 APP 无关）"
        actions={
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            刷新
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <FolderTree className="h-4 w-4" />
              分类树
            </div>
            <PermissionGate permission={PERM}>
              <Button size="sm" variant="outline" onClick={() => openCreate(null)}>
                <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                新增根分类
              </Button>
            </PermissionGate>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <BizCategoryTree tree={tree} selectedId={selectedId} onSelect={setSelectedId} loading={loading} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card p-4">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-destructive">
              {error}
              <Button size="sm" variant="outline" onClick={() => void load()}>
                重试
              </Button>
            </div>
          ) : selectedNode ? (
            <div className="space-y-3">
              <div>
                <div className="text-[13px] font-medium">{selectedNode.name}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{selectedNode.code}</div>
                {selectedNode.description ? (
                  <p className="mt-1 text-[12px] text-muted-foreground">{selectedNode.description}</p>
                ) : null}
              </div>

              {isFallback ? (
                <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  这是系统兜底节点，承接未指定分类的定义，不可删除、不可修改编码或名称。
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <PermissionGate permission={PERM}>
                    <Button size="sm" variant="outline" onClick={() => openCreate(selectedNode.id)}>
                      <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                      新增子分类
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(selectedNode)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(selectedNode)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      删除
                    </Button>
                  </PermissionGate>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <FolderTree className="h-6 w-6 opacity-40" />
              从左侧选择分类，或新增根分类
            </div>
          )}
        </div>
      </div>

      <BizCategoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        parentOptions={parentOptions}
        defaultParentId={defaultParentId}
        tenantId={TENANT_ID}
        operatorId={OPERATOR_ID}
        onSaved={() => void load()}
      />

      {deleteTarget ? (
        <Dialog open onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>删除业务分类</DialogTitle>
              <DialogDescription>
                确定删除「{deleteTarget.name}」？若其下还有子分类或被流程 / 表单定义引用将无法删除。
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

/** 业务分类新增/编辑对话框（对应 `biz_category` 表）。 */
function BizCategoryDialog({
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
  initial: BizCategoryItem | null;
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
    // 编码须匹配后端 `^[A-Z][A-Z0-9_]{1,63}$`，前端先做一次快速校验。
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code.trim())) {
      toast.error('编码须以大写字母开头，仅含大写字母 / 数字 / 下划线，长度 2–64');
      return;
    }
    const body: UpsertBizCategoryRequest = {
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
        await updateBizCategory(initial.id, tenantId, body);
        toast.success('已更新业务分类');
      } else {
        await createBizCategory(tenantId, operatorId, body);
        toast.success('已创建业务分类');
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
          <DialogTitle>{isEdit ? '编辑业务分类' : '新增业务分类'}</DialogTitle>
          <DialogDescription>业务分类用于组织流程 / 表单定义，叶子节点即业务类型，支持多级嵌套。</DialogDescription>
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
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="如 PURCHASE"
              aria-label="分类编码"
            />
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
                  {' '.repeat(opt.depth * 2)}
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

export default BizCategoryManagePage;
