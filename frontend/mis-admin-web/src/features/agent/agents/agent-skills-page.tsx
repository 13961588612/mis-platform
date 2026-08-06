/**
 * Agent 可用技能绑定（UI#5，路径 `/agent/agents/:id/skills`，V19 菜单 `92043`）。
 *
 * <p>覆盖 §4.3 #1 技能池（**已就绪**）/ #20 读取绑定（后端 T04 未实现，返回 501）
 * / #21 保存绑定（同 pending）。
 *
 * <p>**本组件是详情壳的 Tab 内容，不是独立页面**：`agent-detail-route.tsx` 已经套了
 * 一层 `AgentPageShell`（含 PageHeader + 面包屑 + 页面级 `agent:agent:skills`）。
 * 这里再套一层会出现两个页头，故三态改用 `AgentContentState`（无页头版）。
 *
 * <p>**501 容错的关键设计：左右两侧的三态相互独立**。
 * 技能池（#1）后端已就绪，绑定（#20）还没有 —— 如果把两者塞进同一个 error 态，
 * 后端补齐前这个 Tab 会整块变成红卡，运营连"池子里有哪些技能"都看不到。
 * 因此左池照常渲染真实数据，只有右侧绑定区走 error + 重试。
 *
 * <p>**只有 `status==='active'` 的技能可勾选**（impl-plan §4.6 / ui.md §3）：
 * 已下线技能置灰且不可勾。但**已绑定却已下线**的技能仍会显示在右侧并标注，
 * 否则运营会以为绑定丢了 —— 它其实还在配置里，只是池子里被停用了。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, RefreshCw, Save, Search, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/common/submit-button';
import { PermissionGate } from '@/components/auth/permission-gate';
import { AgentContentState } from '../components/agent-page-shell';
import { AgentStatusBadge } from '../components/agent-status-badge';
import { getAgentSkills, listSkills, saveAgentSkills } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { AgentSkillBinding, Skill } from '../types';

export interface AgentSkillsPageProps {
  agentId: string;
}

/** 绑定态的本地表示：`skill_id → enabled`。用 Map 是为了 O(1) 勾选切换。 */
type BindingMap = Map<string, boolean>;

/** 把后端返回的绑定数组折成 Map（忽略重复项，后者覆盖前者）。 */
function toBindingMap(list: AgentSkillBinding[]): BindingMap {
  const map: BindingMap = new Map();
  for (const b of list) map.set(b.skill_id, b.enabled);
  return map;
}

/** Map → 提交用的数组，顺序按 skill_id 排序以便后端 diff 稳定。 */
function toBindingList(map: BindingMap, poolStatus: Map<string, Skill['status']>): AgentSkillBinding[] {
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([skill_id, enabled]) => ({
      skill_id,
      enabled,
      skill_status: poolStatus.get(skill_id),
    }));
}

