/**
 * C–W 调度配置（UI#10，路径 `/agent/agents/:id/coordination`，V19 菜单 `92045`）。
 *
 * <p>覆盖 §4.3 #25 读（后端 T04 未实现 ⇒ **501**）/ #26 写（同 pending）
 * / #13 列 Agent（**已就绪**，用于 `allowed_workers` 候选）。
 *
 * <p>**role 取值是 `coordinator` | `worker`**，不是 "scheduler"。
 * 契约见 impl-plan §4.5 与 `types.ts` 的 `AgentRole` —— 它直接映射到
 * `agent.yaml: agent.role`，写错字符串下游会拒绝整个请求。
 * 界面文案用「协调者（Coordinator）」/「执行者（Worker）」，值仍是英文原样。
 *
 * <p>**C/W 字段互斥**（§4.5 校验 1）：提交不适用的字段服务端返回
 * `COORD_FIELD_NOT_APPLICABLE`。所以这里**按 role 分表单**，且提交时
 * `buildPayload()` 只挑当前 role 适用的字段 —— 不能把两组字段都发过去。
 *
 * <p>**role 切换要强二次确认**（§4.5 校验 4）：worker → coordinator 会触发服务端
 * 级联清理，把该 agent 从所有其它 coordinator 的 `allowed_workers` 里摘掉。
 * 这是会影响别人配置的操作，故用 `confirmKeyword` 强确认（逐字输入 agentId），
 * 并在保存成功后把响应里的 `affected_agents[]` 显式列给运营看。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, RefreshCw, Save, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SubmitButton } from '@/components/common/submit-button';
import { PermissionGate } from '@/components/auth/permission-gate';
import { AgentContentState } from '../components/agent-page-shell';
import { AgentConfirmDialog } from '../components/agent-confirm-dialog';
import { getCoordination, listAgents, saveCoordination } from '../api/agent-ops-api';
import { agentErrorMessage } from '../types';
import type { AgentRole, AgentSummary, Coordination, SafetyLevel } from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

export interface AgentCoordinationPageProps {
  agentId: string;
}

/** 角色选项：值必须与 `agent.yaml: agent.role` 完全一致。 */
const ROLE_OPTIONS: Array<{ value: AgentRole; label: string; hint: string }> = [
  {
    value: 'coordinator',
    label: '协调者（Coordinator）',
    hint: '负责拆解任务并派发给白名单内的执行者，自身不直接执行业务技能。',
  },
  {
    value: 'worker',
    label: '执行者（Worker）',
    hint: '接收协调者派发的任务并执行，需声明适用场景与输入输出契约。',
  },
];

const SAFETY_OPTIONS: Array<{ value: SafetyLevel; label: string }> = [
  { value: 'low', label: '低 — 只读 / 无副作用' },
  { value: 'medium', label: '中 — 有限写入，可回滚' },
  { value: 'high', label: '高 — 不可逆写入，需审批' },
];

/** 表单态：把 Coordination 的可选字段摊平成受控输入需要的非空值。 */
interface FormState {
  role: AgentRole;
  when_to_use: string;
  input_contract: string;
  output_contract: string;
  safety_level: SafetyLevel;
  allowed_workers: string[];
  max_depth: string;
  max_fanout: string;
  task_brief_template: string;
}

const EMPTY_FORM: FormState = {
  role: 'worker',
  when_to_use: '',
  input_contract: '',
  output_contract: '',
  safety_level: 'low',
  allowed_workers: [],
  max_depth: '',
  max_fanout: '',
  task_brief_template: '',
};

/** 后端契约 → 表单态。 */
function toForm(c: Coordination): FormState {
  return {
    role: c.role,
    when_to_use: c.when_to_use ?? '',
    input_contract: c.input_contract ?? '',
    output_contract: c.output_contract ?? '',
    safety_level: c.safety_level ?? 'low',
    allowed_workers: c.allowed_workers ?? [],
    max_depth: c.max_depth === undefined ? '' : String(c.max_depth),
    max_fanout: c.max_fanout === undefined ? '' : String(c.max_fanout),
    task_brief_template: c.task_brief_template ?? '',
  };
}

/**
 * 表单态 → 提交契约，**只带当前 role 适用的字段**。
 *
 * <p>带上不适用的字段会被服务端以 `COORD_FIELD_NOT_APPLICABLE` 整体拒绝（§4.5 校验 1），
 * 所以这里必须裁剪，而不是把 `EMPTY_FORM` 的残留一起发过去。
 */
function buildPayload(form: FormState): Coordination {
  if (form.role === 'worker') {
    return {
      role: 'worker',
      when_to_use: form.when_to_use.trim(),
      input_contract: form.input_contract.trim(),
      output_contract: form.output_contract.trim(),
      safety_level: form.safety_level,
    };
  }
  const depth = Number.parseInt(form.max_depth, 10);
  const fanout = Number.parseInt(form.max_fanout, 10);
  return {
    role: 'coordinator',
    allowed_workers: form.allowed_workers,
    max_depth: Number.isFinite(depth) ? depth : undefined,
    max_fanout: Number.isFinite(fanout) ? fanout : undefined,
    task_brief_template: form.task_brief_template.trim(),
  };
}

