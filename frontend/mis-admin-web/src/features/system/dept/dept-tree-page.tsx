import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Eye, Folder, Layers, Network, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { TreeTable, type TreeTableColumn, type TreeTableNode } from '@/components/common/tree-table';
import { StatusBadge } from '@/components/common/list-page-skeleton';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { listOrgs } from '@/lib/api/orgs';
import { createDept, deleteDept, fetchDeptPierce, fetchDeptTree, updateDept } from '@/lib/api/depts';
import type { DeptNode, DeptPierceNode, OrgItem } from '@/types/api';

/** 种子数据：部门类别 id=3（部门） */
const DEFAULT_CATEGORY_ID = 3;

/**
 * 岗位编制：从「员工任职记录」派生，而非硬编码部门名匹配。
 * 这样无论部门树来自 mock 还是真实接口，只要有员工任职，编制视图就有数据。
 */
type PostStaffing = { post: string; holders: string[] };
type DeptStaffing = { posts: PostStaffing[]; employees: string[] };

/** 员工任职样例（与员工页保持一致，用于派生部门编制） */
const EMPLOYEE_ASSIGNMENTS: { name: string; assignments: { dept: string; post: string }[] }[] = [
  { name: '李文博', assignments: [{ dept: '总经理办公室', post: '总经理' }] },
  {
    name: '王磊',
    assignments: [
      { dept: '研发中心', post: '研发总监' },
      { dept: '研发中心', post: '架构师' },
      { dept: '市场部', post: '技术委员会' },
    ],
  },
  {
    name: '赵敏',
    assignments: [
      { dept: '财务部', post: '财务经理' },
      { dept: '人力资源部', post: '内审委员' },
    ],
  },
  {
    name: '孙强',
    assignments: [
      { dept: '总经理办公室', post: '大区总' },
      { dept: '市场部', post: '大区总' },
      { dept: '人力资源部', post: '大区总' },
    ],
  },
];

/** 由员工任职派生：部门名 -> 岗位 -> 任职人 */
function deriveStaffing(): Record<string, DeptStaffing> {
  const map: Record<string, DeptStaffing> = {};
  for (const emp of EMPLOYEE_ASSIGNMENTS) {
    for (const a of emp.assignments) {
      const d = (map[a.dept] ??= { posts: [], employees: [] });
      let p = d.posts.find((x) => x.post === a.post);
      if (!p) {
        p = { post: a.post, holders: [] };
        d.posts.push(p);
      }
      if (!p.holders.includes(emp.name)) p.holders.push(emp.name);
      if (!d.employees.includes(emp.name)) d.employees.push(emp.name);
    }
  }
  return map;
}

const STAFFING = deriveStaffing();

const fieldLabel = SHEET_FORM_LABEL;
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

type DeptRow = TreeTableNode & { node: DeptNode };

function flatten(nodes: DeptNode[], depth = 0): DeptRow[] {
  const out: DeptRow[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, depth, node: n });
    if (n.children?.length) out.push(...flatten(n.children, depth + 1));
  }
  return out;
}

type PierceRow = TreeTableNode & { node: DeptPierceNode };

function flattenPierce(nodes: DeptPierceNode[], depth = 0): PierceRow[] {
  const out: PierceRow[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, depth, node: n });
    if (n.children?.length) out.push(...flattenPierce(n.children, depth + 1));
  }
  return out;
}

/** 穿透钻取栈层级：每层 = 来源组织 + 已加载的顶级部门树 forest。 */
type PierceLevel = { orgId: string; orgName: string; forest: DeptPierceNode[] };

