/**
 * C–W 调度配置（UI#10，路径 `/agent/agents/:id/coordination`，V19 菜单 `92045`）。
 *
 * <p>覆盖 §4.3 #25 读 / #26 写 / #13 列 Agent（**已就绪**，用于 `worker_ids` 候选）。
 *
 * <p>**T05 收口：真实 wire 是嵌套结构 `AgentCoordination`**
 * `{agent_id, role, routing_enabled, delegation?, catalog?}` ——
 * coordinator 字段收进 `delegation`、worker 字段收进 `catalog`。
 * 此前扁平化的 `when_to_use / safety_level / allowed_workers / max_depth /
 * max_fanout / task_brief_template` 全部不存在；`safety_level` 的真实名是
 * `security_level`，且仅 `read_only | needs_hitl` 两档。
 *
 * <p>**role 取值是 `coordinator` | `worker`**，不是 "scheduler"。
 * 契约见 impl-plan §4.5 与 `types.ts` 的 `AgentRole` —— 它直接映射到
 * `agent.yaml: agent.role`，写错字符串下游会拒绝整个请求。
 * 界面文案用「协调者（Coordinator）」/「执行者（Worker）」，值仍是英文原样。
 *
 * <p>**C/W 字段互斥**（§4.5 校验 1）：提交不适用的字段服务端返回
 * `COORD_FIELD_NOT_APPLICABLE`。所以这里**按 role 分表单**，且提交时
 * `buildPayload()` 只挑当前 role 适用的嵌套段（delegation 或 catalog），
 * 另一段置 null —— 不能把两组字段都发过去。
 *
 * <p>**role 切换要强二次确认**（§4.5 校验 4）：worker → coordinator 会触发服务端
 * 级联清理，把该 agent 从所有其它 coordinator 的 `worker_ids` 里摘掉。
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
import type {
  AgentCoordination,
  AgentRole,
  AgentSummary,
  SecurityLevel,
} from '../types';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-card px-[0.7rem] text-sm text-foreground shadow-none';

const fieldLabel = 'mb-[0.4rem] block text-xs text-muted-foreground';

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

/** 安全等级（真实 wire 仅两档：read_only / needs_hitl）。 */
const SECURITY_OPTIONS: Array<{ value: SecurityLevel; label: string }> = [
  { value: 'read_only', label: '只读 — 无副作用' },
  { value: 'needs_hitl', label: '需人工审批（HITL）— 写操作前必须有人确认' },
];

/**
 * T05 硬约束护栏（前端镜像常量，与后端 `catalog.ADMIN_HELPER_AGENT_IDS` 严格对齐）：
 * 后台操作员专属智能体**不允许接入任何协调者**（copilot 全链路不可达）。
 *
 * <p>此处仅做**前端可见性护栏**（让运营在 UI 上无法勾选），真正的 fail-closed 由后端四道闸
 * （coordination.yaml 声明 / INVOKE_AGENT_WHITELIST / build_scoped_catalog / write_coordination 校验
 * + session 权限门 + invoke_agent 显式拒）兜底；前端不信任单点，后端不依赖前端。
 *
 * <p>若后端 `ADMIN_HELPER_AGENT_IDS` 增减，这里必须同步，否则会出现"后端拒、前端能勾"的漂移。
 */
const LOCKED_WORKERS: readonly string[] = ['mis-admin-helper'];

/** 文本域（按行展开成数组）与数值（字符串受控）的中间态。 */
interface FormState {
  role: AgentRole;
  routing_enabled: boolean;
  // delegation（coordinator）
  spawn_tools_enabled: boolean;
  enforce_task_brief: boolean;
  max_depth: string;
  delegation_timeout_seconds: string;
  emit_dispatch_trace: boolean;
  forbid_self_invoke: boolean;
  worker_ids: string[];
  // catalog（worker）
  catalog_enabled: boolean;
  when_to_use: string;
  capabilities: string;
  input_contract: string;
  output_contract: string;
  security_level: SecurityLevel;
  catalog_timeout_seconds: string;
  degrade_message: string;
}

const EMPTY_FORM: FormState = {
  role: 'worker',
  routing_enabled: true,
  spawn_tools_enabled: true,
  enforce_task_brief: true,
  max_depth: '3',
  delegation_timeout_seconds: '60',
  emit_dispatch_trace: true,
  forbid_self_invoke: true,
  worker_ids: [],
  catalog_enabled: true,
  when_to_use: '',
  capabilities: '',
  input_contract: '',
  output_contract: '',
  security_level: 'read_only',
  catalog_timeout_seconds: '60',
  degrade_message: '',
};

