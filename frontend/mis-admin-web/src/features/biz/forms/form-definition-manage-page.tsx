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
  type FormDefinitionItem,
} from '@/lib/api/form-definition';
import { FormDefinitionTree } from './form-definition-tree';
import { FormDefinitionDialog } from './form-definition-dialog';

/** 与 definitions-page 一致：本地固定租户（BFF 单租户原型）。 */
const TENANT_ID = '1';
const OPERATOR_ID = '1';

const STATUS_META: Record<string, { text: string; variant: 'success' | 'outline' }> = {
  [FORM_STATUS_ENABLED]: { text: '启用', variant: 'success' },
  [FORM_STATUS_DISABLED]: { text: '停用', variant: 'outline' },
};

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

/**
 * 表单定义管理页（业务 · 表单注册）。
 *
 * <p>左侧分类树（来自 `/tree`）+ 右侧表格（来自列表接口），顶部工具栏含状态筛选、
 * 关键字搜索与「新增」。点击树节点按子树过滤表格；「新增/编辑」打开对话框。
 *
 * <p>UI 规范：表格吸顶 `min-h-0 flex-1 overflow-auto` 单层滚动；页面内不加内层 padding
 * （由 app-layout 控制）；主色 #4f46e5；表头/标签 13px；复用 Button/Dialog/Input/Textarea/
 * Select/Table/Badge/sonner。
 */
export function FormDefinitionManagePage() {
  const [tree, setTree] = useState<FormDefinitionItem[]>([]);
  const [list, setList] = useState<FormDefinitionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FormDefinitionItem | null>(null);
  const [dialogDefaultParent, setDialogDefaultParent] = useState<string>('root');
  const [deleteTarget, setDeleteTarget] = useState<FormDefinitionItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [treeData, listData] = await Promise.all([
        fetchFormDefinitionTree(TENANT_ID),
        fetchFormDefinitions(TENANT_ID, statusFilter === 'all' ? undefined : statusFilter),
      ]);
      setTree(treeData);
      setList(listData);
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
    walk(tree);
    return map;
  }, [tree]);

  const subtreeIds = useMemo(
    () => (selectedId ? collectSubtreeIds(tree, selectedId) : null),
    [tree, selectedId],
  );

  const visibleList = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return list.filter((item) => {
      if (subtreeIds && !subtreeIds.has(item.id)) return false;
      if (kw && !item.name.toLowerCase().includes(kw) && !item.code.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [list, subtreeIds, keyword]);

  const parentOptions = useMemo(
    () => buildParentOptions(tree, editing ? editing.id : null),
    [tree, editing],
  );

  function openCreate() {
    setEditing(null);
    setDialogDefaultParent(selectedId ?? 'root');
    setDialogOpen(true);
  }

  function openEdit(item: FormDefinitionItem) {
    setEditing(item);
    setDialogOpen(true);
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleting(true);
    try {
      await deleteFormDefinition(target.id, TENANT_ID);
      toast.success('已删除表单定义');
      setDeleteTarget(null);
      if (selectedId === target.id) setSelectedId(null);
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
            <Button size="sm" onClick={openCreate}>
              <FilePlus2 className="mr-1 h-3.5 w-3.5" />
              新增
            </Button>
          </div>
        }
      />

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
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            <FolderTree className="h-4 w-4" />
            分类树
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <FormDefinitionTree tree={tree} selectedId={selectedId} onSelect={setSelectedId} loading={loading} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : error ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-destructive">
                {error}
                <Button size="sm" variant="outline" onClick={() => void load()}>
                  重试
                </Button>
              </div>
            ) : visibleList.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <FolderTree className="h-6 w-6 opacity-40" />
                暂无表单定义
                <Button size="sm" variant="outline" onClick={openCreate}>
                  去创建一个
                </Button>
              </div>
            ) : (
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">名称</th>
                    <th className="px-3 py-2 font-medium">编码</th>
                    <th className="px-3 py-2 font-medium">父级</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">排序</th>
                    <th className="px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleList.map((item) => {
                    const st = STATUS_META[item.status] ?? STATUS_META[FORM_STATUS_ENABLED];
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
                        <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{item.code}</td>
                        <td className="px-3 py-2 text-[12px]">
                          {item.parentId == null ? '—' : (parentNameMap.get(String(item.parentId)) ?? '—')}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={st.variant}>{st.text}</Badge>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[12px]">{item.sortOrder ?? '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => openEdit(item)}>
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
      </div>

      <FormDefinitionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        parentOptions={parentOptions}
        defaultParentId={dialogDefaultParent}
        tenantId={TENANT_ID}
        operatorId={OPERATOR_ID}
        onSaved={() => void load()}
      />

      {deleteTarget ? (
        <Dialog open onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>删除表单定义</DialogTitle>
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