export function DeptTreePage() {
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [orgId, setOrgId] = useState('');
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DeptNode | null>(null);
  const [parentId, setParentId] = useState('0');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', sort: '0', status: 1, linkedOrgId: '' });
  const [view, setView] = useState<'tree' | 'staffing' | 'pierce'>('tree');
  const [staffingDept, setStaffingDept] = useState<DeptNode | null>(null);
  const [staffingOpen, setStaffingOpen] = useState(false);

  // V40 组织穿透：钻取栈（面包屑）+ 已访问 org（防循环）
  const [pierceLevels, setPierceLevels] = useState<PierceLevel[]>([]);
  const [pierceLoading, setPierceLoading] = useState(false);

  const rows = useMemo(() => flatten(tree), [tree]);

  const pierceRows = useMemo(() => {
    const top = pierceLevels[pierceLevels.length - 1];
    return top ? flattenPierce(top.forest) : [];
  }, [pierceLevels]);

  /** 已访问 org 集合 = 钻取栈内的 orgId（回退时同步移除，防 A→B→A）。 */
  const pierceVisited = useMemo(() => new Set(pierceLevels.map((lv) => lv.orgId)), [pierceLevels]);

  const orgNameOf = useCallback(
    (id: string) => orgs.find((o) => o.id === id)?.name ?? '',
    [orgs],
  );

  /** 懒加载某组织顶级部门树 forest；失败回退空数组。 */
  const loadPierce = useCallback(async (id: string): Promise<DeptPierceNode[]> => {
    setPierceLoading(true);
    try {
      return await fetchDeptPierce(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载组织穿透失败');
      return [];
    } finally {
      setPierceLoading(false);
    }
  }, []);

  /** 进入穿透视图：从当前所选组织顶级部门树开始，重置钻取栈。 */
  const enterPierce = useCallback(async () => {
    if (!orgId) return;
    setView('pierce');
    setPierceLevels([{ orgId, orgName: orgNameOf(orgId), forest: [] }]);
    const forest = await loadPierce(orgId);
    setPierceLevels((prev) => {
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], forest };
      return next;
    });
  }, [orgId, orgNameOf, loadPierce]);

  /** 锚点下钻：以 linkedOrgId 调同一端点；已访问则禁用提示（防循环）。 */
  const drillTo = useCallback(
    async (node: DeptPierceNode) => {
      const target = node.linkedOrgId;
      if (!target) return;
      if (pierceVisited.has(target)) {
        toast.warning('该组织已在钻取路径中，无法继续下钻（防循环）');
        return;
      }
      const forest = await loadPierce(target);
      setPierceLevels((prev) => [
        ...prev,
        { orgId: target, orgName: node.linkedOrgName || '', forest },
      ]);
    },
    [loadPierce, pierceVisited],
  );

  /** 面包屑回退：截断钻取栈到指定层级。 */
  const popPierceTo = useCallback((index: number) => {
    setPierceLevels((prev) => prev.slice(0, index + 1));
  }, []);

  /**
   * 编制视图部门列表：直接从「员工任职派生」的 STAFFING 取键，
   * 不再依赖后端部门树名称匹配 —— 凡是有任职的部门一定出现，彻底避免空白。
   * 同时保留后端部门的 code（用于展示），缺失则留空。
   */
  const staffingRows = useMemo(() => {
    const treeByName = new Map(rows.map((r) => [r.node.name, r]));
    return Object.keys(STAFFING)
      .map((name) => {
        const info = STAFFING[name];
        const posts = info?.posts ?? [];
        const filled = posts.filter((p) => p.holders.length > 0).length;
        const vacant = posts.length - filled;
        const employees = info?.employees ?? [];
        const matched = treeByName.get(name);
        return {
          name,
          code: matched?.node.code ?? '',
          depth: matched?.depth ?? 0,
          postCount: posts.length,
          filled,
          vacant,
          employees,
        };
      })
      .sort((a, b) => b.postCount - a.postCount);
  }, [rows]);

  const columns: TreeTableColumn<DeptRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: '部门名称',
        cell: (row) => <span className="font-medium">{row.node.name}</span>,
      },
      {
        key: 'code',
        header: '编码',
        cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.node.code ?? '—'}</span>,
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
          <StatusBadge
            tone={row.node.status === 1 ? 'success' : 'destructive'}
            text={row.node.status === 1 ? '启用' : '禁用'}
          />
        ),
      },
    ],
    [],
  );

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
        cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.node.code ?? '—'}</span>,
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
          <StatusBadge
            tone={row.node.status === 1 ? 'success' : 'destructive'}
            text={row.node.status === 1 ? '启用' : '禁用'}
          />
        ),
      },
    ],
    [pierceVisited, drillTo, popPierceTo],
  );

  /** 懒加载某组织顶级部门树 forest；失败回退空数组。 */
  const loadTree = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      setTree(await fetchDeptTree(id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载部门失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listOrgs();
        setOrgs(list);
        if (list[0]) setOrgId(list[0].id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载组织失败');
      }
    })();
  }, []);

  useEffect(() => {
    if (orgId) void loadTree(orgId);
  }, [orgId, loadTree]);

  /** 切换组织：穿透模式下退出穿透回到该组织普通视图（P0-PR-05）。 */
  function onOrgChange(id: string) {
    setOrgId(id);
    if (view === 'pierce') {
      setView('tree');
      setPierceLevels([]);
    }
  }

  function openCreate(parent: string) {
    setEditing(null);
    setParentId(parent);
    setForm({ name: '', sort: '0', status: 1, linkedOrgId: '' });
    setOpen(true);
  }

  function openEdit(node: DeptNode) {
    setEditing(node);
    setParentId(node.parentId);
    setForm({
      name: node.name,
      sort: String(node.sort ?? 0),
      status: node.status,
      linkedOrgId: node.linkedOrgId ?? '',
    });
    setOpen(true);
  }

  async function onSave() {
    if (!form.name.trim() || !orgId) {
      toast.warning('请填写部门名称');
      return;
    }
    const linkedOrgId = form.linkedOrgId === '' ? null : Number(form.linkedOrgId);
    setSaving(true);
    try {
      if (editing) {
        await updateDept(editing.id, {
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
          status: form.status,
          linkedOrgId,
        });
        toast.success('已更新');
      } else {
        await createDept({
          orgId: Number(orgId),
          parentId: Number(parentId) || 0,
          name: form.name.trim(),
          categoryId: DEFAULT_CATEGORY_ID,
          sort: Number(form.sort) || 0,
          linkedOrgId,
        });
        toast.success('已创建');
      }
      setOpen(false);
      await loadTree(orgId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(node: DeptNode) {
    if (!window.confirm(`确认删除部门「${node.name}」？`)) return;
    try {
      await deleteDept(node.id);
      toast.success('已删除');
      await loadTree(orgId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  const orgOptions = useMemo(
    () =>
      orgs.filter((o) => o.status === 1).map((o) => ({ id: o.id, name: o.name })),
    [orgs],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="部门管理"
        description="组织内部门树；组织穿透视图只读浏览锚点组织的部门树。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'system',
          group: '组织架构',
          title: '部门管理',
        })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border bg-muted/40 p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setView('tree')}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium',
                  view === 'tree' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                <Folder className="h-3.5 w-3.5" />
                组织架构
              </button>
              <button
                type="button"
                onClick={() => setView('staffing')}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium',
                  view === 'staffing' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                <Layers className="h-3.5 w-3.5" />
                岗位编制
              </button>
              <button
                type="button"
                onClick={() => void enterPierce()}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium',
                  view === 'pierce' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                <Network className="h-3.5 w-3.5" />
                组织穿透
              </button>
            </div>
            <select
              className={cn(fieldInput, 'w-40')}
              value={orgId}
              onChange={(e) => onOrgChange(e.target.value)}
            >
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {view === 'tree' ? (
              <PermissionGate permission="system:dept:add">
                <Button size="sm" onClick={() => openCreate(tree[0]?.id ?? '0')}>
                  <Plus className="h-4 w-4" />
                  新增部门
                </Button>
              </PermissionGate>
            ) : null}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        {loading && view === 'tree' ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : view === 'staffing' ? (
          staffingRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">暂无岗位编制数据</div>
          ) : (
            <ul className="divide-y">
              {staffingRows.map((r) => (
                <li key={r.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setStaffingDept({ id: r.name, name: r.name, code: r.code, depth: r.depth } as unknown as DeptNode);
                      setStaffingOpen(true);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted/40"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="inline-block w-1 self-stretch rounded bg-primary/30"
                        style={{ marginLeft: r.depth * 12 }}
                      />
                      <span className="truncate font-medium">{r.name}</span>
                      {r.code ? (
                        <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                        {r.postCount} 岗
                      </span>
                      <span className="rounded-md bg-success/10 px-2 py-0.5 text-success">
                        已满 {r.filled}
                      </span>
                      <span
                        className={cn(
                          'rounded-md px-2 py-0.5',
                          r.vacant > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-muted-foreground',
                        )}
                      >
                        空缺 {r.vacant}
                      </span>
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : view === 'pierce' ? (
          <div className="flex h-full flex-col p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                只读浏览 · 修改请切换组织
              </span>
              {pierceLevels.length > 0 ? (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {pierceLevels.map((lv, i) => (
                    <span key={lv.orgId} className="inline-flex items-center gap-1">
                      {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                      {i === pierceLevels.length - 1 ? (
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
            {pierceLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : pierceRows.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="p-10 text-center text-sm text-muted-foreground">该组织暂无部门数据</div>
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
        ) : (
          <TreeTable
            rows={rows}
            columns={columns}
            treeColumnKey="name"
            actionsAlwaysVisible
            storageKey="mis-dept-tree-table-widths"
            rowIcon={(row) => {
              const hasKids = Boolean(row.node.children?.length);
              return hasKids ? (
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <span className="inline-block w-3.5 shrink-0" />
              );
            }}
            rowActions={(row) => (
              <>
                <PermissionGate permission="system:dept:add">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                    onClick={() => openCreate(row.node.id)}
                  >
                    <Plus className="h-3 w-3" />
                    子部门
                  </button>
                </PermissionGate>
                <PermissionGate permission="system:dept:edit">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                    onClick={() => openEdit(row.node)}
                  >
                    <Pencil className="h-3 w-3" />
                    编辑
                  </button>
                </PermissionGate>
                <PermissionGate permission="system:dept:delete">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                    onClick={() => void onDelete(row.node)}
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </button>
                </PermissionGate>
              </>
            )}
            emptyText="暂无部门数据"
          />
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? '编辑部门' : '新增部门'}</SheetTitle>
          </SheetHeader>
          <div className={SHEET_FORM_BODY}>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>名称 *</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>排序</label>
              <Input value={form.sort} onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))} />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>对应组织（穿透锚点）</label>
              <select
                className={fieldInput}
                value={form.linkedOrgId}
                onChange={(e) => setForm((f) => ({ ...f, linkedOrgId: e.target.value }))}
              >
                <option value="">无（不参与穿透下钻）</option>
                {orgOptions
                  .filter((o) => o.id !== orgId)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                打标后，穿透浏览到该部门可「下钻」到对应组织的顶级部门树；不可选当前组织自身
              </p>
            </div>
            {editing ? (
              <div className={SHEET_FORM_FIELD}>
                <label className={fieldLabel}>状态</label>
                <select
                  className={fieldInput}
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: Number(e.target.value) }))}
                >
                  <option value={1}>启用</option>
                  <option value={0}>禁用</option>
                </select>
              </div>
            ) : null}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={() => void onSave()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={staffingOpen} onOpenChange={setStaffingOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>岗位编制 · {staffingDept?.name ?? ''}</SheetTitle>
          </SheetHeader>
          <div className={SHEET_FORM_BODY}>
            {staffingDept ? (() => {
              const info = STAFFING[staffingDept.name];
              const posts = info?.posts ?? [];
              const filled = posts.filter((p) => p.holders.length > 0).length;
              const vacant = posts.length - filled;
              const employees = info?.employees ?? [];
              return (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg border bg-muted/30 p-3 text-center">
                      <div className="text-lg font-semibold">{posts.length}</div>
                      <div className="text-xs text-muted-foreground">岗位数</div>
                    </div>
                    <div className="rounded-lg border bg-success/10 p-3 text-center">
                      <div className="text-lg font-semibold text-success">{filled}</div>
                      <div className="text-xs text-muted-foreground">已任职</div>
                    </div>
                    <div className="rounded-lg border bg-destructive/10 p-3 text-center">
                      <div className="text-lg font-semibold text-destructive">{vacant}</div>
                      <div className="text-xs text-muted-foreground">空缺</div>
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-foreground">岗位任职情况</h4>
                    {posts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">该部门暂无岗位编制数据</p>
                    ) : (
                      <ul className="space-y-2">
                        {posts.map((p) => (
                          <li
                            key={p.post}
                            className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
                          >
                            <span className="min-w-0 font-medium">{p.post}</span>
                            {p.holders.length > 0 ? (
                              <span className="flex flex-wrap justify-end gap-1">
                                {p.holders.map((h) => (
                                  <span
                                    key={h}
                                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                                  >
                                    <Users className="h-3 w-3" />
                                    {h}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-dashed border-destructive/50 px-2 py-0.5 text-xs text-destructive">
                                空缺
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-foreground">
                      部门任职人员（{employees.length}）
                    </h4>
                    {employees.length === 0 ? (
                      <p className="text-sm text-muted-foreground">暂无任职人员</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {employees.map((e) => (
                          <span
                            key={e}
                            className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-sm"
                          >
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />
                            {e}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })() : null}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setStaffingOpen(false)}>
              关闭
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