/** 字符串数组 → 文本域（每行一项）。 */
function toLines(arr: string[] | undefined): string {
  return Array.isArray(arr) ? arr.join('\n') : '';
}

/** 文本域 → 字符串数组（按行拆分 + 去空 + 去重）。 */
function toList(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  );
}

/** 后端嵌套契约 → 表单态。 */
function toForm(c: AgentCoordination): FormState {
  const delegation = c.delegation;
  const catalog = c.catalog;
  return {
    role: c.role,
    routing_enabled: c.routing_enabled,
    spawn_tools_enabled: delegation?.spawn_tools_enabled ?? true,
    enforce_task_brief: delegation?.enforce_task_brief ?? true,
    max_depth: delegation?.max_depth === undefined ? '3' : String(delegation.max_depth),
    delegation_timeout_seconds:
      delegation?.timeout_seconds === undefined ? '60' : String(delegation.timeout_seconds),
    emit_dispatch_trace: delegation?.emit_dispatch_trace ?? true,
    forbid_self_invoke: delegation?.forbid_self_invoke ?? true,
    worker_ids: delegation?.worker_ids ?? [],
    catalog_enabled: catalog?.enabled ?? true,
    when_to_use: catalog?.when_to_use ?? '',
    capabilities: toLines(catalog?.capabilities),
    input_contract: toLines(catalog?.input_contract),
    output_contract: catalog?.output_contract ?? '',
    security_level: catalog?.security_level ?? 'read_only',
    catalog_timeout_seconds:
      catalog?.timeout_seconds === undefined ? '60' : String(catalog.timeout_seconds),
    degrade_message: catalog?.degrade_message ?? '',
  };
}

