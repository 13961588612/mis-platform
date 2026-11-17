/**
 * 技能池页（UI#1 #7，路径 `/agent/skills`，V19 菜单 `92037`）。
 *
 * <p>覆盖 §4.3 #1 列表 / #4 创建 / #5 编辑 / #6 删除 / #7 启用 / #8 停用 / #9 重建索引。
 * 页头紧凑：隐藏大标题与统计卡，操作按钮与面包屑同行。
 *
 * <p>**为什么用原生 `<table>` + `<select>`**：`components/ui/` 只有 13 个原语，
 * 没有 table / select / checkbox（impl-plan §2.1 零新框架，禁 `shadcn add`）。
 * 列宽拖拽与表头排序复用 `components/common` 的 `useColumnWidths` / `useClientSort`，
 * 与 `features/kb` 的列表页保持同一手感。
 *
 * <p>**数据流**：`useState + useCallback load() + useEffect + toast.error`，
 * 不引 react-query —— 本页无轮询需求，全仓 `features/kb` 也是这个模式（§10.1）。
 *
 * <p>导出名 `AgentSkillPoolPage`，由 `pages.ts` 以 `as AgentSkillsPage` 桥接。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CirclePause,
  Eye,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PermissionGate } from '@/components/auth/permission-gate';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { RESET_COL_WIDTH_OVERLAY_CLASS, ResetColWidthButton } from '@/components/common/header-action-buttons';
import { AgentPageShell, AgentContentState } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { AgentStatusBadge } from '../components/agent-status-badge';
import { AgentSkillFormDialog } from './agent-skill-form-dialog';
import { AgentSkillDetailDrawer } from './agent-skill-detail-drawer';
import { AgentSkillGrantDrawer } from './agent-skill-grant-drawer';
import {
  AgentSkillCategoryTree,
  SKILL_CAT_UNCAT,
} from './agent-skill-category-tree';
import {
  flattenSkillCategories,
  skillCatDescendantIds,
  skillCatPathById,
  type SkillCatNode,
} from './skill-category-tree';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createSkillCategory,
  deleteSkill,
  deleteSkillCategory,
  disableSkill,
  enableSkill,
  listSkillCategories,
  listSkills,
  reindexSkills,
  updateSkillCategory,
} from '../api/agent-ops-api';
import { useAgentStore } from '../stores/use-agent-store';
import { agentErrorMessage, formatTime } from '../types';
import type { Skill, SkillStatus } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const SKILL_COLS: ResizableColumn[] = [
  { key: 'name', label: '名称' },
  // key 必须与 Skill 字段同名：排序取值走 `row[key as keyof Skill]`
  { key: 'skill_id', label: '技能 ID' },
  { key: 'status', label: '状态' },
  { key: 'category', label: '分类' },
  { key: 'tags', label: '标签' },
  { key: 'updated_at', label: '更新时间' },
  { key: '__ops__', label: '操作', locked: true },
];

/**
 * 待确认的危险 / 批量操作。
 *
 * <p>做成可辨识联合而不是四个布尔 state：四个布尔能表达"同时删除又启用"这种
 * 非法组合，联合类型让非法态在类型层面就不存在。
 */
type PendingAction =
  | { kind: 'delete'; skill: Skill }
  | { kind: 'enable'; skill: Skill }
  | { kind: 'disable'; skill: Skill }
  | { kind: 'reindex' };