export function AgentCoordinationPage({ agentId }: AgentCoordinationPageProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  /** 服务端当前的 role，用于判断本次保存是否发生了角色切换。 */
  const [serverRole, setServerRole] = useState<AgentRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [affected, setAffected] = useState<string[]>([]);

  /** worker 候选（#13 ready）。失败不阻断表单：只是候选列表为空。 */
  const [candidates, setCandidates] = useState<AgentSummary[]>([]);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    setAffected([]);
    try {
      const c = await getCoordination(agentId);
      setForm(toForm(c));
      setServerRole(c.role);
    } catch (e) {
      setServerRole(null);
      setError(agentErrorMessage(e, '获取调度配置失败'));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const loadCandidates = useCallback(async () => {
    try {
      setCandidates(await listAgents());
    } catch {
      // 候选列表拿不到不影响主表单，静默降级为空列表
      setCandidates([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  /** 可选 worker：role=worker 且排除自己（§4.5 校验 3 禁自环）。 */
  const workerOptions = useMemo(
    () => candidates.filter((a) => a.role === 'worker' && a.id !== agentId),
    [candidates, agentId],
  );

  const roleChanged = serverRole !== null && serverRole !== form.role;

  function patch(next: Partial<FormState>): void {
    setForm((prev) => ({ ...prev, ...next }));
  }

  function toggleWorker(id: string): void {
    setForm((prev) => ({
      ...prev,
      allowed_workers: prev.allowed_workers.includes(id)
        ? prev.allowed_workers.filter((x) => x !== id)
        : [...prev.allowed_workers, id],
    }));
  }

  async function doSave(): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveCoordination(agentId, buildPayload(form));
      setForm(toForm(result.coordination));
      setServerRole(result.coordination.role);
      setAffected(result.affected_agents ?? []);
      setConfirmOpen(false);
      if ((result.affected_agents ?? []).length > 0) {
        toast.success(`调度配置已保存，另有 ${result.affected_agents.length} 个 Agent 受到影响`);
      } else {
        toast.success('调度配置已保存');
      }
    } catch (e) {
      toast.error(agentErrorMessage(e, '保存调度配置失败'));
    } finally {
      setSaving(false);
    }
  }

  /** role 未变 ⇒ 直接保存；role 变了 ⇒ 走强二次确认。 */
  function onSaveClick(): void {
    if (roleChanged) {
      setConfirmOpen(true);
      return;
    }
    void doSave();
  }

  const activeRoleHint = ROLE_OPTIONS.find((o) => o.value === form.role)?.hint ?? '';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <AgentContentState
        loading={loading && serverRole === null}
        error={error}
        onRetry={() => void load()}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
          {/* 级联影响回执：保存后才出现，列出被摘掉引用的 coordinator */}
          {affected.length > 0 ? (
            <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
              <TriangleAlert className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-warning" />
              <div className="leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">本次保存触发了级联清理</p>
                <p>
                  以下 Agent 的 <span className="font-mono">allowed_workers</span> 中已移除对{' '}
                  <span className="font-mono">{agentId}</span> 的引用，请确认其调度链路仍然完整：
                </p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {affected.map((id) => (
                    <span key={id} className="rounded-md border bg-card px-1.5 py-0.5 font-mono">
                      {id}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          ) : null}

          {/* ---------------- 角色单选 ---------------- */}
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">调度角色</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                重新加载
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm',
                    form.role === opt.value
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-accent/40',
                  )}
                >
                  <input
                    type="radio"
                    name="coordination-role"
                    className="mt-1 h-3.5 w-3.5 cursor-pointer accent-primary"
                    checked={form.role === opt.value}
                    onChange={() => patch({ role: opt.value })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{opt.label}</span>
                    <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {roleChanged ? (
              <p className="mt-2 flex items-start gap-1 text-xs text-warning">
                <TriangleAlert className="mt-[0.1rem] h-3 w-3 shrink-0" />
                角色将由「{serverRole === 'coordinator' ? '协调者' : '执行者'}」改为「
                {form.role === 'coordinator' ? '协调者' : '执行者'}」，保存时需要二次确认。
              </p>
            ) : null}
          </div>

          <div className="flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
            <p className="leading-relaxed">
              {activeRoleHint}
              协调者字段与执行者字段<span className="font-medium text-foreground">互斥</span>，
              保存时只会提交当前角色适用的字段。
            </p>
          </div>

          {/* ---------------- 分表单：worker ---------------- */}
          {form.role === 'worker' ? (
            <div className="space-y-3 rounded-lg border bg-card p-3">
              <p className="text-sm font-medium">执行者配置</p>
              <div>
                <label className="mb-[0.4rem] block text-xs text-muted-foreground">
                  适用场景（when_to_use）
                </label>
                <Textarea
                  rows={3}
                  placeholder="描述什么情况下应该把任务派发给该执行者，协调者据此选路。"
                  value={form.when_to_use}
                  onChange={(e) => patch({ when_to_use: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-[0.4rem] block text-xs text-muted-foreground">
                    输入契约（input_contract）
                  </label>
                  <Textarea
                    rows={4}
                    placeholder="期望接收的任务描述格式 / 必填字段。"
                    value={form.input_contract}
                    onChange={(e) => patch({ input_contract: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-[0.4rem] block text-xs text-muted-foreground">
                    输出契约（output_contract）
                  </label>
                  <Textarea
                    rows={4}
                    placeholder="返回结果的结构约定，供协调者聚合。"
                    value={form.output_contract}
                    onChange={(e) => patch({ output_contract: e.target.value })}
                  />
                </div>
              </div>
              <div className="max-w-sm">
                <label className="mb-[0.4rem] block text-xs text-muted-foreground">
                  安全等级（safety_level）
                </label>
                <select
                  className={selectClass}
                  value={form.safety_level}
                  onChange={(e) => patch({ safety_level: e.target.value as SafetyLevel })}
                >
                  {SAFETY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            /* ---------------- 分表单：coordinator ---------------- */
            <div className="space-y-3 rounded-lg border bg-card p-3">
              <p className="text-sm font-medium">协调者配置</p>

              <div>
                <div className="mb-[0.4rem] flex flex-wrap items-center gap-2">
                  <label className="text-xs text-muted-foreground">
                    可派发的执行者（allowed_workers）
                  </label>
                  <span className="text-xs text-muted-foreground">
                    已选 {form.allowed_workers.length} 个
                  </span>
                </div>
                <div className="max-h-56 overflow-auto rounded-md border">
                  {workerOptions.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      当前没有可选的执行者。请先把目标 Agent 的调度角色设为「执行者」。
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {workerOptions.map((w) => (
                        <li key={w.id}>
                          <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 cursor-pointer accent-primary"
                              checked={form.allowed_workers.includes(w.id)}
                              onChange={() => toggleWorker(w.id)}
                            />
                            <span className="min-w-0 flex-1 truncate">{w.display_name}</span>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {w.id}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* 已选但不在候选里的 id：多半是对方角色被改了，必须显式暴露 */}
                {form.allowed_workers.filter((id) => !workerOptions.some((w) => w.id === id))
                  .length > 0 ? (
                  <p className="mt-1 flex items-start gap-1 text-xs text-warning">
                    <TriangleAlert className="mt-[0.1rem] h-3 w-3 shrink-0" />
                    以下已配置的执行者当前不可用（已删除或角色已变更）：
                    {form.allowed_workers
                      .filter((id) => !workerOptions.some((w) => w.id === id))
                      .join('、')}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-[0.4rem] block text-xs text-muted-foreground">
                    最大派发深度（max_depth）
                  </label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="如 3"
                    value={form.max_depth}
                    onChange={(e) => patch({ max_depth: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-[0.4rem] block text-xs text-muted-foreground">
                    单层最大并发（max_fanout）
                  </label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="如 5"
                    value={form.max_fanout}
                    onChange={(e) => patch({ max_fanout: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="mb-[0.4rem] block text-xs text-muted-foreground">
                  任务简报模板（task_brief_template）
                </label>
                <Textarea
                  rows={5}
                  className="font-mono text-xs"
                  placeholder="派发给执行者的任务描述模板，可含占位符。"
                  value={form.task_brief_template}
                  onChange={(e) => patch({ task_brief_template: e.target.value })}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end pb-1">
            <PermissionGate permission="agent:agent:coordination:save">
              <SubmitButton size="sm" loading={saving} onClick={onSaveClick}>
                <Save className="h-4 w-4" />
                保存调度配置
              </SubmitButton>
            </PermissionGate>
          </div>
        </div>
      </AgentContentState>

      <AgentConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        danger
        title="确认变更调度角色"
        confirmText="确认变更"
        confirmKeyword={agentId}
        description={
          <>
            <p>
              即将把 <span className="font-mono">{agentId}</span> 的调度角色由「
              {serverRole === 'coordinator' ? '协调者' : '执行者'}」改为「
              {form.role === 'coordinator' ? '协调者' : '执行者'}」。
            </p>
            <p>
              角色变更会触发<span className="font-medium text-foreground">服务端级联清理</span>：
              {form.role === 'coordinator'
                ? '该 Agent 将从所有其它协调者的 allowed_workers 中被移除，相关调度链路会立即改变。'
                : '该 Agent 原有的 allowed_workers / 派发上限等协调者配置将不再适用。'}
            </p>
            <p>受影响的 Agent 清单会在保存成功后列出。</p>
          </>
        }
        onConfirm={doSave}
      />
    </div>
  );
}
