/**
 * 技能池页（UI#1 #7，路径 `/agent/skills`，V19 菜单 `92037`）。
 *
 * <p>覆盖 §4.3 #1 列表 / #2 统计 / #4 创建 / #5 编辑 / #6 删除 / #7 启用 / #8 停用 / #9 重建索引。
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
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PermissionGate } from '@/components/auth/permission-gate';
import { StatCard } from '@/components/common/stat-card';
import { SortIndicator } from '@/components/common/sort-indicator';
import { useClientSort } from '@/components/common/use-client-sort';
import { useColumnWidths, type ResizableColumn } from '@/components/common/use-column-widths';
import { RESET_COL_WIDTH_OVERLAY_CLASS, ResetColWidthButton } from '@/components/common/header-action-buttons';
import { AgentPageShell, AgentContentState } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { AgentStatusBadge } from '../components/agent-status-badge';
import { AgentSkillFormDialog } from './agent-skill-form-dialog';
import { AgentSkillDetailDrawer } from './agent-skill-detail-drawer';
import {
  deleteSkill,
  disableSkill,
  enableSkill,
  getSkillStats,
  listSkills,
  reindexSkills,
} from '../api/agent-ops-api';
import { useAgentStore } from '../stores/use-agent-store';
import { agentErrorMessage, formatTime } from '../types';
import type { Skill, SkillStats, SkillStatus } from '../types';

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
  const [stats, setStats] = useState<SkillStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const skillFilter = useAgentStore((s) => s.skillFilter);
  const setSkillFilter = useAgentStore((s) => s.setSkillFilter);
  const resetSkillFilter = useAgentStore((s) => s.resetSkillFilter);

  const { widthOf, startResize, hasCustom, reset, tableStyle } = useColumnWidths(
    SKILL_COLS,
    'mis-agent-skill-table-widths',
  );

  /**
   * 拉列表 + 统计。
   *
   * <p>统计接口失败**不阻断**列表渲染：#2 只是四张卡片，
   * 让它把整页拖进 error 态属于因小失大。失败时卡片显示 `-`。
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, stat] = await Promise.allSettled([listSkills(), getSkillStats()]);
      if (list.status === 'rejected') throw list.reason;
      setSkills(list.value);
      setStats(stat.status === 'fulfilled' ? stat.value : null);
    } catch (e) {
      setError(agentErrorMessage(e, '获取技能列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 分类下拉选项：从列表现有数据归纳，避免再开一个字典接口。 */
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of skills) if (s.category) set.add(s.category);
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [skills]);

  const filtered = useMemo(() => {
    const kw = skillFilter.keyword.trim().toLowerCase();
    return skills.filter((s) => {
      if (skillFilter.status !== 'all' && s.status !== skillFilter.status) return false;
      if (skillFilter.category && s.category !== skillFilter.category) return false;
      if (!kw) return true;
      return (
        s.name.toLowerCase().includes(kw) ||
        s.skill_id.toLowerCase().includes(kw) ||
        s.description.toLowerCase().includes(kw)
      );
    });
  }, [skills, skillFilter]);

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
      description="可用技能的注册与生命周期管理。"
      permission="agent:skill:list"
      actions={headerActions}
    >
      {/*
        不把 empty 交给 AgentPageShell：空池时仍需露出统计卡与页头「重建技能索引」，
        否则整页被空态吞掉时观感像「没有按钮」。
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="技能总数" value={stats?.total ?? skills.length} icon={Sparkles} />
          <StatCard
            label="已启用"
            value={stats?.active ?? skills.filter((s) => s.status === 'active').length}
            icon={CheckCircle2}
          />
          <StatCard
            label="已停用"
            value={stats?.disabled ?? skills.filter((s) => s.status === 'disabled').length}
            icon={CirclePause}
          />
          <StatCard
            label="最近重建索引"
            value={stats ? formatTime(stats.last_reindex_at) : '-'}
            icon={RotateCcw}
          />
        </div>

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
          <div className="w-44">
            <label className="mb-[0.4rem] block text-xs text-muted-foreground">分类</label>
            <select
              className={selectClass}
              value={skillFilter.category}
              onChange={(e) => setSkillFilter({ category: e.target.value })}
            >
              <option value="">全部分类</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
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
            <thead className="border-b-2 border-foreground/20 bg-table-header text-muted-foreground">
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

      <AgentSkillFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        skill={editing}
        onSaved={() => void load()}
      />

      <AgentSkillDetailDrawer
        skillId={detailSkillId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />

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
