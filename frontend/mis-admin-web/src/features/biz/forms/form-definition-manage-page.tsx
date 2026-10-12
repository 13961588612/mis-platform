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
  fetchFormDefinitions,
  deleteFormDefinition,
  FORM_STATUS_ENABLED,
  FORM_STATUS_DISABLED,
  type FormDefinitionItem,
} from '@/lib/api/form-definition';
import { fetchBizCategoryTree, fetchBizCategories, type BizCategoryItem } from '@/lib/api/biz-category';
import { hasFormLoader } from './forms/form-loaders';
import { FormDefinitionDialog } from './form-definition-dialog';
import { CategoryTreeSelect } from '@/components/common/category-tree-select';

/** 与 definitions-page 一致：本地固定租户（BFF 单租户原型）。 */
const TENANT_ID = '1';
const OPERATOR_ID = '1';

const STATUS_META: Record<string, { text: string; variant: 'success' | 'outline' }> = {
  [FORM_STATUS_ENABLED]: { text: '启用', variant: 'success' },
  [FORM_STATUS_DISABLED]: { text: '停用', variant: 'outline' },
};

/** 收集以 rootId 为根的子树（含自身）所有 id，用于分类筛选展开子孙。 */
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

/**
 * 将勾选的分类展开为「自身 + 全部子孙」id 列表（选父含子集）。
 * 树中找不到某 id 时仍保留该 id，避免误丢过滤条件。
 */
function expandCategoryIdsWithDescendants(tree: BizCategoryItem[], selectedIds: number[]): number[] {
  if (selectedIds.length === 0) return [];
  const result = new Set<number>();
  for (const id of selectedIds) {
    const subtree = collectSubtreeIds(tree, String(id));
    if (subtree.size === 0) {
      result.add(id);
    } else {
      for (const sid of subtree) result.add(Number(sid));
    }
  }
  return [...result];
}

/**
 * 表单定义管理页（业务 · 表单注册）。
 *
 * <p>分类为「租户通用业务分类」（`biz_category`），是表单的<b>属性</b>
 * （`form_definition.categoryId`），独立在系统管理「业务分类」页维护；本页仅消费分类数据。
 *
 * <p>表格列出全部表单，支持状态 / 业务分类 / 关键字筛选（点查询才请求；选父含子集；
 * 名称/编码本地模糊）、分类列解析（null→「未分类」）、编码标红（未关联前端组件者）、
 * 新增/编辑/删除。
 *
 * <p>UI 规范：表格吸顶 `min-h-0 flex-1 overflow-auto` 单层滚动；主色 #4f46e5；表头/标签 13px；
 * 复用 Button/Dialog/Input/Select/Badge/sonner。
 */
export function FormDefinitionManagePage() {
  // 表单管理状态
  const [formList, setFormList] = useState<FormDefinitionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 筛选草稿（改条件不立刻请求；点「查询」后写入 applied*）。 */
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCategoryIds, setFilterCategoryIds] = useState<number[]>([]);
  const [filterKeyword, setFilterKeyword] = useState('');
  /** 已生效的查询条件（分类为展开后的自身+子孙 id）。 */
  const [appliedStatus, setAppliedStatus] = useState<string>('all');
  const [appliedCategoryIds, setAppliedCategoryIds] = useState<number[]>([]);
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FormDefinitionItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 业务分类数据（筛选树 + 名称解析 + 对话框下拉）
  const [categoryTree, setCategoryTree] = useState<BizCategoryItem[]>([]);
  const [categoryList, setCategoryList] = useState<BizCategoryItem[]>([]);

  // 表单新增/编辑对话框
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<FormDefinitionItem | null>(null);

  const loadForms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const forms = await fetchFormDefinitions(
        TENANT_ID,
        appliedStatus === 'all' ? undefined : appliedStatus,
        appliedCategoryIds.length > 0 ? appliedCategoryIds : undefined,
      );
      setFormList(forms);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [appliedStatus, appliedCategoryIds]);

  const loadCategories = useCallback(async () => {
    try {
      const [tree, list] = await Promise.all([
        fetchBizCategoryTree(TENANT_ID),
        fetchBizCategories(TENANT_ID),
      ]);
      setCategoryTree(tree);
      setCategoryList(list);
    } catch {
      // 分类下拉不可用时降级：清空候选，不阻塞表单列表。
      setCategoryTree([]);
      setCategoryList([]);
    }
  }, []);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  /** 点「查询」：展开选中分类的子孙后生效（关键词本地过滤，与列表一并刷新口径）。 */
  const onSearch = useCallback(() => {
    setAppliedStatus(filterStatus);
    setAppliedCategoryIds(expandCategoryIdsWithDescendants(categoryTree, filterCategoryIds));
    setAppliedKeyword(filterKeyword.trim());
  }, [categoryTree, filterCategoryIds, filterKeyword, filterStatus]);

  // 分类 id → name，用于表单列表「分类」列解析（id 是 number，name map 用 string 归一化）。
  const categoryNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categoryList) map.set(c.id, c.name);
    return map;
  }, [categoryList]);

  const visibleForms = useMemo(() => {
    const kw = appliedKeyword.toLowerCase();
    return formList.filter((item) => {
      if (kw && !item.name.toLowerCase().includes(kw) && !item.code.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [formList, appliedKeyword]);

  // 表单对话框的「分类」下拉：直接消费业务分类树（嵌套，按层级渲染）。
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="表单定义管理"
        description="业务表单注册（分类为租户通用业务分类）"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void loadForms()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              刷新
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-nowrap items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-32 shrink-0">
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
              placeholder="搜索名称或编码"
              className="h-9 w-64 pl-8"
              aria-label="名称或编码"
            />
          </div>
          <Button size="sm" variant="secondary" className="shrink-0" onClick={onSearch}>
            <Search className="mr-1 h-3.5 w-3.5" />
            查询
          </Button>
          <Button size="sm" className="ml-auto shrink-0" onClick={openFormCreate}>
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

      <FormDefinitionDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        initial={editingForm}
        categoryTree={categoryTree}
        tenantId={TENANT_ID}
        operatorId={OPERATOR_ID}
        onSaved={() => void loadForms()}
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
    </div>
  );
}

export default FormDefinitionManagePage;