export function AgentSkillPoolPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [grantSkill, setGrantSkill] = useState<Skill | null>(null);
  const [catTree, setCatTree] = useState<SkillCatNode[]>([]);
  const [catBinds, setCatBinds] = useState<Record<string, number>>({});
  const [catDialog, setCatDialog] = useState<
    | { kind: 'create'; parentId: number }
    | { kind: 'rename'; node: SkillCatNode }
    | { kind: 'delete'; node: SkillCatNode }
    | null
  >(null);
  const [catName, setCatName] = useState('');
  const [catBusy, setCatBusy] = useState(false);

  const skillFilter = useAgentStore((s) => s.skillFilter);
  const setSkillFilter = useAgentStore((s) => s.setSkillFilter);
  const resetSkillFilter = useAgentStore((s) => s.resetSkillFilter);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    SKILL_COLS,
    'mis-agent-skill-table-widths',
  );

  /** 拉列表 + 分类树（统计卡已隐藏，不再请求 getSkillStats）。 */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, cats] = await Promise.allSettled([listSkills(), listSkillCategories()]);
      if (list.status === 'rejected') throw list.reason;
      setSkills(list.value);
      if (cats.status === 'fulfilled') {
        setCatTree(cats.value.tree);
        setCatBinds(cats.value.binds);
      } else {
        toast.error(agentErrorMessage(cats.reason, '获取技能分类失败'));
      }
    } catch (e) {
      setError(agentErrorMessage(e, '获取技能列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const catPathById = useMemo(() => skillCatPathById(catTree), [catTree]);
  const catFlat = useMemo(() => flattenSkillCategories(catTree), [catTree]);

  const skillsWithCat = useMemo(
    () =>
      skills.map((s) => {
        const cid = catBinds[s.skill_id];
        return {
          ...s,
          category_id: cid ?? null,
          category: cid != null ? (catPathById.get(cid) ?? s.category) : undefined,
        };
      }),
    [skills, catBinds, catPathById],
  );

  const categoryCounts = useMemo(() => {
    const map: Record<number, number> = {};
    for (const n of catFlat) {
      const ids = skillCatDescendantIds(catTree, n.id);
      map[n.id] = skillsWithCat.filter(
        (s) => s.category_id != null && ids.has(s.category_id),
      ).length;
    }
    return map;
  }, [skillsWithCat, catFlat, catTree]);

  const uncategorizedCount = useMemo(
    () => skillsWithCat.filter((s) => s.category_id == null).length,
    [skillsWithCat],
  );

  const filtered = useMemo(() => {
    const kw = skillFilter.keyword.trim().toLowerCase();
    const cat = skillFilter.category;
    return skillsWithCat.filter((s) => {
      if (skillFilter.status !== 'all' && s.status !== skillFilter.status) return false;
      if (cat === SKILL_CAT_UNCAT) {
        if (s.category_id != null) return false;
      } else if (cat) {
        const selectedId = Number(cat);
        if (Number.isFinite(selectedId)) {
          const ids = skillCatDescendantIds(catTree, selectedId);
          if (s.category_id == null || !ids.has(s.category_id)) return false;
        }
      }
      if (!kw) return true;
      return (
        s.name.toLowerCase().includes(kw) ||
        s.skill_id.toLowerCase().includes(kw) ||
        s.description.toLowerCase().includes(kw)
      );
    });
  }, [skillsWithCat, skillFilter, catTree]);

  const getSortValue = useCallback((row: Skill, key: string) => {
    if (key === 'tags') return (row.tags ?? []).join(',');
    return row[key as keyof Skill] as unknown;
  }, []);
  const { sorted, sortKey, sortDir, toggleSort } = useClientSort(filtered, getSortValue);

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(skill: Skill): void {
    setEditing(skill);
    setFormOpen(true);
  }

  /** 统一执行待确认动作：成功后关弹窗 + 刷新；失败保持弹窗打开让用户看清 toast。 */
  async function runPending(): Promise<void> {
    if (!pending) return;
    try {
      switch (pending.kind) {
        case 'delete':
          await deleteSkill(pending.skill.skill_id);
          toast.success(`技能「${pending.skill.name}」已删除`);
          break;
        case 'enable':
          await enableSkill(pending.skill.skill_id);
          toast.success(`技能「${pending.skill.name}」已启用`);
          break;
        case 'disable':
          await disableSkill(pending.skill.skill_id);
          toast.success(`技能「${pending.skill.name}」已停用`);
          break;
        case 'reindex':
          await reindexSkills();
          toast.success('已触发技能索引重建');
          break;
      }
      setPending(null);
      await load();
    } catch (e) {
      toast.error(agentErrorMessage(e, '操作失败'));
    }
  }

  const confirmProps = useMemo(() => {
    switch (pending?.kind) {
      case 'delete':
        return {
          title: '删除技能',
          danger: true,
          confirmText: '删除',
          confirmKeyword: pending.skill.skill_id,
          description: (
            <>
              <p>
                将删除技能「{pending.skill.name}」（
                <span className="font-mono">{pending.skill.skill_id}</span>）。
              </p>
              <p>
                已绑定该技能的 Agent 会失去这项能力；其执行码
                <span className="font-mono"> ai:skill:{pending.skill.skill_id}:run </span>
                的既有授权也将失效。此操作不可撤销。
              </p>
            </>
          ),
        };
      case 'disable':
        return {
          title: '停用技能',
          danger: true,
          confirmText: '停用',
          confirmKeyword: undefined,
          description: (
            <p>
              停用后「{pending.skill.name}」将从所有 Agent 的可用技能中移除，
              在途请求不受影响。可随时重新启用。
            </p>
          ),
        };
      case 'enable':
        return {
          title: '启用技能',
          danger: false,
          confirmText: '启用',
          confirmKeyword: undefined,
          description: <p>启用后「{pending.skill.name}」可被绑定到 Agent 并参与调度。</p>,
        };
      case 'reindex':
        return {
          title: '重建技能索引',
          danger: false,
          confirmText: '开始重建',
          confirmKeyword: undefined,
          description: (
            <p>
              将全量扫描技能目录并重建检索索引。期间技能检索结果可能短暂不完整，
              不影响已绑定技能的执行。
            </p>
          ),
        };
      default:
        return { title: '', danger: false, confirmText: '确认', confirmKeyword: undefined, description: null };
    }
  }, [pending]);

  const headerActions = (
    <>
      <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        刷新
      </Button>
      <PermissionGate permission="agent:skill:reindex">
        <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'reindex' })}>
          <RotateCcw className="h-4 w-4" />
          重建技能索引
        </Button>
      </PermissionGate>
      <PermissionGate permission="agent:skill:manage">
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          新建技能
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <AgentPageShell
      title="技能池"
      permission="agent:skill:list"
      actions={headerActions}
      hideTitle
    >
      {/*
        不把 empty 交给 AgentPageShell：空池时仍需露出页头「重建技能索引 / 新建技能」，
        否则整页被空态吞掉时观感像「没有按钮」。
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <aside className="flex w-64 shrink-0 flex-col rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-2 py-2">
            <span className="text-sm font-medium">技能分类</span>
            <PermissionGate permission="agent:skill:manage">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCatName('');
                  setCatDialog({ kind: 'create', parentId: 0 });
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </PermissionGate>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <AgentSkillCategoryTree
              tree={catTree}
              counts={categoryCounts}
              uncategorizedCount={uncategorizedCount}
              totalCount={skills.length}
              selected={skillFilter.category}
              onSelect={(s) => setSkillFilter({ category: s })}
              onAddChild={(parent) => {
                setCatName('');
                setCatDialog({ kind: 'create', parentId: parent.id });
              }}
              onEdit={(node) => {
                setCatName(node.name);
                setCatDialog({ kind: 'rename', node });
              }}
              onDelete={(node) => setCatDialog({ kind: 'delete', node })}
            />
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <div className="min-w-[14rem] flex-1">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">关键字</label>
            <Input
              placeholder="搜索名称 / ID / 描述"
              value={skillFilter.keyword}
              onChange={(e) => setSkillFilter({ keyword: e.target.value })}
            />
          </div>
          <div className="w-40">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">状态</label>
            <select
              className={selectClass}
              value={skillFilter.status}
              onChange={(e) =>
                setSkillFilter({ status: e.target.value as SkillStatus | 'all' })
              }
            >
              <option value="all">全部状态</option>
              <option value="active">已启用</option>
              <option value="disabled">已停用</option>
            </select>
          </div>
          <Button size="sm" variant="secondary" onClick={resetSkillFilter}>
            重置
          </Button>
          <span className="ml-auto pb-1.5 text-xs text-muted-foreground">
            共 {filtered.length} / {skills.length} 条
          </span>
        </div>

        <AgentContentState
          loading={loading && skills.length === 0}
          error={error}
          onRetry={() => void load()}
          empty={!loading && !error && skills.length === 0}
          emptyText="技能池为空"
          emptyHint="可点「重建技能索引」从技能目录同步，或「新建技能」手工注册。"
        >

        <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-table-surface">
          {hasCustom ? (
            <ResetColWidthButton onClick={reset} className={RESET_COL_WIDTH_OVERLAY_CLASS} />
          ) : null}
          <table
            className="border-separate border-spacing-0 bg-table-surface text-left text-sm"
            style={tableStyle}
          >
            <thead className="sticky top-0 z-10 border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
              <tr>
                {SKILL_COLS.map((c, ci) => {
                  const active = sortKey === c.key;
                  return (
                    <th
                      key={c.key}
                      style={{ width: widthOf(c.key) }}
                      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={cn(
                        'relative overflow-hidden whitespace-nowrap px-0 py-0 font-bold',
                        ci > 0 && 'border-l border-border/60',
                        c.locked && 'text-right',
                      )}
                    >
                      {c.locked ? (
                        <span className="block px-3 py-2">{c.label}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={cn(
                            'flex w-full items-center gap-1 px-3 py-2 pr-5 text-left font-bold',
                            active
                              ? 'text-foreground'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {c.label}
                          <SortIndicator state={active ? sortDir : 'none'} />
                        </button>
                      )}
                      {!c.locked ? (
                        <span
                          role="separator"
                          aria-label={`调整${c.label}列宽`}
                          onMouseDown={(e) => startResize(e, c.key)}
                          className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30"
                        />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={SKILL_COLS.length}
                    className="px-3 py-10 text-center text-muted-foreground"
                  >
                    没有匹配当前筛选条件的技能
                  </td>
                </tr>
              ) : (
                sorted.map((skill) => (
                  <tr
                    key={skill.skill_id}
                    className="border-b border-border/50 bg-table-row last:border-0 even:bg-table-stripe hover:bg-table-hover"
                  >
                    <td className="px-3 py-2">
                      <div className="truncate font-medium" title={skill.name}>
                        {skill.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground" title={skill.description}>
                        {skill.description}
                      </div>
                    </td>
                    <td className="truncate px-3 py-2 font-mono text-xs" title={skill.skill_id}>
                      {skill.skill_id}
                    </td>
                    <td className="px-3 py-2">
                      <AgentStatusBadge kind="skillStatus" value={skill.status} />
                    </td>
                    <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                      {skill.category ?? '-'}
                    </td>
                    <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                      {(skill.tags ?? []).length > 0 ? (skill.tags ?? []).join('、') : '-'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatTime(skill.updated_at)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <PermissionGate permission="agent:skill:list">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => {
                              setDetailSkillId(skill.skill_id);
                              setDetailOpen(true);
                            }}
                          >
                            <Eye className="h-3 w-3" />
                            详情
                          </button>
                        </PermissionGate>
                        <PermissionGate permission="agent:skill:grant">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => setGrantSkill(skill)}
                          >
                            <KeyRound className="h-3 w-3" />
                            设置权限
                          </button>
                        </PermissionGate>
                        <PermissionGate permission="agent:skill:manage">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-primary hover:bg-primary/10"
                            onClick={() => openEdit(skill)}
                          >
                            <Pencil className="h-3 w-3" />
                            编辑
                          </button>
                        </PermissionGate>
                        <PermissionGate permission="agent:skill:manage">
                          {skill.status === 'active' ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-warning hover:bg-warning/10"
                              onClick={() => setPending({ kind: 'disable', skill })}
                            >
                              <CirclePause className="h-3 w-3" />
                              停用
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-success hover:bg-success/10"
                              onClick={() => setPending({ kind: 'enable', skill })}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              启用
                            </button>
                          )}
                        </PermissionGate>
                        <PermissionGate permission="agent:skill:manage">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10"
                            onClick={() => setPending({ kind: 'delete', skill })}
                          >
                            <Trash2 className="h-3 w-3" />
                            删除
                          </button>
                        </PermissionGate>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </AgentContentState>
        </div>
        </div>
      </div>

      <AgentSkillFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        skill={editing}
        categoryTree={catTree}
        defaultCategoryId={
          Number.isFinite(Number(skillFilter.category)) && skillFilter.category
            ? Number(skillFilter.category)
            : null
        }
        onSaved={() => void load()}
      />

      <AgentSkillDetailDrawer
        skillId={detailSkillId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        categoryTree={catTree}
        boundCategoryId={detailSkillId ? (catBinds[detailSkillId] ?? null) : null}
        onUpdated={() => void load()}
        onOpenGrants={(skill) => setGrantSkill(skill)}
      />

      <AgentSkillGrantDrawer
        skillId={grantSkill?.skill_id ?? null}
        skillName={grantSkill?.name}
        open={grantSkill != null}
        onClose={() => setGrantSkill(null)}
      />

      <Dialog
        open={catDialog != null}
        onOpenChange={(v) => {
          if (!v) setCatDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {catDialog?.kind === 'create'
                ? catDialog.parentId
                  ? '新建子分类'
                  : '新建分类'
                : catDialog?.kind === 'rename'
                  ? '重命名分类'
                  : '删除分类'}
            </DialogTitle>
            <DialogDescription>
              {catDialog?.kind === 'delete'
                ? '有子分类或仍绑定技能时无法删除，请先调整。'
                : '分类存在独立表中，与 SKILL.md 的 category 字段无关。'}
            </DialogDescription>
          </DialogHeader>
          {catDialog?.kind === 'delete' ? (
            <p className="text-sm">
              确认删除分类「{catDialog.node.name}」？当前该节点（含子级）有{' '}
              {categoryCounts[catDialog.node.id] ?? 0} 个技能。
            </p>
          ) : (
            <div className="space-y-2">
              {catDialog?.kind === 'create' && catDialog.parentId ? (
                <p className="text-xs text-muted-foreground">
                  上级：{catPathById.get(catDialog.parentId) ?? catDialog.parentId}
                </p>
              ) : null}
              <Input
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="分类名称"
                maxLength={128}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCatDialog(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant={catDialog?.kind === 'delete' ? 'destructive' : 'default'}
              disabled={catBusy}
              onClick={() => {
                void (async () => {
                  if (!catDialog) return;
                  const next = catName.trim();
                  setCatBusy(true);
                  try {
                    if (catDialog.kind === 'create') {
                      if (!next) {
                        toast.error('请填写分类名称');
                        return;
                      }
                      const created = await createSkillCategory({
                        parent_id: catDialog.parentId || 0,
                        name: next,
                      });
                      setSkillFilter({ category: String(created.id) });
                      toast.success('已创建分类');
                      setCatDialog(null);
                      await load();
                    } else if (catDialog.kind === 'rename') {
                      if (!next) {
                        toast.error('请填写分类名称');
                        return;
                      }
                      await updateSkillCategory(catDialog.node.id, {
                        parent_id: catDialog.node.parent_id,
                        name: next,
                        sort_order: catDialog.node.sort_order,
                      });
                      toast.success('分类已更新');
                      setCatDialog(null);
                      await load();
                    } else {
                      await deleteSkillCategory(catDialog.node.id);
                      if (skillFilter.category === String(catDialog.node.id)) {
                        setSkillFilter({ category: SKILL_CAT_UNCAT });
                      }
                      toast.success('分类已删除');
                      setCatDialog(null);
                      await load();
                    }
                  } catch (e) {
                    toast.error(agentErrorMessage(e, '分类操作失败'));
                  } finally {
                    setCatBusy(false);
                  }
                })();
              }}
            >
              {catBusy ? '处理中…' : catDialog?.kind === 'delete' ? '删除' : '确定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AgentConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={confirmProps.title}
        description={confirmProps.description}
        danger={confirmProps.danger}
        confirmText={confirmProps.confirmText}
        confirmKeyword={confirmProps.confirmKeyword}
        onConfirm={runPending}
      />
    </AgentPageShell>
  );
}