/** 数值文本域 → number；空或非法时给兜底值，避免把 NaN 发给下游。 */
function toNumber(text: string, fallback: number): number {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/**
 * 表单态 → 提交契约，**只带当前 role 适用的嵌套段**。
 *
 * <p>带上不适用的字段会被服务端以 `COORD_FIELD_NOT_APPLICABLE` 整体拒绝（§4.5 校验 1），
 * 所以这里把另一段置 null，而不是把残留一起发过去。
 */
function buildPayload(agentId: string, form: FormState): AgentCoordination {
  if (form.role === 'coordinator') {
    return {
      agent_id: agentId,
      role: 'coordinator',
      routing_enabled: form.routing_enabled,
      delegation: {
        spawn_tools_enabled: form.spawn_tools_enabled,
        enforce_task_brief: form.enforce_task_brief,
        max_depth: toNumber(form.max_depth, 3),
        timeout_seconds: toNumber(form.delegation_timeout_seconds, 60),
        emit_dispatch_trace: form.emit_dispatch_trace,
        forbid_self_invoke: form.forbid_self_invoke,
        // T05 防御：即便 form.worker_ids 历史残留锁定项（后端此前已拒），也强制剥离
        worker_ids: form.worker_ids.filter((id) => !LOCKED_WORKERS.includes(id)),
      },
      catalog: null,
    };
  }
  return {
    agent_id: agentId,
    role: 'worker',
    routing_enabled: form.routing_enabled,
    delegation: null,
    catalog: {
      enabled: form.catalog_enabled,
      when_to_use: form.when_to_use.trim(),
      capabilities: toList(form.capabilities),
      input_contract: toList(form.input_contract),
      output_contract: form.output_contract.trim(),
      security_level: form.security_level,
      timeout_seconds: toNumber(form.catalog_timeout_seconds, 60),
      degrade_message: form.degrade_message.trim(),
    },
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

  /** 可选 worker：role=worker、排除自己（§4.5 校验 3 禁自环）、且排除锁定项（T05 硬约束）。 */
  const workerOptions = useMemo(
    () =>
      candidates.filter(
        (a) =>
          a.role === 'worker' &&
          a.agent_id !== agentId &&
          !LOCKED_WORKERS.includes(a.agent_id),
      ),
    [candidates, agentId],
  );

  /**
   * T05：锁定项（后台操作员专属，硬约束不可接入任何协调者）。
   * 即便后端候选里没有它，也强制展示一条禁用条目，避免运营误以为"可加"而走提交被拒。
   */
  const lockedWorkerRows = useMemo(
    () =>
      LOCKED_WORKERS.map((id) => {
        const found = candidates.find((a) => a.agent_id === id);
        return { agent_id: id, display_name: found?.display_name ?? id };
      }),
    [candidates],
  );

  const roleChanged = serverRole !== null && serverRole !== form.role;

  function patch(next: Partial<FormState>): void {
    setForm((prev) => ({ ...prev, ...next }));
  }

  function toggleWorker(id: string): void {
    setForm((prev) => ({
      ...prev,
      worker_ids: prev.worker_ids.includes(id)
        ? prev.worker_ids.filter((x) => x !== id)
        : [...prev.worker_ids, id],
    }));
  }

  async function doSave(): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveCoordination(agentId, buildPayload(agentId, form));
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
                  以下 Agent 的 <span className="font-mono">worker_ids</span> 中已移除对{' '}
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

          {/* ---------------- 角色单选 + 路由开关 ---------------- */}
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

            {/* routing_enabled：顶层字段，两种角色都适用 */}
            <div className="mt-3 flex items-center gap-3 rounded-md border bg-muted/30 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">启用智能路由</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  关闭后该 Agent 不参与路由分发（协调者不再把任务派给它，自身也不接收派发）。
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.routing_enabled}
                className={cn(
                  'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                  form.routing_enabled ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
                onClick={() => patch({ routing_enabled: !form.routing_enabled })}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
                    form.routing_enabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
                  )}
                />
              </button>
            </div>
          </div>

          <div className="flex gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            <Info className="mt-[0.1rem] h-3.5 w-3.5 shrink-0 text-info" />
            <p className="leading-relaxed">
              {activeRoleHint}
              协调者字段（delegation）与执行者字段（catalog）
              <span className="font-medium text-foreground">互斥</span>，
              保存时只会提交当前角色适用的嵌套段。
            </p>
          </div>

          {/* ---------------- 分表单：worker（catalog） ---------------- */}
          {form.role === 'worker' ? (
            <div className="space-y-3 rounded-lg border bg-card p-3">
              <p className="text-sm font-medium">执行者配置（catalog）</p>

              <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">登记进 Worker Catalog</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    关闭后该 Agent 从全局 Worker Catalog 中排除，协调者不再把它当作可派发对象。
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.catalog_enabled}
                  className={cn(
                    'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                    form.catalog_enabled ? 'bg-primary' : 'bg-muted-foreground/30',
                  )}
                  onClick={() => patch({ catalog_enabled: !form.catalog_enabled })}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
                      form.catalog_enabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
                    )}
                  />
                </button>
              </div>

              <div>
                <label className={fieldLabel}>适用场景（when_to_use）</label>
                <Textarea
                  rows={3}
                  placeholder="描述什么情况下应该把任务派发给该执行者，协调者据此选路。"
                  value={form.when_to_use}
                  onChange={(e) => patch({ when_to_use: e.target.value })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={fieldLabel}>能力（capabilities，每行一项）</label>
                  <Textarea
                    rows={4}
                    placeholder={'例如：\n文件读取\n数据查询'}
                    value={form.capabilities}
                    onChange={(e) => patch({ capabilities: e.target.value })}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>输入契约（input_contract，每行一项）</label>
                  <Textarea
                    rows={4}
                    placeholder="期望接收的任务描述格式 / 必填字段。"
                    value={form.input_contract}
                    onChange={(e) => patch({ input_contract: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className={fieldLabel}>输出契约（output_contract）</label>
                <Textarea
                  rows={3}
                  placeholder="返回结果的结构约定，供协调者聚合。"
                  value={form.output_contract}
                  onChange={(e) => patch({ output_contract: e.target.value })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={fieldLabel}>安全等级（security_level）</label>
                  <select
                    className={selectClass}
                    value={form.security_level}
                    onChange={(e) => patch({ security_level: e.target.value as SecurityLevel })}
                  >
                    {SECURITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={fieldLabel}>超时秒数（timeout_seconds）</label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="如 60"
                    value={form.catalog_timeout_seconds}
                    onChange={(e) => patch({ catalog_timeout_seconds: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className={fieldLabel}>降级提示（degrade_message）</label>
                <Textarea
                  rows={2}
                  placeholder="该执行者不可用/超时后，协调者回给用户的降级说明。"
                  value={form.degrade_message}
                  onChange={(e) => patch({ degrade_message: e.target.value })}
                />
              </div>
            </div>
          ) : (
            /* ---------------- 分表单：coordinator（delegation） ---------------- */
            <div className="space-y-3 rounded-lg border bg-card p-3">
              <p className="text-sm font-medium">协调者配置（delegation）</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">启用 Spawn 工具</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      允许协调者通过 Spawn 工具临时拉起新执行者。
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    checked={form.spawn_tools_enabled}
                    onChange={(e) => patch({ spawn_tools_enabled: e.target.checked })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">强制任务简报</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      派发前必须先生成任务简报，未通过校验的请求直接拒绝。
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    checked={form.enforce_task_brief}
                    onChange={(e) => patch({ enforce_task_brief: e.target.checked })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">记录派发轨迹</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      每次委派写入 dispatch trace，供调度观测页回放。
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    checked={form.emit_dispatch_trace}
                    onChange={(e) => patch({ emit_dispatch_trace: e.target.checked })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">禁止自调用</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      不允许把任务派发给自身（防环）。
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    checked={form.forbid_self_invoke}
                    onChange={(e) => patch({ forbid_self_invoke: e.target.checked })}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={fieldLabel}>最大派发深度（max_depth）</label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="如 3"
                    value={form.max_depth}
                    onChange={(e) => patch({ max_depth: e.target.value })}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>委派超时秒数（timeout_seconds）</label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="如 60"
                    value={form.delegation_timeout_seconds}
                    onChange={(e) => patch({ delegation_timeout_seconds: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <div className="mb-[0.4rem] flex flex-wrap items-center gap-2">
                  <label className="text-xs text-muted-foreground">
                    可派发的执行者（worker_ids）
                  </label>
                  <span className="text-xs text-muted-foreground">
                    已选 {form.worker_ids.length} 个
                  </span>
                </div>
                <div className="max-h-56 overflow-auto rounded-md border">
                  {workerOptions.length === 0 && lockedWorkerRows.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      当前没有可选的执行者。请先把目标 Agent 的调度角色设为「执行者」。
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {workerOptions.map((w) => (
                        <li key={w.agent_id}>
                          <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 cursor-pointer accent-primary"
                              checked={form.worker_ids.includes(w.agent_id)}
                              onChange={() => toggleWorker(w.agent_id)}
                            />
                            <span className="min-w-0 flex-1 truncate">{w.display_name}</span>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {w.agent_id}
                            </span>
                          </label>
                        </li>
                      ))}
                      {lockedWorkerRows.map((w) => (
                        <li key={w.agent_id} className="bg-destructive/5">
                          <div className="flex items-center gap-2 px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 cursor-not-allowed accent-destructive"
                              disabled
                              checked={false}
                              readOnly
                            />
                            <span className="min-w-0 flex-1 truncate text-foreground">
                              {w.display_name}
                            </span>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {w.agent_id}
                            </span>
                            <span className="shrink-0 text-xs font-medium text-destructive">
                              后台操作员专属 · 不可接入
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* T05：硬约束提示，明确告知运营「后台操作员专属」不可被任何协调者委派 */}
                {lockedWorkerRows.length > 0 ? (
                  <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
                    <TriangleAlert className="mt-[0.1rem] h-3 w-3 shrink-0" />
                    以下智能体为后台操作员专属，按设计硬约束禁止接入任何协调者（copilot
                    全链路不可达）；即使强行提交，后端四道闸也会拒绝。本条仅为前端护栏，真实拒绝以后端为准。
                  </p>
                ) : null}
                {/* 已选但不在候选里的 id：多半是对方角色被改了，必须显式暴露 */}
                {form.worker_ids.filter((id) => !workerOptions.some((w) => w.agent_id === id))
                  .length > 0 ? (
                  <p className="mt-1 flex items-start gap-1 text-xs text-warning">
                    <TriangleAlert className="mt-[0.1rem] h-3 w-3 shrink-0" />
                    以下已配置的执行者当前不可用（已删除或角色已变更）：
                    {form.worker_ids
                      .filter((id) => !workerOptions.some((w) => w.agent_id === id))
                      .join('、')}
                  </p>
                ) : null}
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
                ? '该 Agent 将从所有其它协调者的 worker_ids 中被移除，相关调度链路会立即改变。'
                : '该 Agent 原有的 worker_ids / 派发上限等协调者配置将不再适用。'}
            </p>
            <p>受影响的 Agent 清单会在保存成功后列出。</p>
          </>
        }
        onConfirm={doSave}
      />
    </div>
  );
}
