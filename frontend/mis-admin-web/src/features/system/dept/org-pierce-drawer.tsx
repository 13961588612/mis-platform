import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronsRight, Folder, Network } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { TreeTable, type TreeTableColumn, type TreeTableNode } from '@/components/common/tree-table';
import { fetchDeptPierce } from '@/lib/api/depts';
import type { DeptNode, DeptPierceNode, OrgItem } from '@/types/api';

/** 穿透钻取栈层级：每层 = 来源组织 + 已加载的顶级部门树 forest。 */
type PierceLevel = { orgId: string; orgName: string; forest: DeptPierceNode[] };

type PierceRow = TreeTableNode & { node: DeptPierceNode };

function flattenPierce(nodes: DeptPierceNode[], depth = 0): PierceRow[] {
  const out: PierceRow[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, depth, node: n });
    if (n.children?.length) out.push(...flattenPierce(n.children, depth + 1));
  }
  return out;
}

export interface OrgPierceDrawerProps {
  /** 锚点部门（需含 linkedOrgId）；null = 无锚点 */
  anchorDept: DeptNode | null;
  /** 组织列表（用于名称回填，避免重复拉取） */
  orgs: OrgItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 组织穿透抽屉（E.4 / A.6）：只读浏览锚点组织的部门树，并支持沿「对应组织」面包屑向下钻取。
 *
 * <p>逻辑从 dept-tree-page 抽出为独立组件：复用 fetchDeptPierce + 钻取栈（防循环）。承载部门管理
 * 「穿透下钻」按钮（行内），避免引入独立的「组织穿透」Tab，落实三视图合一。
 */
export function OrgPierceDrawer({ anchorDept, orgs, open, onOpenChange }: OrgPierceDrawerProps) {
  const [levels, setLevels] = useState<PierceLevel[]>([]);
  const [loading, setLoading] = useState(false);

  const orgNameOf = useCallback(
    (id: string) => orgs.find((o) => o.id === id)?.name ?? '',
    [orgs],
  );

  const loadPierce = useCallback(
    async (id: string): Promise<DeptPierceNode[]> => {
      setLoading(true);
      try {
        return await fetchDeptPierce(id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载组织穿透失败');
        return [];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // 打开 / 锚点变化时，从锚点的 linkedOrgId 重置钻取栈
  useEffect(() => {
    if (!open) return;
    const anchor = anchorDept?.linkedOrgId;
    if (!anchor) {
      setLevels([]);
      return;
    }
    setLevels([{ orgId: anchor, orgName: anchorDept?.linkedOrgName || orgNameOf(anchor), forest: [] }]);
    void (async () => {
      const forest = await loadPierce(anchor);
      setLevels((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], forest };
        return next;
      });
    })();
  }, [open, anchorDept, orgNameOf, loadPierce]);

  const pierceRows = useMemo(() => {
    const top = levels[levels.length - 1];
    return top ? flattenPierce(top.forest) : [];
  }, [levels]);

  const pierceVisited = useMemo(() => new Set(levels.map((lv) => lv.orgId)), [levels]);

  const drillTo = useCallback(
    async (node: DeptPierceNode) => {
      const target = node.linkedOrgId;
      if (!target) return;
      if (pierceVisited.has(target)) {
        toast.warning('该组织已在钻取路径中，无法继续下钻（防循环）');
        return;
      }
      const forest = await loadPierce(target);
      setLevels((prev) => [...prev, { orgId: target, orgName: node.linkedOrgName || '', forest }]);
    },
    [loadPierce, pierceVisited],
  );

  const popPierceTo = useCallback((index: number) => {
    setLevels((prev) => prev.slice(0, index + 1));
  }, []);

  const pierceColumns: TreeTableColumn<PierceRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: '部门名称',
        cell: (row) => <span className="font-medium">{row.node.name}</span>,
      },
      {
        key: 'code',
        header: '编码',
        cell: (row) => (
          <span className="font-mono text-xs text-muted-foreground">{row.node.code ?? '—'}</span>
        ),
      },
      {
        key: 'orgName',
        header: '来源组织',
        cell: (row) =>
          row.depth === 0 ? (
            <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {row.node.orgName || '—'}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: 'linkedOrgName',
        header: '对应组织',
        cell: (row) => {
          if (!row.node.linkedOrgId) return <span className="text-muted-foreground">—</span>;
          const visited = pierceVisited.has(row.node.linkedOrgId);
          return (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">
                {row.node.linkedOrgName || row.node.linkedOrgId}
              </span>
              {visited ? (
                <span
                  className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 text-xs text-muted-foreground"
                  title="该组织已在钻取路径中（防循环）"
                >
                  已访问
                </span>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
                  onClick={() => void drillTo(row.node)}
                >
                  下钻
                  <ChevronRight className="h-3 w-3" />
                </button>
              )}
            </span>
          );
        },
      },
      {
        key: 'sort',
        header: '排序',
        cell: (row) => row.node.sort ?? 0,
        className: 'text-center',
        align: 'center',
      },
      {
        key: 'status',
        header: '状态',
        cell: (row) => (
          <span
            className={cn(
              'inline-flex items-center rounded-md px-2 py-0.5 text-xs',
              row.node.status === 1 ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
            )}
          >
            {row.node.status === 1 ? '启用' : '禁用'}
          </span>
        ),
      },
    ],
    [pierceVisited, drillTo],
  );

  const anchorName = anchorDept?.name ?? '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>组织穿透 · {anchorName}</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-2 text-sm">
            <span className="rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
              只读浏览 · 沿「对应组织」向下钻取
            </span>
            {levels.length > 0 ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                {levels.map((lv, i) => (
                  <span key={lv.orgId} className="inline-flex items-center gap-1">
                    {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    {i === levels.length - 1 ? (
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        {lv.orgName || lv.orgId}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => popPierceTo(i)}
                        className="rounded-md px-2 py-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        {lv.orgName || lv.orgId}
                      </button>
                    )}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {!anchorDept?.linkedOrgId ? (
              <div className="flex h-full items-center justify-center">
                <div className="p-10 text-center text-sm text-muted-foreground">
                  该部门未配置「对应组织」，无法进行穿透下钻
                </div>
              </div>
            ) : loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : pierceRows.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <Network className="h-8 w-8 text-muted-foreground/50" />
                  该组织暂无部门数据
                </div>
              </div>
            ) : (
              <TreeTable
                rows={pierceRows}
                columns={pierceColumns}
                treeColumnKey="name"
                rowIcon={(row) => {
                  const hasKids = Boolean(row.node.children?.length);
                  return hasKids ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="inline-block w-3.5 shrink-0" />
                  );
                }}
                emptyText="该组织暂无部门数据"
              />
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <span className="text-xs text-muted-foreground">
            <ChevronsRight className="mr-1 inline h-3.5 w-3.5" />
            点击「下钻」沿对应组织继续穿透；修改请回到部门管理对应组织
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