/** 两个绑定 Map 是否等价（用于「未改动则禁用保存」）。 */
function sameBindings(a: BindingMap, b: BindingMap): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export function AgentSkillsPage({ agentId }: AgentSkillsPageProps) {
  // 左：技能池（#1，ready）
  const [pool, setPool] = useState<Skill[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

  // 右：绑定（#20/#21，pending → 501）
  const [bindings, setBindings] = useState<BindingMap>(() => new Map());
  const [baseline, setBaseline] = useState<BindingMap>(() => new Map());
  const [bindLoading, setBindLoading] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPool = useCallback(async () => {
    setPoolLoading(true);
    setPoolError(null);
    try {
      setPool(await listSkills());
    } catch (e) {
      setPoolError(agentErrorMessage(e, '获取技能池失败'));
    } finally {
      setPoolLoading(false);
    }
  }, []);

  const loadBindings = useCallback(async () => {
    if (!agentId) return;
    setBindLoading(true);
    setBindError(null);
    try {
      const list = await getAgentSkills(agentId);
      const map = toBindingMap(list);
      setBindings(map);
      setBaseline(new Map(map));
    } catch (e) {
      setBindError(agentErrorMessage(e, '获取 Agent 技能绑定失败'));
    } finally {
      setBindLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadPool();
  }, [loadPool]);

  useEffect(() => {
    void loadBindings();
  }, [loadBindings]);

  /** skill_id → 池内状态，用于置灰与提交时回填 `skill_status`。 */
  const poolStatus = useMemo(() => {
    const m = new Map<string, Skill['status']>();
    for (const s of pool) m.set(s.skill_id, s.status);
    return m;
  }, [pool]);

  const poolById = useMemo(() => {
    const m = new Map<string, Skill>();
    for (const s of pool) m.set(s.skill_id, s);
    return m;
  }, [pool]);

  const filteredPool = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return pool;
    return pool.filter(
      (s) =>
        s.name.toLowerCase().includes(kw) ||
        s.skill_id.toLowerCase().includes(kw) ||
        s.description.toLowerCase().includes(kw),
    );
  }, [pool, keyword]);

  /** 绑定区不可用时禁止编辑：否则用户改了半天，保存又是 501。 */
  const editable = bindError === null && !bindLoading;
  const dirty = !sameBindings(bindings, baseline);

  function toggleBind(skill: Skill): void {
    if (!editable) return;
    // 已下线技能不允许新增绑定；已绑定的允许取消（这是"清理"，必须放行）
    if (skill.status !== 'active' && !bindings.has(skill.skill_id)) return;
    setBindings((prev) => {
      const next = new Map(prev);
      if (next.has(skill.skill_id)) next.delete(skill.skill_id);
      else next.set(skill.skill_id, true);
      return next;
    });
  }

  function toggleEnabled(skillId: string): void {
    if (!editable) return;
    setBindings((prev) => {
      const next = new Map(prev);
      const cur = next.get(skillId);
      if (cur === undefined) return prev;
      next.set(skillId, !cur);
      return next;
    });
  }

  async function onSave(): Promise<void> {
    if (!agentId || saving) return;
    setSaving(true);
    try {
      const saved = await saveAgentSkills(agentId, toBindingList(bindings, poolStatus));
      const map = toBindingMap(saved);
      setBindings(map);
      setBaseline(new Map(map));
      toast.success('已保存技能绑定');
    } catch (e) {
      toast.error(agentErrorMessage(e, '保存 Agent 技能绑定失败'));
    } finally {
      setSaving(false);
    }
  }

  /** 右侧列表：以绑定 Map 为准，池内缺失的条目也要显示（可能技能已被删除）。 */
  const boundRows = useMemo(
    () =>
      [...bindings.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([skillId, enabled]) => ({
          skillId,
          enabled,
          skill: poolById.get(skillId) ?? null,
        })),
    [bindings, poolById],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
        <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
        <p className="leading-relaxed">
          绑定只决定该 Agent <span className="font-medium text-foreground">能否看到</span>这项技能。
          调用者最终能否执行，还要看其角色是否持有执行码
          <span className="font-mono"> ai:skill:{'{skill_id}'}:run</span>
          （在「技能权限」页授予）。两者是<span className="font-medium text-foreground">与</span>
          的关系，缺一不可。
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        {/* ---------------- 左：技能池（#1 ready） ---------------- */}
        <div className="flex min-h-0 flex-col rounded-lg border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <span className="text-sm font-medium">技能池</span>
            <span className="text-xs text-muted-foreground">共 {pool.length} 项</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => void loadPool()}
              disabled={poolLoading}
            >
              <RefreshCw className={cn('h-4 w-4', poolLoading && 'animate-spin')} />
              刷新
            </Button>
          </div>
          <div className="border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="搜索技能名称 / ID / 描述"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <AgentContentState
              loading={poolLoading && pool.length === 0}
              error={poolError}
              onRetry={() => void loadPool()}
              empty={!poolLoading && !poolError && pool.length === 0}
              emptyText="技能池为空"
              emptyHint="请先到「技能池」页注册技能，或执行「重建索引」从技能目录同步。"
            >
              {filteredPool.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的技能</p>
              ) : (
                <ul className="divide-y">
                  {filteredPool.map((skill) => {
                    const bound = bindings.has(skill.skill_id);
                    const offline = skill.status !== 'active';
                    // 已下线且未绑定 ⇒ 不可勾（不能新增下线技能的绑定）
                    const lockAdd = offline && !bound;
                    const disabled = !editable || lockAdd;
                    return (
                      <li key={skill.skill_id}>
                        <label
                          className={cn(
                            'flex items-start gap-2 px-3 py-2 text-sm',
                            disabled
                              ? 'cursor-not-allowed opacity-55'
                              : 'cursor-pointer hover:bg-accent/50',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed"
                            checked={bound}
                            disabled={disabled}
                            onChange={() => toggleBind(skill)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate font-medium">{skill.name}</span>
                              <AgentStatusBadge kind="skillStatus" value={skill.status} />
                            </span>
                            <span className="block truncate font-mono text-xs text-muted-foreground">
                              {skill.skill_id}
                            </span>
                            {skill.description ? (
                              <span
                                className="block truncate text-xs text-muted-foreground"
                                title={skill.description}
                              >
                                {skill.description}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </AgentContentState>
          </div>
        </div>

        {/* ---------------- 右：已绑定（#20/#21 pending） ---------------- */}
        <div className="flex min-h-0 flex-col rounded-lg border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <span className="text-sm font-medium">已绑定技能</span>
            <span className="text-xs text-muted-foreground">共 {bindings.size} 项</span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void loadBindings()}
                disabled={bindLoading}
              >
                <RefreshCw className={cn('h-4 w-4', bindLoading && 'animate-spin')} />
                刷新
              </Button>
              <PermissionGate permission="agent:agent:skills:save">
                <SubmitButton
                  size="sm"
                  loading={saving}
                  disabled={!editable || !dirty}
                  onClick={() => void onSave()}
                >
                  <Save className="h-4 w-4" />
                  保存绑定
                </SubmitButton>
              </PermissionGate>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <AgentContentState
              loading={bindLoading && bindings.size === 0}
              error={bindError}
              onRetry={() => void loadBindings()}
              empty={!bindLoading && !bindError && bindings.size === 0}
              emptyText="该 Agent 尚未绑定任何技能"
              emptyHint="在左侧技能池勾选后点击「保存绑定」。"
            >
              <ul className="divide-y">
                {boundRows.map((row) => {
                  const offline = row.skill !== null && row.skill.status !== 'active';
                  const missing = row.skill === null;
                  return (
                    <li key={row.skillId} className="px-3 py-2 text-sm">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed"
                          checked={row.enabled}
                          disabled={!editable}
                          title="是否启用该绑定"
                          onChange={() => toggleEnabled(row.skillId)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium">
                              {row.skill?.name ?? row.skillId}
                            </span>
                            {row.enabled ? null : (
                              <span className="rounded-md border px-1.5 py-0.5 text-[0.7rem] text-muted-foreground">
                                已停用
                              </span>
                            )}
                          </div>
                          <div className="truncate font-mono text-xs text-muted-foreground">
                            {row.skillId}
                          </div>
                          {/* 池内已下线 / 已删除必须显式提示，否则运营会以为绑定丢失 */}
                          {offline ? (
                            <p className="mt-1 flex items-start gap-1 text-xs text-warning">
                              <TriangleAlert className="mt-[0.1rem] h-3 w-3 shrink-0" />
                              该技能在技能池中已停用，绑定保留但不会生效。
                            </p>
                          ) : null}
                          {missing ? (
                            <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
                              <TriangleAlert className="mt-[0.1rem] h-3 w-3 shrink-0" />
                              技能池中已不存在该技能，建议取消绑定。
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-md px-1.5 py-0.5 text-[0.8125rem] text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!editable}
                          onClick={() =>
                            setBindings((prev) => {
                              const next = new Map(prev);
                              next.delete(row.skillId);
                              return next;
                            })
                          }
                        >
                          移除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </AgentContentState>
          </div>
          {dirty ? (
            <div className="border-t bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
              有未保存的改动，离开本页将丢失。
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
