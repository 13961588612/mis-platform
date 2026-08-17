import { SHEET_FORM_BODY, SHEET_FORM_FIELD, SHEET_FORM_LABEL } from '@/components/common/sheet-form-styles';
import { Fragment, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Folder, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/page-header';
import { buildAppBreadcrumbs } from '@/components/common/app-breadcrumbs';
import { StatusBadge } from '@/components/common/list-page-skeleton';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { PermissionGate } from '@/components/auth/permission-gate';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { listOrgs } from '@/lib/api/orgs';
import {
  createDept,
  deleteDept,
  fetchDeptStaffing,
  fetchDeptTree,
  updateDept,
  type DeptStaffingVO,
} from '@/lib/api/depts';
import type { DeptNode, OrgItem } from '@/types/api';
import { DeptTypeTreeSelect } from '@/components/common/dept-type-tree-select';
import {
  buildOrgChain,
  normalizeDeptNodes,
  normalizePierceForest,
  type DeptTreeRow,
} from './dept-tree-types';
import { usePierceTree } from './use-pierce-tree';

/** 种子数据：部门类别 id=3（部门） */
const DEFAULT_CATEGORY_ID = 3;
/** V54 种子数据：部门类型 id=1002（默认末级类型） */
const DEFAULT_DEPT_TYPE_ID = 1002;

const fieldLabel = SHEET_FORM_LABEL;
const fieldInput =
  'h-auto min-h-9 w-full rounded-md border border-input bg-card px-[0.7rem] py-[0.55rem] text-sm';

// 部门树采用递归渲染（renderNodes），不再使用 flatten 全量拍平。
// D1：本地部门与穿透只读部门统一归一化为 DeptTreeRow 后由同一个 renderNodes 渲染。

export function DeptTreePage({ headerExtra }: { headerExtra?: ReactNode }) {
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [orgId, setOrgId] = useState('');
  const [treeRows, setTreeRows] = useState<DeptTreeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DeptNode | null>(null);
  const [parentId, setParentId] = useState('0');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    sort: '0',
    status: 1,
    linkedOrgId: '',
    deptTypeId: String(DEFAULT_DEPT_TYPE_ID),
    establishmentCount: '0',
  });

  // 任职详情（岗位编制）面板展开集合：由「查看任职详情」按钮切换（规则 2.3 / G6）。
  const [staffingIds, setStaffingIds] = useState<Set<string>>(new Set());
  const [staffingMap, setStaffingMap] = useState<Record<string, DeptStaffingVO>>({});
  const [staffingLoadingId, setStaffingLoadingId] = useState<string | null>(null);
  /**
   * inline 穿透状态（D2 / D6 / D9）：
   * - expandedIds 统一驱动「本地子部门」与「链接组织穿透」的展开/收起；
   * - piercedCache 按来源组织 id 缓存穿透 forest，每个组织仅请求一次。
   */
  const {
    piercedCache,
    isPierceLoading,
    loadPierceOrg,
    resetPierce,
    isExpanded,
    toggleExpand,
    collapse,
    resetExpanded,
  } = usePierceTree();

  // 渲染改为 renderNodes(treeRows, 0)，无需预拍平 rows。

  const orgNameOf = useCallback(
    (id: string) => orgs.find((o) => o.id === id)?.name ?? '',
    [orgs],
  );

  /** 列宽：部门名称(树)/编码/编制数/部门类型/是否末级/对应组织/岗位数/已任职/空缺/排序/状态/操作（locked） */
  const columns = useMemo<ResizableColumn[]>(
    () => [
      { key: 'name', label: '部门名称' },
      { key: 'code', label: '编码' },
      { key: 'establishmentCount', label: '编制数' },
      { key: 'deptTypeName', label: '部门类型' },
      { key: 'isLeaf', label: '是否末级' },
      { key: 'linkedOrg', label: '对应组织' },
      { key: 'postCount', label: '岗位数' },
      { key: 'filled', label: '已任职' },
      { key: 'vacant', label: '空缺' },
      { key: 'sort', label: '排序' },
      { key: 'status', label: '状态' },
      { key: '__ops__', label: '操作', locked: true },
    ],
    [],
  );
  const { widthOf, startResize, hasCustom, reset: resetColWidths, tableStyle } = useColumnWidths(
    columns,
    'mis-dept-tree-table-widths',
  );

  const loadTree = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      // D1：后端 DeptNode[] → 可编辑的 DeptTreeRow[]（readOnly = false）
      setTreeRows(normalizeDeptNodes(await fetchDeptTree(id)));
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

  /** 行内展开/收起「任职详情（岗位编制）」面板；展开时懒加载该部门真实编制（GET /depts/{id}/staffing）。由「查看任职详情」按钮触发（规则 2.3 / G6）。 */
  const toggleStaffing = useCallback(
    (id: string) => {
      setStaffingIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          // 仅首次展开时拉取，缓存到 staffingMap（防重复请求）
          if (!staffingMap[id] && staffingLoadingId !== id) {
            setStaffingLoadingId(id);
            fetchDeptStaffing(id)
              .then((vo) => {
                setStaffingMap((m) => ({ ...m, [id]: vo }));
              })
              .catch(() => {
                toast.error('加载岗位编制失败');
              })
              .finally(() => {
                setStaffingLoadingId((cur) => (cur === id ? null : cur));
              });
          }
        }
        return next;
      });
    },
    [staffingMap, staffingLoadingId],
  );

  function onOrgChange(id: string) {
    setOrgId(id);
    // 切换组织：折叠子部门树 + 关闭任职详情面板 + 清空穿透/编制缓存（避免串组织）
    resetExpanded();
    resetPierce();
    setStaffingIds(new Set());
    setStaffingMap({});
  }

  function openCreate(parent: string) {
    setEditing(null);
    setParentId(parent);
    setForm({
      name: '',
      sort: '0',
      status: 1,
      linkedOrgId: '',
      deptTypeId: String(DEFAULT_DEPT_TYPE_ID),
      establishmentCount: '0',
    });
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
      deptTypeId: node.deptTypeId ?? String(DEFAULT_DEPT_TYPE_ID),
      establishmentCount: node.establishmentCount != null ? String(node.establishmentCount) : '0',
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
          deptTypeId: form.deptTypeId === '' || form.deptTypeId == null ? undefined : Number(form.deptTypeId),
          establishmentCount: Number(form.establishmentCount) || 0,
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
          deptTypeId: form.deptTypeId === '' || form.deptTypeId == null ? undefined : Number(form.deptTypeId),
          establishmentCount: Number(form.establishmentCount) || 0,
        });
        toast.success('已创建');
      }
      setOpen(false);
      // 组织内部门树变化，刷新骨架 + 折叠树 + 关闭任职详情 + 清穿透/编制缓存
      resetExpanded();
      resetPierce();
      setStaffingIds(new Set());
      setStaffingMap({});
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
      collapse(node.id);
      setStaffingIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
      await loadTree(orgId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  /**
   * 箭头点击（D6 / D2 / D9）：统一 inline 展开/收起。
   *
   * <p>链接组织部门（含穿透行中的嵌套链接节点）首次展开时懒加载其组织的穿透 forest；
   * 防循环校验命中则 toast 拦截且不改变展开态。普通部门直接展开本地 children。
   */
  const onArrowClick = useCallback(
    async (row: DeptTreeRow) => {
      const targetOrgId = row.linkedOrgId;
      // 已展开 → 直接收起（无需再次加载）
      if (targetOrgId && !isExpanded(row.id)) {
        const ok = await loadPierceOrg(targetOrgId, row.orgChain);
        if (!ok) return;
      }
      toggleExpand(row.id);
    },
    [isExpanded, loadPierceOrg, toggleExpand],
  );

  const orgOptions = useMemo(
    () => orgs.filter((o) => o.status === 1).map((o) => ({ id: o.id, name: o.name })),
    [orgs],
  );

  const thPad = 'px-3';

  /**
   * 递归渲染部门树（D1 统一渲染）：父节点仅当其 id 在 expandedIds（规则 2.1 / G4，默认空=全折叠）时才渲染其子树。
   *
   * <p>本地行（`readOnly = false`）保留全部操作；穿透只读行（`readOnly = true`）隐藏全部操作按钮，
   * 仅渲染 muted「只读」标签（D3），且「部门类型/是否末级/编制数/岗位数/已任职/空缺」统一显示「—」（D8）。
   * 岗位数/任职数/空缺数未加载编制时默认 0（规则 2.2 / G5）。
   */
  const renderNodes = (rows: DeptTreeRow[], depth: number): ReactNode[] => {
    const elements: ReactNode[] = [];
    for (const row of rows) {
      const readOnly = row.readOnly;
      const localNode = row.node;
      const linkedOrgId = row.linkedOrgId;
      const isLinked = !!linkedOrgId;
      const expanded = isExpanded(row.id);
      // 任职详情面板仅本地行可用（穿透节点属其它组织，无本地编制数据）
      const staffingOpen = !readOnly && staffingIds.has(row.rawId);
      const vo = readOnly ? undefined : staffingMap[row.rawId];
      const staffingLoading = staffingLoadingId === row.rawId;

      /**
       * 子级来源（D2 / D4）：
       * - 链接组织节点 → 取 piercedCache[linkedOrgId] 归一化的只读 forest（未命中缓存则处于加载中）；
       * - 其余节点 → 取同组织内的本地/嵌套 children，不再发请求。
       */
      let childRows: DeptTreeRow[] = row.children;
      let pierceLoading = false;
      if (linkedOrgId) {
        const cachedForest = piercedCache[linkedOrgId];
        if (cachedForest) {
          childRows = normalizePierceForest(cachedForest, buildOrgChain(row.orgChain, linkedOrgId));
        } else {
          childRows = [];
          pierceLoading = isPierceLoading(linkedOrgId);
        }
      }

      const linkedOrgLabel = linkedOrgId
        ? row.linkedOrgName || orgNameOf(linkedOrgId) || linkedOrgId
        : '';
      const sourceOrgLabel = row.sourceOrgName || orgNameOf(row.orgId) || row.orgId;

      elements.push(
        <Fragment key={row.id}>
          <tr className="border-b border-border/50 bg-table-row even:bg-table-stripe hover:bg-table-hover">
            {/* 部门名称（树）：箭头统一 inline 展开——本地子部门 / 链接组织穿透（D6） */}
            <td
              className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle"
              style={{ paddingLeft: 12 + depth * 16 }}
            >
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void onArrowClick(row)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  aria-label={
                    expanded ? '收起下级部门' : isLinked ? '展开对应组织的下级部门' : '展开子部门'
                  }
                  aria-expanded={expanded}
                >
                  <ChevronRight className={cn('h-3.5 w-3.5 transition', expanded && 'rotate-90')} />
                </button>
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className={cn('font-medium', readOnly && 'text-foreground/80')}>{row.name}</span>
                {isLinked ? (
                  <span
                    className="ml-1 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-medium text-primary"
                    title="已配置对应组织（点箭头 inline 展开其下级部门）"
                  >
                    锚点
                  </span>
                ) : null}
              </span>
            </td>
            <td className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle font-mono text-xs">
              {row.code ?? '—'}
            </td>
            <td className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle text-right tabular-nums">
              {readOnly ? <span className="text-muted-foreground">—</span> : row.establishmentCount ?? 0}
            </td>
            <td className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle">
              {readOnly ? <span className="text-muted-foreground">—</span> : row.deptTypeName ?? '—'}
            </td>
            <td className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle">
              {readOnly ? (
                <span className="text-muted-foreground">—</span>
              ) : row.isLeaf === 1 ? (
                <span className="inline-flex items-center rounded-md bg-success/10 px-2 py-0.5 text-xs text-success">末级</span>
              ) : (
                <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">非末级</span>
              )}
            </td>
            {/* D7：本地链接部门显示 linkedOrgName；穿透只读行显示来源组织 orgName */}
            <td className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle">
              {readOnly ? (
                <span
                  className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary"
                  title="来源组织（穿透只读）"
                >
                  {sourceOrgLabel || '—'}
                </span>
              ) : !linkedOrgId ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">
                  {linkedOrgLabel}
                </span>
              )}
            </td>
            {/* 规则 2.2 / G5：未加载编制时默认 0；穿透只读行无本地编制数据 → 「—」 */}
            <td className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle text-center">
              {readOnly ? <span className="text-muted-foreground">—</span> : vo ? vo.postCount : 0}
            </td>
            <td className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle text-center">
              {readOnly ? (
                <span className="text-muted-foreground">—</span>
              ) : vo ? (
                <span className="rounded-md bg-success/10 px-2 py-0.5 text-xs text-success">{vo.filledCount}</span>
              ) : (
                0
              )}
            </td>
            <td className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle text-center">
              {readOnly ? (
                <span className="text-muted-foreground">—</span>
              ) : vo ? (
                <span
                  className={cn(
                    'rounded-md px-2 py-0.5 text-xs',
                    vo.vacantCount > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-muted-foreground',
                  )}
                >
                  {vo.vacantCount}
                </span>
              ) : (
                0
              )}
            </td>
            <td className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle text-center">{row.sort ?? 0}</td>
            <td className="overflow-hidden whitespace-nowrap px-3 py-2 align-middle">
              <StatusBadge
                tone={row.status === 1 ? 'success' : 'destructive'}
                text={row.status === 1 ? '启用' : '禁用'}
              />
            </td>
            <td className="px-3 py-2 align-middle">
              <div className="flex items-center justify-end gap-1">
                {readOnly || !localNode ? (
                  // D3：穿透只读行隐藏全部操作按钮，仅保留 muted「只读」标签（非交互）
                  <span className="text-xs text-muted-foreground" title="穿透浏览的下级部门，仅可查看">
                    只读
                  </span>
                ) : (
                  <>
                    {!isLinked ? (
                      <PermissionGate permission="system:dept:add">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                          onClick={() => openCreate(row.rawId)}
                        >
                          <Plus className="h-3 w-3" />
                          子部门
                        </button>
                      </PermissionGate>
                    ) : null}
                    <PermissionGate permission="system:dept:edit">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                        onClick={() => openEdit(localNode)}
                      >
                        <Pencil className="h-3 w-3" />
                        编辑
                      </button>
                    </PermissionGate>
                    <PermissionGate permission="system:dept:delete">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                        onClick={() => void onDelete(localNode)}
                      >
                        <Trash2 className="h-3 w-3" />
                        删除
                      </button>
                    </PermissionGate>
                    {/* 规则 2.3 / G6：查看任职详情，接管原箭头的编制面板开关 */}
                    <PermissionGate permission="system:dept:view">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                        onClick={() => toggleStaffing(row.rawId)}
                        title="查看任职详情"
                      >
                        <Users className="h-3 w-3" />
                        查看任职详情
                      </button>
                    </PermissionGate>
                  </>
                )}
              </div>
            </td>
          </tr>
          {staffingOpen ? (
            <tr className="border-b border-border/50 bg-muted/20">
              <td colSpan={columns.length} className="px-4 py-3">
                {staffingLoading ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">加载岗位编制中…</div>
                ) : !vo ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">暂无岗位编制数据</div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <div className="rounded-lg border bg-muted/30 p-3 text-center">
                      <div className="text-lg font-semibold">{vo.postCount}</div>
                      <div className="text-xs text-muted-foreground">岗位数</div>
                    </div>
                    <div className="rounded-lg border bg-success/10 p-3 text-center">
                      <div className="text-lg font-semibold text-success">{vo.filledCount}</div>
                      <div className="text-xs text-muted-foreground">已任职</div>
                    </div>
                    <div className="rounded-lg border bg-destructive/10 p-3 text-center">
                      <div className="text-lg font-semibold text-destructive">{vo.vacantCount}</div>
                      <div className="text-xs text-muted-foreground">空缺</div>
                    </div>

                    <div className="lg:col-span-3">
                      <h4 className="mb-2 text-sm font-semibold text-foreground">岗位任职情况</h4>
                      {vo.posts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">该部门暂无已配置岗位</p>
                      ) : (
                        <ul className="space-y-2">
                          {vo.posts.map((p) => (
                            <li
                              key={p.postId}
                              className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
                            >
                              <span className="min-w-0 font-medium">
                                {p.postName}
                                {p.postType ? (
                                  <span className="ml-1 text-xs font-normal text-muted-foreground">·{p.postType}</span>
                                ) : null}
                              </span>
                              {p.holders.length > 0 ? (
                                <span className="flex flex-wrap justify-end gap-1">
                                  {p.holders.map((h) => (
                                    <span
                                      key={h.id}
                                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                                    >
                                      <Users className="h-3 w-3" />
                                      {h.name}
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

                    <div className="lg:col-span-3">
                      <h4 className="mb-2 text-sm font-semibold text-foreground">
                        部门任职人员（{vo.employees.length}）
                      </h4>
                      {vo.employees.length === 0 ? (
                        <p className="text-sm text-muted-foreground">暂无任职人员</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {vo.employees.map((e) => (
                            <span
                              key={e.id}
                              className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-sm"
                            >
                              <Users className="h-3.5 w-3.5 text-muted-foreground" />
                              {e.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </td>
            </tr>
          ) : null}
        </Fragment>,
      );

      // 规则 2.1 / G4：仅当本节点展开时才递归渲染其子树（默认全折叠）。
      if (expanded) {
        if (pierceLoading) {
          elements.push(
            <tr key={`${row.id}::pierce-loading`} className="border-b border-border/50 bg-muted/10">
              <td
                colSpan={columns.length}
                className="px-3 py-2 text-xs text-muted-foreground"
                style={{ paddingLeft: 12 + (depth + 1) * 16 }}
              >
                加载穿透中…
              </td>
            </tr>,
          );
        } else if (childRows.length > 0) {
          elements.push(...renderNodes(childRows, depth + 1));
        } else if (linkedOrgId) {
          elements.push(
            <tr key={`${row.id}::pierce-empty`} className="border-b border-border/50 bg-muted/10">
              <td
                colSpan={columns.length}
                className="px-3 py-2 text-xs text-muted-foreground"
                style={{ paddingLeft: 12 + (depth + 1) * 16 }}
              >
                该组织暂无部门数据
              </td>
            </tr>,
          );
        }
      }
    }
    return elements;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="部门管理"
        description="组织内部门树：箭头展开/折叠子部门（默认全折叠）；链接组织的部门点箭头 inline 展开其下级部门（只读）；「查看任职详情」查看岗位编制。"
        breadcrumbs={buildAppBreadcrumbs({
          app: 'system',
          group: '组织架构',
          title: '部门管理',
        })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {headerExtra ? <>{headerExtra}</> : null}
            {hasCustom ? (
              <Button type="button" variant="outline" size="sm" onClick={resetColWidths}>
                重置列宽
              </Button>
            ) : null}
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
            <PermissionGate permission="system:dept:add">
              <Button size="sm" onClick={() => openCreate(treeRows[0]?.rawId ?? '0')}>
                <Plus className="h-4 w-4" />
                新增部门
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
        <table className="w-full border-separate border-spacing-0 bg-table-surface text-left text-sm" style={tableStyle}>
          <thead className="bg-table-header text-muted-foreground">
            <tr>
              {columns.map((col, ci) => {
                return (
                  <th
                    key={col.key}
                    style={{ width: widthOf(col.key) }}
                    className={cn(
                      'sticky top-0 z-10 whitespace-nowrap bg-table-header px-0 py-0 text-[13px] font-bold',
                      ci > 0 && 'border-l border-border/60',
                    )}
                  >
                    <span className={cn('block font-bold text-muted-foreground', thPad)}>{col.label}</span>
                    {!col.locked ? (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        onMouseDown={(e) => startResize(e, col.key)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30"
                        title={`拖动调整${col.label}列宽`}
                      />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : treeRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">
                  暂无部门数据
                </td>
              </tr>
            ) : (
              renderNodes(treeRows, 0)
            )}
          </tbody>
        </table>
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
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>部门类型 *</label>
              <DeptTypeTreeSelect
                value={form.deptTypeId || ''}
                onChange={(v) => setForm((f) => ({ ...f, deptTypeId: v == null ? '' : String(v) }))}
                selectMode="leaf"
              />
            </div>
            <div className={SHEET_FORM_FIELD}>
              <label className={fieldLabel}>编制数</label>
              <Input
                type="number"
                min={0}
                value={form.establishmentCount}
                onChange={(e) => setForm((f) => ({ ...f, establishmentCount: e.target.value }))}
              />
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
    </div>
  );
}
