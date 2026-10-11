import { useCallback, useEffect, useMemo, useState } from 'react';
import { Undo2, FilePlus2, GitBranch, Layers, RefreshCw, Search, Workflow } from 'lucide-react';
import { PermissionGate } from '@/components/auth/permission-gate';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchDefinitions,
  activateDefinition,
  deactivateDefinition,
  type WfDefinition,
} from '@/lib/api/workflow';
import { fetchBizCategoryTree, fetchBizCategories, type BizCategoryItem } from '@/lib/api/biz-category';
import { DesignerDialog } from './designer-dialog';
import { DefinitionDialog, type DefinitionDraft } from './definition-dialog';
import type { FlowMeta } from './property-panel';
import { cn } from '@/lib/utils';
import { CategoryTreeSelect } from '@/components/common/category-tree-select';

/** 流程编排 / 定义编辑的权限码（菜单 95006 `workflow:definition:edit`，V132 由 95007 合并而来）。 */
const PERM_EDIT = 'workflow:definition:edit';
const TENANT_ID = '1';

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
 * 系统管理 · 流程中心：流程定义列表。
 *
 * <p>列出自租户流程定义（含表单白名单与节点数），支持按业务分类 / 名称或编码筛选
 * （点查询才请求；选父含子集）、发布与进入编排。
 *
 * <p>分类为「租户通用业务分类」（`biz_category`），独立在系统管理「业务分类」页维护；
 * 本页仅消费分类数据（筛选下拉 + 列表「分类」列解析），不再内嵌分类管理面板。
 */
export function WorkflowDefinitionPage() {
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

  // 业务分类数据（筛选树 + 名称解析）
  const [categoryTree, setCategoryTree] = useState<BizCategoryItem[]>([]);
  const [categoryList, setCategoryList] = useState<BizCategoryItem[]>([]);

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
    try {
      const [tree, list] = await Promise.all([
        fetchBizCategoryTree(TENANT_ID),
        fetchBizCategories(TENANT_ID),
      ]);
      setCategoryTree(tree);
      setCategoryList(list);
    } catch {
      // 分类下拉不可用时降级：清空候选，不阻塞流程定义列表。
      setCategoryTree([]);
      setCategoryList([]);
    }
  }, []);

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

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="流程中心"
        description="流程定义、画布编排与表单白名单配置"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void loadDefinitions()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              刷新
            </Button>
          </div>
        }
      />

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
    </div>
  );
}

export default WorkflowDefinitionPage;
